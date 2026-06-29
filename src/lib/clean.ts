// ===========================================================================
// TrimIQ Editing Engine — V7 (quality-first, resolution-exact, memory-safe)
//   • Transcription-driven cuts: removes dead space, long pauses, fillers,
//     false starts, correction phrases, and repeated/retake lines.
//   • Retake clustering: when you say something several times, only the final
//     complete take is kept.
//   • Editing modes: light / balanced / aggressive (snappy short-form pacing).
//   • EXACT output: no crop, no zoom, no reframe, NO downscale. The export keeps
//     the uploaded resolution, aspect ratio, framing and fps exactly.
//   • Memory-safe rendering: each kept segment is encoded on its own, then the
//     pieces are concatenated with a stream copy. Peak memory scales with one
//     frame's resolution — not the video length or number of cuts — so large/4K
//     clips process consistently without running the box out of memory.
// ===========================================================================
import { spawn } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// ------------------------------ modes --------------------------------------
export type EditMode = "light" | "balanced" | "aggressive";

export type Settings = {
  silenceThresholdDb: number | "auto";
  minPause: number;
  leadIn: number;
  trailOut: number;
  naturalPause: number;
  wordPad: number;
  minClipLength: number;
  fade: number;
  sentenceGap: number;
  removeFiller: boolean;
  removeSoftFiller: boolean;
  nearPrefixThresh: number;
  dropRatio: number;
};

export const MODE_PRESETS: Record<EditMode, Settings> = {
  light: {
    silenceThresholdDb: "auto", minPause: 0.7, leadIn: 0.14, trailOut: 0.22,
    naturalPause: 0.55, wordPad: 0.12, minClipLength: 0.25, fade: 0.05,
    sentenceGap: 0.8, removeFiller: true, removeSoftFiller: false,
    nearPrefixThresh: 0.7, dropRatio: 0.55,
  },
  balanced: {
    silenceThresholdDb: "auto", minPause: 0.4, leadIn: 0.10, trailOut: 0.16,
    naturalPause: 0.30, wordPad: 0.09, minClipLength: 0.2, fade: 0.05,
    sentenceGap: 0.6, removeFiller: true, removeSoftFiller: true,
    nearPrefixThresh: 0.6, dropRatio: 0.85,
  },
  aggressive: {
    silenceThresholdDb: "auto", minPause: 0.25, leadIn: 0.08, trailOut: 0.11,
    naturalPause: 0.18, wordPad: 0.07, minClipLength: 0.18, fade: 0.04,
    sentenceGap: 0.45, removeFiller: true, removeSoftFiller: true,
    nearPrefixThresh: 0.55, dropRatio: 0.95,
  },
};

export type CleanResult = {
  original: number;
  cleaned: number;
  removed: number;
  cuts: number;
  percentRemoved: number;
  segments: [number, number][];
  mode: "smart" | "audio";
  editMode: EditMode;
  capped: boolean;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.slice(-1500) || `exit ${code}`))
    );
  });
}

async function getDuration(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return parseFloat(stdout.trim());
}

async function getDims(file: string): Promise<{ w: number; h: number }> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number);
  return { w: w || 1080, h: h || 1920 };
}

// ============================ LAYER 1: audio ===============================
async function measureMaxDb(file: string): Promise<number> {
  const { stderr } = await run(FFMPEG, ["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const m = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/);
  return m ? parseFloat(m[1]) : -3;
}

async function detectSilences(file: string, noiseDb: number, minPause: number): Promise<[number, number][]> {
  const { stderr } = await run(FFMPEG, ["-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minPause}`, "-f", "null", "-"]);
  const silences: [number, number][] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[0-9.]+)/);
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (s) start = Math.max(0, parseFloat(s[1]));
    if (e && start !== null) { silences.push([start, parseFloat(e[1])]); start = null; }
  }
  return silences;
}

function planFromSilences(silences: [number, number][], duration: number, s: Settings): [number, number][] {
  const segs: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of silences) {
    const keepEnd = a + s.trailOut;
    if (keepEnd - cursor > 0.02) segs.push([cursor, Math.min(keepEnd, duration)]);
    cursor = Math.max(cursor, b - s.leadIn);
  }
  if (cursor < duration - 0.02) segs.push([cursor, duration]);
  return segs.filter(([x, y]) => y - x >= s.minClipLength);
}

