// ===========================================================================
// TrimIQ Editing Engine — V4
//   Layer 1: Audio intelligence (adaptive silence detection) — fallback only
//   Layer 2: Transcription-driven editing
//     • False-start detection (keep the final take)            [P4]
//     • Word-driven cuts that never clip a word                [P1]
//     • Natural pauses kept, only long dead-air compressed     [P2]
//     • Filler removal (um/uh always; like/so/you-know gated)  [P3]
// ===========================================================================
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// ----------------------------- settings (P7/P6) ----------------------------
export type Settings = {
  silenceThresholdDb: number | "auto";
  minPause: number;
  leadIn: number; // (Layer 1)
  trailOut: number; // (Layer 1)
  naturalPause: number; // [P2] gaps up to here stay as natural rhythm
  wordPad: number; // [P1] max padding into silence around a cut
  minClipLength: number;
  fade: number;
  sentenceGap: number;
  removeFiller: boolean; // [P3] um / uh / er ...
  removeSoftFiller: boolean; // [P3] like / so / you know (only when isolated)
};

export const DEFAULT_SETTINGS: Settings = {
  silenceThresholdDb: "auto",
  minPause: 0.4,
  leadIn: 0.12,
  trailOut: 0.18,
  naturalPause: 0.35,
  wordPad: 0.1,
  minClipLength: 0.2,
  fade: 0.05,
  sentenceGap: 0.6,
  removeFiller: true,
  removeSoftFiller: true,
};

export type CleanResult = {
  original: number;
  cleaned: number;
  removed: number;
  segments: [number, number][];
  thresholdDb: number;
  mode: "smart" | "audio";
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
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
  ]);
  return parseFloat(stdout.trim());
}

// ============================ LAYER 1: audio ===============================
async function measureMaxDb(file: string): Promise<number> {
  const { stderr } = await run(FFMPEG, ["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const m = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/);
  return m ? parseFloat(m[1]) : -3;
}

async function detectSilences(file: string, noiseDb: number, minPause: number): Promise<[number, number][]> {
  const { stderr } = await run(FFMPEG, [
    "-i", file, "-af", `silencedetect=noise=${noiseDb}dB:d=${minPause}`, "-f", "null", "-",
  ]);
  const silences: [number, number][] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[0-9.]+)/);
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (s) start = Math.max(0, parseFloat(s[1]));
    if (e && start !== null) {
      silences.push([start, parseFloat(e[1])]);
      start = null;
    }
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
  "let me say that again", "let me start over", "let me redo", "start over",
  "one more time", "say that again", "let me try again", "take that again", "do that again",
  "let me restart", "let me rephrase", "hold on", "wait no", "let me do that again",
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
    .map((x: any) => ({
      w: norm(x.word),
      term: /[.?!]$/.test(x.punctuated_word || x.word || ""),
      start: x.start,
      end: x.end,
    }))
    .filter((x: Word) => x.w);
}

const mkLine = (ws: Word[]): Line => ({
  words: ws,
  norm: ws.map((x) => x.w),
  start: ws[0].start,
  end: ws[ws.length - 1].end,
  term: ws[ws.length - 1].term,
});

function splitLines(words: Word[], sentenceGap: number): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const next = words[i + 1];
    const bigPause = next && next.start - words[i].end > sentenceGap;
    if (words[i].term || bigPause || !next) {
      lines.push(mkLine(cur));
      cur = [];
    }
  }
  return lines;
}

// Fast restart inside one line: keep from the LAST repeat of the opening.
function collapseRestart(line: Line): Line {
  const n = line.norm;
  if (n.length < 4) return line;
  let last = 0;
  if (n[1] === n[0]) last = 1;
  for (let j = 2; j + 1 < n.length; j++) if (n[j] === n[0] && n[j + 1] === n[1]) last = j;
  return last > 0 ? mkLine(line.words.slice(last)) : line;
}

const stripFiller = (a: string[]) => a.filter((w) => !HARD_FILLER.has(w) && !SOFT_FILLER.has(w));
function isNearPrefix(a: string[], b: string[]): boolean {
  a = stripFiller(a);
  b = stripFiller(b);
  if (a.length < 2 || a.length >= b.length) return false;
  let m = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) m++;
  return m / a.length >= 0.6;
}
function isCorrectionLine(line: Line): boolean {
  const t = line.norm.join(" ");
  if (CORR_PHRASES.some((p) => t.includes(p))) return true;
  return line.norm.length <= 3 && line.norm.some((w) => CORR.has(w));
}

