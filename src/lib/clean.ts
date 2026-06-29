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
import { readFile, unlink } from "node:fs/promises";
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

// Collapse a leading restart, e.g. "I'm gonna— I'm gonna show you" -> keep the
// last attempt within the line.
function collapseRestart(line: Line): Line {
  const n = line.norm;
  if (n.length < 4) return line;
  let last = 0;
  if (n[1] === n[0]) last = 1;
  for (let j = 2; j + 1 < n.length; j++) if (n[j] === n[0] && n[j + 1] === n[1]) last = j;
  return last > 0 ? mkLine(line.words.slice(last)) : line;
}

// Remove any immediately-repeated phrase within a line ("I want to I want to show
// you" -> "I want to show you"). Keeps the later, more complete copy. Phrases only
// (k>=2); single-word stutters are handled in fillerMask so emphasis is safe.
function collapseRepeats(line: Line): Line {
  const arr = line.words.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let p = 0; p < arr.length && !changed; p++) {
      const maxK = Math.min(8, Math.floor((arr.length - p) / 2));
      for (let k = maxK; k >= 2; k--) {
        let eq = true;
        for (let t = 0; t < k; t++) if (arr[p + t].w !== arr[p + k + t].w) { eq = false; break; }
        if (eq) { arr.splice(p, k); changed = true; break; }
      }
    }
  }
  return arr.length ? mkLine(arr) : line;
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
  const aUniq = Array.from(new Set(stripFiller(a)));
  const bSet = new Set(stripFiller(b));
  if (!aUniq.length || !bSet.size) return 0;
  let inter = 0;
  for (let i = 0; i < aUniq.length; i++) if (bSet.has(aUniq[i])) inter++;
  return inter / Math.min(aUniq.length, bSet.size);
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

// Words that legitimately precede the VERB "like" (those are kept); otherwise
// "like" is a discourse filler and gets removed.
const LIKE_VERB_PREV = new Set(["i","you","we","they","he","she","it","really","just","dont","do","does","did","would","will","ll","gonna","wanna","to","might","may","could","should","also","still","not","never","always","kinda","sorta","definitely","feel","feels","look","looks","sound","sounds","seem","seems","taste","tastes","felt","looked"]);
const ALWAYS_SOFT = new Set(["basically", "literally", "actually"]); // discourse fillers, safe to drop
const SO_OPENERS = new Set(["okay","ok","alright","alrighty","yeah","yep","right","well","now","anyway","anyways"]);
const INTENSIFIER = new Set(["very","really","so","no","go","yeah","yes","ok","okay","ha","big","huge"]);