// ===================== LAYER 2: transcription-driven =======================
type Word = { w: string; term: boolean; start: number; end: number };
type Line = { words: Word[]; norm: string[]; start: number; end: number; term: boolean };

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
const HARD_FILLER = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "err", "mm", "mmm", "hmm", "hmmm", "ah"]);
const SOFT_FILLER = new Set(["like", "so", "basically", "literally"]);
const CORR = new Set(["no", "nope", "wait", "sorry", "scratch", "redo", "actually", "oops", "nevermind"]);
const CORR_PHRASES = [
  "let me say that again", "let me start over", "let me redo", "start over", "one more time",
  "say that again", "let me try again", "take that again", "do that again", "let me restart",
  "let me rephrase", "hold on", "wait no", "let me do that again", "scratch that", "take two",
];

async function extractAudio(input: string): Promise<string> {
  const out = join(dirname(input), `audio-${Date.now()}.wav`);
  await run(FFMPEG, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", out]);
  return out;
}

async function transcribe(audioPath: string, apiKey: string): Promise<Word[]> {
  const bytes = await readFile(audioPath);
  // One quick retry on transient Deepgram/network errors so a blip can't silently
  // drop us to the weaker audio-only path.
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
        { method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" }, body: bytes }
      );
      if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json: any = await res.json();
      const words = json?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
      return words
        .map((x: any) => ({ w: norm(x.word), term: /[.?!]$/.test(x.punctuated_word || x.word || ""), start: x.start, end: x.end }))
        .filter((x: Word) => x.w);
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 600));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("transcription failed");
}

const mkLine = (ws: Word[]): Line => ({
  words: ws, norm: ws.map((x) => x.w), start: ws[0].start, end: ws[ws.length - 1].end, term: ws[ws.length - 1].term,
});

function splitLines(words: Word[], sentenceGap: number): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = words[i + 1];
    const bigPause = next && next.start - words[i].end > sentenceGap;
    if (words[i].term || bigPause || !next) { lines.push(mkLine(cur)); cur = []; }
  }
  return lines;
}

// Collapse a mid-line restart, e.g. "I'm gonna— I'm gonna show you" -> keep the
// last attempt within the line.
function collapseRestart(line: Line): Line {
  const n = line.norm;
  if (n.length < 4) return line;
  let last = 0;
  if (n[1] === n[0]) last = 1;
  for (let j = 2; j + 1 < n.length; j++) if (n[j] === n[0] && n[j + 1] === n[1]) last = j;
  return last > 0 ? mkLine(line.words.slice(last)) : line;
}

const stripFiller = (a: string[]) => a.filter((w) => !HARD_FILLER.has(w) && !SOFT_FILLER.has(w));

function isNearPrefix(a: string[], b: string[], thresh: number): boolean {
  a = stripFiller(a); b = stripFiller(b);
  if (a.length < 2 || a.length >= b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) m++;
  return m / a.length >= thresh;
}

