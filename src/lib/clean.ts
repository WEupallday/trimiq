// ===========================================================================
// TrimIQ Editing Engine — V5 (premium)
//   • Transcription-driven cuts (false starts, fillers, natural pauses, no clip)
//   • Editing modes: light / balanced / aggressive
//   • B-roll protection: preserve silent moments that have visual motion
//   • Style pass: auto-reframe to 9:16, subtle animated zoom
//   • Export presets: TikTok / Reels / Shorts
//   • Returns edit statistics
// ===========================================================================
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// ------------------------------ modes (P5) ---------------------------------
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
    silenceThresholdDb: "auto", minPause: 0.4, leadIn: 0.12, trailOut: 0.18,
    naturalPause: 0.35, wordPad: 0.1, minClipLength: 0.2, fade: 0.05,
    sentenceGap: 0.6, removeFiller: true, removeSoftFiller: true,
    nearPrefixThresh: 0.6, dropRatio: 0.85,
  },
  aggressive: {
    silenceThresholdDb: "auto", minPause: 0.25, leadIn: 0.09, trailOut: 0.13,
    naturalPause: 0.22, wordPad: 0.08, minClipLength: 0.18, fade: 0.04,
    sentenceGap: 0.45, removeFiller: true, removeSoftFiller: true,
    nearPrefixThresh: 0.55, dropRatio: 0.95,
  },
};

// --------------------------- export presets (P4) ---------------------------
export type ExportFormat = "tiktok" | "reels" | "shorts";

export const FORMAT_PRESETS: Record<ExportFormat, { w: number; h: number; fps: number; crf: number; audioKbps: number }> = {
  tiktok: { w: 1080, h: 1920, fps: 30, crf: 23, audioKbps: 128 },
  reels: { w: 1080, h: 1920, fps: 30, crf: 21, audioKbps: 160 },
  shorts: { w: 1080, h: 1920, fps: 30, crf: 20, audioKbps: 192 },
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
  format: ExportFormat;
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
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `exit ${code}`))
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
  "let me rephrase", "hold on", "wait no", "let me do that again",
];