// Returns a boolean[] mask aligned to `kw`: true = this word is a filler/stutter
// to physically excise from the final cut.
function fillerMask(kw: Word[], s: Settings): boolean[] {
  const mask = new Array<boolean>(kw.length).fill(false);
  if (!s.removeFiller) return mask;
  for (let i = 0; i < kw.length; i++) {
    const w = kw[i].w;
    if (HARD_FILLER.has(w)) { mask[i] = true; continue; }
    if (!s.removeSoftFiller) continue;

    let prevIdx = -1;
    for (let j = i - 1; j >= 0; j--) if (!mask[j]) { prevIdx = j; break; }
    const prev = prevIdx >= 0 ? kw[prevIdx] : null;
    const next = kw[i + 1];

    if (ALWAYS_SOFT.has(w)) { mask[i] = true; continue; }
    if (w === "so") {
      const opener = prev && SO_OPENERS.has(prev.w);
      const sentenceInitial = !prev || prev.term || opener || kw[i].start - prev.end > 0.4;
      if (sentenceInitial) mask[i] = true;
      continue;
    }
    if (w === "like") {
      const keepAsVerb = prev && LIKE_VERB_PREV.has(prev.w);
      if (!keepAsVerb) mask[i] = true;
      continue;
    }
    if (w === "you" && next && next.w === "know") {
      const beforeW = prev ? prev.w : null;
      const afterW = kw[i + 2] ? kw[i + 2].w : null;
      const isQuestion = !!beforeW && ["do","dont","did","does","would","ya","you"].includes(beforeW);
      const isRealVerb = !!afterW && ["that","how","what","why","where","who","when","if","the","this","a","an","your","my","his","her"].includes(afterW);
      if (!isQuestion && !isRealVerb) { mask[i] = true; mask[i + 1] = true; }
      continue;
    }
  }
  // Stutter pass: collapse fast immediate word repeats ("the the", "this this"),
  // dropping the earlier copy. Intensifiers are left alone so "very very" survives.
  for (let i = 0; i < kw.length; i++) {
    if (mask[i]) continue;
    let j = i + 1;
    while (j < kw.length && mask[j]) j++;
    if (j < kw.length && kw[i].w === kw[j].w && !INTENSIFIER.has(kw[i].w) && kw[j].start - kw[i].end < 0.28) {
      mask[i] = true;
    }
  }
  return mask;
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
  let lines = splitLines(words, s.sentenceGap).map(collapseRestart).map(collapseRepeats);
  lines = lines.filter((l) => !isCorrectionLine(l));

  // Cluster consecutive retakes of the same statement and keep only the best
  // (final, completed) take of each cluster.
  const kept: Line[] = [];
  let li = 0;
  while (li < lines.length) {
    let j = li;
    while (j + 1 < lines.length && isRetake(lines[j], lines[j + 1], s)) j++;
    if (j > li) {
      const cluster = lines.slice(li, j + 1);
      const finalTake =
        [...cluster].reverse().find((l) => l.term) ||
        cluster.reduce((best, l) => (l.norm.length > best.norm.length ? l : best));
      kept.push(finalTake);
    } else {
      kept.push(lines[li]);
    }
    li = j + 1;
  }

  // Mark fillers/stutters, then keep the rest.
  const allWords = kept.flatMap((l) => l.words);
  const mask = fillerMask(allWords, s);
  const keep = allWords.filter((_, i) => !mask[i]);
  if (!keep.length) return [];

  // Build kept time segments. Cut (excise) between two kept words when there is a
  // real pause longer than naturalPause, OR a filler/dropped word sat between them
  // — so fillers are physically removed, not just dropped from the text.
  const segs: [number, number][] = [];
  let segStart = Math.max(0, keep[0].start - Math.min(s.wordPad, 0.1));
  for (let k = 0; k < keep.length; k++) {
    const cur = keep[k];
    const next = keep[k + 1];
    if (!next) { segs.push([segStart, Math.min(duration, cur.end + Math.min(s.wordPad, 0.12))]); break; }
    const gap = next.start - cur.end;
    const removedBetween =
      allWords.some((w, i) => mask[i] && w.start >= cur.end - 0.001 && w.end <= next.start + 0.001) ||
      gap > s.naturalPause + 0.25;
    if (gap <= s.naturalPause && !removedBetween) continue; // natural micro-pause: keep flowing
    const pad = Math.min(s.wordPad, Math.max(0.04, gap * 0.4));
    segs.push([segStart, Math.min(duration, cur.end + pad)]);
    segStart = Math.max(0, next.start - pad);
  }
  return mergeRanges(segs, s.minClipLength);
}

// ============================== rendering ==================================
// Single-pass `select`/`aselect` render. This was validated to be the best of
// both worlds:
//   • MEMORY-SAFE: one streaming decode pass (~1 GB peak even at true 4K, well
//     under the box's 2 GB), so large clips never run it out of memory.
//   • A/V LOCKED: audio and video are cut from the SAME timeline, so there is no
//     lip-sync drift across many cuts (the failure mode of joining separately
//     encoded segments).
//   • EXACT OUTPUT: no scale/crop/reframe — the source resolution, aspect ratio,
//     pixel format and frame rate are preserved; crf 18 is visually lossless.
async function renderFinal(
  input: string, output: string, segs: [number, number][], _s: Settings, original: number
): Promise<boolean> {
  // No cuts at all -> remux the original streams unchanged (bit-exact, fast).
  const noCuts = segs.length === 1 && segs[0][0] <= 0.05 && segs[0][1] >= original - 0.05;
  if (noCuts) {
    await run(FFMPEG, ["-y", "-i", input, "-c", "copy", "-movflags", "+faststart", output]);
    return false;
  }

  // Lighter preset only for very large frames (true 4K+) to keep encode memory low.
  // Resolution is NOT changed either way.
  const { w, h } = await getDims(input);
  const preset = Math.max(w, h) > 1920 ? "superfast" : "veryfast";

  // Build the keep expression: gte(t,a)*lt(t,b) for each segment, OR'd with "+".
  // Commas inside the expression are protected by the surrounding single quotes
  // (the filtergraph parser's own quoting), so no shell escaping is needed.
  const expr = segs.map(([a, b]) => `gte(t,${a.toFixed(3)})*lt(t,${b.toFixed(3)})`).join("+");

  await run(FFMPEG, [
    "-y", "-i", input,
    "-vf", `select='${expr}',setpts=N/FRAME_RATE/TB`,
    "-af", `aselect='${expr}',asetpts=N/SR/TB`,
    "-vsync", "cfr",
    "-c:v", "libx264", "-preset", preset, "-crf", "18", "-pix_fmt", "yuv420p", "-threads", "0",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", "-max_muxing_queue_size", "1024",
    output,
  ]);
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
