// ===========================================================================
// TrimIQ Editing Engine — V2
//   Layer 1: Audio intelligence (adaptive silence detection, tight cuts)
//   Layer 2: Speech understanding via transcription (bad takes + mistakes)
//
// If DEEPGRAM_API_KEY is set, Layer 2 runs and produces a "human-edited" cut
// (removes restarts, false starts, and spoken corrections). If the key is
// missing OR anything fails, we safely fall back to Layer 1 so the editor
// always returns a clean result.
// ===========================================================================
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// ----------------------------- settings (P7) -------------------------------
export type Settings = {
  silenceThresholdDb: number | "auto";
  minPause: number; // shortest pause (s) we cut
  leadIn: number; // keep before speech (avoid clipping word starts)
  trailOut: number; // keep after speech (small = snappy)
  minClipLength: number; // drop kept pieces shorter than this
  fade: number; // micro audio fade at joins
  utteranceGap: number; // gap (s) that separates one utterance from the next
};

export const DEFAULT_SETTINGS: Settings = {
  silenceThresholdDb: "auto",
  minPause: 0.4, // only cut pauses longer than this — leaves short natural beats
  leadIn: 0.12, // a touch more air before speech resumes
  trailOut: 0.18, // a touch more air after speech ends (gentler cuts)
  minClipLength: 0.2,
  fade: 0.05,
  utteranceGap: 0.45,
};

export type CleanResult = {
  original: number;
  cleaned: number;
  removed: number;
  segments: [number, number][];
  thresholdDb: number;
  mode: "smart" | "audio"; // smart = transcription used
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

// ======================= LAYER 2: speech understanding =====================
type Word = { w: string; start: number; end: number };
type Utterance = { words: string[]; start: number; end: number };

const CORRECTION = new Set([
  "no", "nope", "wait", "sorry", "oops", "scratch", "redo", "nevermind", "nvm",
  "actually", "hold", "ugh", "hmm",
]);

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

// Extract mono 16 kHz wav (small, ideal for speech-to-text).
async function extractAudio(input: string): Promise<string> {
  const out = join(dirname(input), `audio-${Date.now()}.wav`);
  await run(FFMPEG, ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", out]);
  return out;
}

async function transcribe(audioPath: string, apiKey: string): Promise<Word[]> {
  const bytes = await readFile(audioPath);
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
    {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
      body: bytes,
    }
  );
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const words = json?.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
  return words.map((w: any) => ({ w: norm(w.word), start: w.start, end: w.end }));
}

function groupUtterances(words: Word[], gap: number): Utterance[] {
  const out: Utterance[] = [];
  let cur: Word[] = [];
  for (let i = 0; i < words.length; i++) {
    if (cur.length && words[i].start - cur[cur.length - 1].end > gap) {
      out.push(toUtt(cur));
      cur = [];
    }
    cur.push(words[i]);
  }
  if (cur.length) out.push(toUtt(cur));
  return out;
}
function toUtt(ws: Word[]): Utterance {
  return { words: ws.map((x) => x.w).filter(Boolean), start: ws[0].start, end: ws[ws.length - 1].end };
}

const isPrefix = (a: Utterance, b: Utterance) =>
  a.words.length >= 2 &&
  a.words.length < b.words.length &&
  b.words.slice(0, a.words.length).join(" ") === a.words.join(" ");

const sharesStart = (a: Utterance, b: Utterance) =>
  a.words.length >= 2 && b.words.length >= 2 && a.words[0] === b.words[0] && a.words[1] === b.words[1];

const isCorrection = (u: Utterance) =>
  u.words.length > 0 && u.words.length <= 3 && u.words.filter((w) => CORRECTION.has(w)).length >= 1;

// Decide which utterances to KEEP (drop abandoned takes + corrections).
function keepUtterances(utts: Utterance[]): Utterance[] {
  const drop = new Array(utts.length).fill(false);
  for (let i = 0; i < utts.length; i++) {
    // P2: an utterance that's just the start of the next one = abandoned take.
    if (i + 1 < utts.length && isPrefix(utts[i], utts[i + 1])) drop[i] = true;
    // P3: a spoken correction ("no", "wait"...) — drop it, and drop the aborted
    // attempt right before it if the next attempt restarts the same sentence.
    if (isCorrection(utts[i])) {
      drop[i] = true;
      if (i > 0 && i + 1 < utts.length && sharesStart(utts[i - 1], utts[i + 1])) drop[i - 1] = true;
    }
    // Near-duplicate restart: same opening, earlier one shorter = aborted.
    if (i + 1 < utts.length && sharesStart(utts[i], utts[i + 1]) && utts[i].words.length < utts[i + 1].words.length) {
      drop[i] = true;
    }
  }
  return utts.filter((_, i) => !drop[i]);
}

function planFromUtterances(utts: Utterance[], duration: number, s: Settings): [number, number][] {
  const ranges = utts
    .map((u) => [Math.max(0, u.start - s.leadIn), Math.min(duration, u.end + s.trailOut)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  // Merge ranges that overlap or sit within minPause of each other (natural flow).
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < s.minPause) last[1] = Math.max(last[1], r[1]);
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

  // ---- Layer 2 (smart) if a transcription key is configured ----
  const key = process.env.DEEPGRAM_API_KEY;
  if (key) {
    try {
      const audio = await extractAudio(input);
      const words = await transcribe(audio, key);
      if (words.length >= 3) {
        const utts = keepUtterances(groupUtterances(words, settings.utteranceGap));
        const smart = planFromUtterances(utts, original, settings);
        if (smart.length) {
          segs = smart;
          mode = "smart";
        }
      }
    } catch (e) {
      console.error("Layer 2 (transcription) failed, falling back to audio:", e);
    }
  }

  // ---- Layer 1 (audio) fallback / default ----
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