async function extractAudio(input: string): Promise<string> {
  const out = join(dirname(input), `audio-${Date.now()}.wav`);
  await run(FFMPEG, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", out]);
  return out;
}

async function transcribe(audioPath: string, apiKey: string): Promise<Word[]> {
  const bytes = await readFile(audioPath);
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
    { method: "POST", headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" }, body: bytes }
  );
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const words = json?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return words
    .map((x: any) => ({ w: norm(x.word), term: /[.?!]$/.test(x.punctuated_word || x.word || ""), start: x.start, end: x.end }))
    .filter((x: Word) => x.w);
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

function planFromTranscript(words: Word[], duration: number, s: Settings): [number, number][] {
  let lines = splitLines(words, s.sentenceGap).map(collapseRestart);
  lines = lines.filter((l) => !isCorrectionLine(l));
  const kept: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && isNearPrefix(lines[i].norm, lines[i + 1].norm, s.nearPrefixThresh)) {
      const a = lines[i].norm.length;
      const b = lines[i + 1].norm.length;
      if (!lines[i].term || a < s.dropRatio * b) continue;
    }
    kept.push(lines[i]);
  }
  let kw = removeFillers(kept.flatMap((l) => l.words), s);
  if (!kw.length) return [];
  const segs: [number, number][] = [];
  let segStart = Math.max(0, kw[0].start - Math.min(s.wordPad, 0.1));
  for (let i = 0; i < kw.length; i++) {
    const cur = kw[i];
    const next = kw[i + 1];
    if (!next) { segs.push([segStart, Math.min(duration, cur.end + Math.min(s.wordPad, 0.12))]); break; }
    const gap = next.start - cur.end;
    if (gap <= s.naturalPause) continue;
    const pad = Math.min(s.wordPad, gap * 0.4);
    segs.push([segStart, Math.min(duration, cur.end + pad)]);
    segStart = Math.max(0, next.start - pad);
  }
  return mergeRanges(segs, s.minClipLength);
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

// ===================== B-ROLL protection (P3) ==============================
// Find timestamps with visual motion (scene changes). Used to preserve
// non-speech moments where the product is being shown / moved.
async function getMotionTimes(input: string): Promise<number[]> {
  const meta = join(dirname(input), `motion-${Date.now()}.txt`);
  try {
    // Write only scene-change frames' metadata to a file (tiny, memory-safe).
    await run(FFMPEG, [
      "-i", input, "-vf", `select='gt(scene,0.06)',metadata=print:file=${meta}`, "-an", "-f", "null", "-",
    ]);
    const txt = await readFile(meta, "utf8").catch(() => "");
    const times: number[] = [];
    const re = /pts_time:([0-9.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) times.push(parseFloat(m[1]));
    return times;
  } catch {
    return [];
  } finally {
    await unlink(meta).catch(() => {});
  }
}

// Add back removed gaps that contain real motion (likely a product showcase).
async function protectBRoll(input: string, segs: [number, number][], duration: number): Promise<[number, number][]> {
  const motion = await getMotionTimes(input);
  if (!motion.length) return segs;
  // Complement = removed regions.
  const removed: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of segs) {
    if (a - cursor > 0.05) removed.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (duration - cursor > 0.05) removed.push([cursor, duration]);
  const preserve: [number, number][] = [];
  for (const [a, b] of removed) {
    if (b - a < 1.2) continue; // only consider meaningful gaps
    const hits = motion.filter((t) => t >= a && t <= b).length;
    if (hits / (b - a) >= 0.4) preserve.push([a, b]); // motion-dense → keep
  }
  return preserve.length ? mergeRanges([...segs, ...preserve], 0.18) : segs;
}

// ============================== rendering ==================================
// Pass A: cut + concat at original resolution (audio fades for clean joins).
async function renderCut(input: string, output: string, segs: [number, number][], s: Settings): Promise<void> {
  let filter = "";
  segs.forEach(([a, b], i) => {
    const dur = b - a;
    filter += `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`;
    let ac = `[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (dur > s.fade * 3) ac += `,afade=t=in:st=0:d=${s.fade},afade=t=out:st=${(dur - s.fade).toFixed(3)}:d=${s.fade}`;
    filter += `${ac}[a${i}];`;
  });
  segs.forEach((_, i) => (filter += `[v${i}][a${i}]`));
  filter += `concat=n=${segs.length}:v=1:a=1[outv][outa]`;
  await run(FFMPEG, [
    "-y", "-i", input, "-filter_complex", filter, "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "192k", output,
  ]);
}

// Pass B: auto-reframe to 9:16 (P2) + subtle animated zoom (P1) + export preset (P4).
async function renderStyle(input: string, output: string, format: ExportFormat): Promise<void> {
  const f = FORMAT_PRESETS[format];
  const { w, h } = await getDims(input);
  const wide = w / h > 9 / 16 + 0.01;
  // Reframe: crop a centered 9:16 window from wide video, else fill the frame.
  const reframe = wide
    ? `crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=${f.w}:${f.h}`
    : `scale=${f.w}:${f.h}:force_original_aspect_ratio=increase,crop=${f.w}:${f.h}`;
  // Subtle, smooth zoom that gently breathes in and out, always centered.
  const zoom =
    `zoompan=z='1.04+0.04*sin(on/45)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:fps=${f.fps}:s=${f.w}x${f.h}`;
  await run(FFMPEG, [
    "-y", "-i", input, "-vf", `${reframe},${zoom}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", String(f.crf), "-pix_fmt", "yuv420p", "-r", String(f.fps),
    "-c:a", "aac", "-b:a", `${f.audioKbps}k`, "-movflags", "+faststart", output,
  ]);
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
  opts: { mode?: EditMode; format?: ExportFormat } = {}
): Promise<CleanResult> {
  const editMode: EditMode = opts.mode || "balanced";
  const format: ExportFormat = opts.format || "tiktok";
  const settings = MODE_PRESETS[editMode];

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
    } catch (e) {
      console.error("Layer 2 failed, falling back to audio:", e);
    }
  }

  if (mode === "audio") {
    let thresholdDb = -32;
    if (settings.silenceThresholdDb === "auto") thresholdDb = clamp((await measureMaxDb(input)) - 30, -45, -20);
    const silences = await detectSilences(input, thresholdDb, settings.minPause);
    segs = planFromSilences(silences, original, settings);
  }

  // B-roll protection (P3) — preserve motion-rich non-speech moments.
  // Temporarily disabled: the per-frame motion scan is too heavy for the
  // 512MB instance. Re-enabled below via a memory-safe, file-based scan.
  if (process.env.ENABLE_BROLL === "1") {
    try { segs = await protectBRoll(input, segs, original); } catch { /* keep segs */ }
  }

  const cutFile = join(dirname(output), `cut-${Date.now()}.mp4`);
  const nothingToCut =
    segs.length === 0 || (segs.length === 1 && segs[0][0] <= 0.05 && segs[0][1] >= original - 0.05);

  if (nothingToCut) {
    await run(FFMPEG, ["-y", "-i", input, "-c", "copy", cutFile]);
  } else {
    await renderCut(input, cutFile, segs, settings);
  }

  // Style pass: reframe + zoom + export preset.
  await renderStyle(cutFile, output, format);
  await unlink(cutFile).catch(() => {});
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
    format,
  };
}