// Fraction of the smaller line's words that also appear in the other line.
function tokenOverlap(a: string[], b: string[]): number {
  const sa = new Set(stripFiller(a));
  const sb = new Set(stripFiller(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / Math.min(sa.size, sb.size);
}

// Is `next` a retake / re-statement of `prev` (same thing said again)?
function isRetake(prev: Line, next: Line, s: Settings): boolean {
  if (isNearPrefix(prev.norm, next.norm, s.nearPrefixThresh)) return true; // prev is a false start of next
  if (isNearPrefix(next.norm, prev.norm, s.nearPrefixThresh)) return true; // next trails off, prev was fuller
  const ov = tokenOverlap(prev.norm, next.norm);
  if (!prev.term && ov >= 0.6) return true; // restated an unfinished attempt
  if (ov >= 0.82) return true;              // near-duplicate sentences
  return false;
}

function isCorrectionLine(line: Line): boolean {
  const t = line.norm.join(" ");
  if (CORR_PHRASES.some((p) => t.includes(p))) return true;
  return line.norm.length <= 3 && line.norm.some((w) => CORR.has(w));
}

function removeFillers(kw: Word[], s: Settings): Word[] {
  if (!s.removeFiller) return kw;
  const out: Word[] = [];
  for (let i = 0; i < kw.length; i++) {
    const w = kw[i].w;
    if (HARD_FILLER.has(w)) continue;
    if (s.removeSoftFiller) {
      const prev = out[out.length - 1];
      const next = kw[i + 1];
      const isolated = (!prev || kw[i].start - prev.end > 0.2) && (!next || next.start - kw[i].end > 0.2);
      if (w === "you" && next && next.w === "know") {
        const after = kw[i + 2];
        const isoPair = (!prev || kw[i].start - prev.end > 0.2) && (!after || after.start - next.end > 0.2);
        if (isoPair || !prev) { i++; continue; }
      }
      if (SOFT_FILLER.has(w) && (isolated || !prev)) continue;
    }
    out.push(kw[i]);
  }
  return out;
}

function mergeRanges(ranges: [number, number][], minLen: number): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < 0.02) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.filter(([a, b]) => b - a >= minLen);
}

function planFromTranscript(words: Word[], duration: number, s: Settings): [number, number][] {
  let lines = splitLines(words, s.sentenceGap).map(collapseRestart);
  lines = lines.filter((l) => !isCorrectionLine(l));

  // Cluster consecutive retakes of the same statement and keep only the best
  // (final, completed) take of each cluster.
  const kept: Line[] = [];
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j + 1 < lines.length && isRetake(lines[j], lines[j + 1], s)) j++;
    if (j > i) {
      const cluster = lines.slice(i, j + 1);
      const finalTake =
        [...cluster].reverse().find((l) => l.term) ||
        cluster.reduce((best, l) => (l.norm.length > best.norm.length ? l : best));
      kept.push(finalTake);
    } else {
      kept.push(lines[i]);
    }
    i = j + 1;
  }

  let kw = removeFillers(kept.flatMap((l) => l.words), s);
  if (!kw.length) return [];
  const segs: [number, number][] = [];
  let segStart = Math.max(0, kw[0].start - Math.min(s.wordPad, 0.1));
  for (let k = 0; k < kw.length; k++) {
    const cur = kw[k];
    const next = kw[k + 1];
    if (!next) { segs.push([segStart, Math.min(duration, cur.end + Math.min(s.wordPad, 0.12))]); break; }
    const gap = next.start - cur.end;
    if (gap <= s.naturalPause) continue;
    const pad = Math.min(s.wordPad, gap * 0.4);
    segs.push([segStart, Math.min(duration, cur.end + pad)]);
    segStart = Math.max(0, next.start - pad);
  }
  return mergeRanges(segs, s.minClipLength);
}

// ============================== rendering ==================================
// Encode ONE kept segment to its own MPEG-TS file. Input-seek (`-ss` before
// `-i`) keeps this fast and low-memory; re-encoding makes the cut frame-accurate.
// No scale/crop/reframe — the frame is passed through at its exact resolution.
async function encodeSegment(
  input: string, a: number, b: number, idx: number, dir: string, s: Settings, preset: string
): Promise<string> {
  const out = join(dir, `seg-${idx}-${Date.now()}.ts`);
  const dur = Math.max(0.05, b - a);
  const args = ["-y", "-ss", a.toFixed(3), "-i", input, "-t", dur.toFixed(3)];
  if (dur > s.fade * 3) {
    args.push("-af", `afade=t=in:st=0:d=${s.fade},afade=t=out:st=${(dur - s.fade).toFixed(3)}:d=${s.fade}`);
  }
  args.push(
    "-c:v", "libx264", "-preset", preset, "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-video_track_timescale", "90000", "-avoid_negative_ts", "make_zero",
    "-max_muxing_queue_size", "1024", "-f", "mpegts", out
  );
  await run(FFMPEG, args);
  return out;
}