// [P3] Drop filler words from the kept word stream.
function removeFillers(kw: Word[], s: Settings): Word[] {
  if (!s.removeFiller) return kw;
  const out: Word[] = [];
  for (let i = 0; i < kw.length; i++) {
    const w = kw[i].w;
    if (HARD_FILLER.has(w)) continue;
    if (s.removeSoftFiller) {
      const prev = out[out.length - 1];
      const next = kw[i + 1];
      const isolated =
        (!prev || kw[i].start - prev.end > 0.2) && (!next || next.start - kw[i].end > 0.2);
      // "you know" filler pair — isolation measured around the whole pair
      if (w === "you" && next && next.w === "know") {
        const after = kw[i + 2];
        const isoPair =
          (!prev || kw[i].start - prev.end > 0.2) && (!after || after.start - next.end > 0.2);
        if (isoPair || !prev) {
          i++;
          continue;
        }
      }
      if (SOFT_FILLER.has(w) && (isolated || !prev)) continue;
    }
    out.push(kw[i]);
  }
  return out;
}

// The brain: surviving takes -> word-driven keep ranges (P1 + P2 + P3 + P4).
function planFromTranscript(words: Word[], duration: number, s: Settings): [number, number][] {
  let lines = splitLines(words, s.sentenceGap).map(collapseRestart);
  lines = lines.filter((l) => !isCorrectionLine(l)); // remove spoken corrections
  const kept: Line[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && isNearPrefix(lines[i].norm, lines[i + 1].norm)) {
      const a = lines[i].norm.length;
      const b = lines[i + 1].norm.length;
      if (!lines[i].term || a < 0.85 * b) continue; // abandoned take
    }
    kept.push(lines[i]);
  }

  let kw = removeFillers(kept.flatMap((l) => l.words), s); // [P3]
  if (!kw.length) return [];

  // Word-driven segments: never cut into a word; keep short gaps, compress long ones.
  const segs: [number, number][] = [];
  let segStart = Math.max(0, kw[0].start - Math.min(s.wordPad, 0.1));
  for (let i = 0; i < kw.length; i++) {
    const cur = kw[i];
    const next = kw[i + 1];
    if (!next) {
      segs.push([segStart, Math.min(duration, cur.end + Math.min(s.wordPad, 0.12))]);
      break;
    }
    const gap = next.start - cur.end;
    if (gap <= s.naturalPause) continue; // [P2] natural beat — stay in one segment
    const pad = Math.min(s.wordPad, gap * 0.4); // stay strictly inside the silence (P1)
    segs.push([segStart, Math.min(duration, cur.end + pad)]);
    segStart = Math.max(0, next.start - pad);
  }

  const merged: [number, number][] = [];
  for (const r of segs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < 0.02) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged.filter(([a, b]) => b - a >= s.minClipLength);
}

// ============================== rendering ==================================
async function render(input: string, output: string, segs: [number, number][], s: Settings): Promise<void> {
  let filter = "";
  segs.forEach(([a, b], i) => {
    const dur = b - a;
    filter += `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`;
    let ac = `[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (dur > s.fade * 3) {
      ac += `,afade=t=in:st=0:d=${s.fade},afade=t=out:st=${(dur - s.fade).toFixed(3)}:d=${s.fade}`;
    }
    filter += `${ac}[a${i}];`;
  });
  segs.forEach((_, i) => (filter += `[v${i}][a${i}]`));
  filter += `concat=n=${segs.length}:v=1:a=1[outv][outa]`;
  await run(FFMPEG, [
    "-y", "-i", input, "-filter_complex", filter,
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output,
  ]);
}

// ============================== orchestrator ===============================
export async function cleanVideo(
  input: string,
  output: string,
  settings: Settings = DEFAULT_SETTINGS
): Promise<CleanResult> {
  const original = await getDuration(input);
  let segs: [number, number][] = [];
  let mode: "smart" | "audio" = "audio";
  let thresholdDb = typeof settings.silenceThresholdDb === "number" ? settings.silenceThresholdDb : -32;

  const key = process.env.DEEPGRAM_API_KEY;
  if (key) {
    try {
      const audio = await extractAudio(input);
      const words = await transcribe(audio, key);
      if (words.length >= 3) {
        const smart = planFromTranscript(words, original, settings);
        if (smart.length) {
          segs = smart;
          mode = "smart";
        }
      }
    } catch (e) {
      console.error("Layer 2 (transcription) failed, falling back to audio:", e);
    }
  }

  if (mode === "audio") {
    if (settings.silenceThresholdDb === "auto") {
      thresholdDb = clamp((await measureMaxDb(input)) - 30, -45, -20);
    }
    const silences = await detectSilences(input, thresholdDb, settings.minPause);
    segs = planFromSilences(silences, original, settings);
  }

  const nothingToCut =
    segs.length === 0 ||
    (segs.length === 1 && segs[0][0] <= 0.05 && segs[0][1] >= original - 0.05);
  if (nothingToCut) {
    await run(FFMPEG, ["-y", "-i", input, "-c", "copy", output]);
    return { original, cleaned: original, removed: 0, segments: segs, thresholdDb, mode };
  }

  await render(input, output, segs, settings);
  const cleaned = await getDuration(output);
  return { original, cleaned, removed: Math.max(0, original - cleaned), segments: segs, thresholdDb, mode };
}