// Timeline-only render. Exact resolution/aspect/framing preserved (no downscale).
// Memory stays bounded because segments are encoded one at a time and then joined
// with a stream copy.
async function renderFinal(
  input: string, output: string, segs: [number, number][], s: Settings, original: number
): Promise<boolean> {
  // No cuts at all -> remux the original streams unchanged (exact quality, fast).
  const noCuts = segs.length === 1 && segs[0][0] <= 0.05 && segs[0][1] >= original - 0.05;
  if (noCuts) {
    await run(FFMPEG, ["-y", "-i", input, "-c", "copy", "-movflags", "+faststart", output]);
    return false;
  }

  // For very large frames (true 4K+) use a lighter preset so encoding stays well
  // within memory; quality stays high at crf 18. Resolution is NOT changed.
  const { w, h } = await getDims(input);
  const preset = Math.max(w, h) > 1920 ? "superfast" : "veryfast";
  const dir = dirname(output);

  const tsFiles: string[] = [];
  try {
    for (let i = 0; i < segs.length; i++) {
      tsFiles.push(await encodeSegment(input, segs[i][0], segs[i][1], i, dir, s, preset));
    }
    const listPath = join(dir, `concat-${Date.now()}.txt`);
    await writeFile(listPath, tsFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    await run(FFMPEG, [
      "-y", "-f", "concat", "-safe", "0", "-i", listPath,
      "-c", "copy", "-movflags", "+faststart", output,
    ]);
    await unlink(listPath).catch(() => {});
  } finally {
    for (const f of tsFiles) await unlink(f).catch(() => {});
  }
  return false; // never scaled
}

function countCuts(segs: [number, number][], duration: number): number {
  let cuts = 0;
  let cursor = 0;
  for (const [a, b] of segs) {
    if (a - cursor > 0.1) cuts++;
    cursor = Math.max(cursor, b);
  }
  if (duration - cursor > 0.1) cuts++;
  return cuts;
}

// ============================== orchestrator ===============================
export async function cleanVideo(
  input: string,
  output: string,
  opts: { mode?: EditMode; fileBytes?: number; onStage?: (stage: string) => void } = {}
): Promise<CleanResult> {
  const editMode: EditMode = opts.mode || "balanced";
  const settings = MODE_PRESETS[editMode];
  const stage = opts.onStage || (() => {});

  stage("Analyzing");
  const original = await getDuration(input);

  let segs: [number, number][] = [];
  let mode: "smart" | "audio" = "audio";
  const audioFiles: string[] = [];

  const key = process.env.DEEPGRAM_API_KEY;
  if (key) {
    try {
      const audio = await extractAudio(input);
      audioFiles.push(audio);
      const words = await transcribe(audio, key);
      if (words.length >= 3) {
        const smart = planFromTranscript(words, original, settings);
        if (smart.length) { segs = smart; mode = "smart"; }
      }
      console.log(`[ENGINE] transcription ok: ${words.length} words -> mode=${mode}, segments=${segs.length}`);
    } catch (e) {
      console.error("[ENGINE] transcription failed, using audio-only fallback:", (e as any)?.message || e);
    }
  } else {
    console.warn("[ENGINE] DEEPGRAM_API_KEY not set — running audio-only (silence) edits only.");
  }

  stage("Detecting pauses");
  if (mode === "audio") {
    let thresholdDb = -32;
    if (settings.silenceThresholdDb === "auto") thresholdDb = clamp((await measureMaxDb(input)) - 30, -45, -20);
    const silences = await detectSilences(input, thresholdDb, settings.minPause);
    segs = planFromSilences(silences, original, settings);
  }

  // Nothing to cut -> keep the whole clip as one segment.
  if (segs.length === 0) segs = [[0, original]];

  stage("Rendering");
  const capped = await renderFinal(input, output, segs, settings, original);
  stage("Finalizing");
  for (const a of audioFiles) await unlink(a).catch(() => {});

  const cleaned = await getDuration(output).catch(() => original);
  const removed = Math.max(0, original - cleaned);
  return {
    original,
    cleaned,
    removed,
    cuts: countCuts(segs, original),
    percentRemoved: original > 0 ? Math.round((removed / original) * 100) : 0,
    segments: segs,
    mode,
    editMode,
    capped,
  };
}
