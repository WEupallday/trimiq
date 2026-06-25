// ===========================================================================
// TrimIQ Editing Engine — V2 (Layer 1: Audio Intelligence)
// ---------------------------------------------------------------------------
// Pipeline:
//   1. measureLevels()   - read the recording's actual loudness (for adaptive
//                          thresholding, so background noise doesn't block us)
//   2. detectSilences()  - find non-speech ranges using that adaptive threshold
//   3. planKeepSegments()- turn silences into the speech ranges to KEEP, with
//                          tight trailing cuts + small lead-in (fast but clean)
//   4. render()          - trim + concat the kept ranges with micro-fades
//
// Layer 2 (transcription: bad-take / mistake detection) will plug into step 3
// by refining the keep-list using word timestamps. Kept modular for that.
// ===========================================================================
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// --- Tunable settings (Priority 7). Defaults dialed for fast TikTok pacing. ---
export type Settings = {
  silenceThresholdDb: number | "auto"; // "auto" adapts to each recording's level
  minPause: number; // shortest pause (s) we bother cutting
  leadIn: number; // keep this long BEFORE speech resumes (avoid clipping word starts)
  trailOut: number; // keep this long AFTER speech ends (small = snappy cuts)
  minClipLength: number; // drop kept pieces shorter than this (noise blips)
  fade: number; // micro audio fade at each join (avoid clicks)
};

export const DEFAULT_SETTINGS: Settings = {
  silenceThresholdDb: "auto",
  minPause: 0.3,
  leadIn: 0.08,
  trailOut: 0.12,
  minClipLength: 0.2,
  fade: 0.04,
};

export type CleanResult = {
  original: number;
  cleaned: number;
  removed: number;
  segments: [number, number][];
  thresholdDb: number;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

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

// Measure peak loudness so we can set the silence threshold RELATIVE to the
// actual speech level — this is what lets us cut pauses even with background
// noise, and adapt across quiet vs loud mics (Priority 5).
async function measureMaxDb(file: string): Promise<number> {
  const { stderr } = await run(FFMPEG, ["-i", file, "-af", "volumedetect", "-f", "null", "-"]);
  const m = stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/);
  return m ? parseFloat(m[1]) : -3;
}

async function detectSilences(
  file: string,
  noiseDb: number,
  minPause: number
): Promise<[number, number][]> {
  const { stderr } = await run(FFMPEG, [
    "-i", file,
    "-af", `silencedetect=noise=${noiseDb}dB:d=${minPause}`,
    "-f", "null", "-",
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

// Turn silent ranges into the speech ranges to KEEP.
function planKeepSegments(
  silences: [number, number][],
  duration: number,
  s: Settings
): [number, number][] {
  const segs: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of silences) {
    const keepEnd = a + s.trailOut; // snappy: cut soon after speech ends
    if (keepEnd - cursor > 0.02) segs.push([cursor, Math.min(keepEnd, duration)]);
    cursor = Math.max(cursor, b - s.leadIn); // resume just before next speech
  }
  if (cursor < duration - 0.02) segs.push([cursor, duration]);
  return segs.filter(([x, y]) => y - x >= s.minClipLength);
}

async function render(
  input: string,
  output: string,
  segs: [number, number][],
  s: Settings
): Promise<void> {
  let filter = "";
  segs.forEach(([a, b], i) => {
    const dur = b - a;
    filter += `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`;
    let aChain = `[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (dur > s.fade * 3) {
      aChain += `,afade=t=in:st=0:d=${s.fade},afade=t=out:st=${(dur - s.fade).toFixed(3)}:d=${s.fade}`;
    }
    filter += `${aChain}[a${i}];`;
  });
  segs.forEach((_, i) => (filter += `[v${i}][a${i}]`));
  filter += `concat=n=${segs.length}:v=1:a=1[outv][outa]`;

  await run(FFMPEG, [
    "-y", "-i", input,
    "-filter_complex", filter,
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    output,
  ]);
}

export async function cleanVideo(
  input: string,
  output: string,
  settings: Settings = DEFAULT_SETTINGS
): Promise<CleanResult> {
  const original = await getDuration(input);

  // Adaptive threshold: 30 dB below the loudest speech, clamped to a sane band.
  let thresholdDb: number;
  if (settings.silenceThresholdDb === "auto") {
    const maxDb = await measureMaxDb(input);
    thresholdDb = clamp(maxDb - 30, -45, -20);
  } else {
    thresholdDb = settings.silenceThresholdDb;
  }

  const silences = await detectSilences(input, thresholdDb, settings.minPause);
  const segs = planKeepSegments(silences, original, settings);

  const nothingToCut =
    segs.length === 0 ||
    (segs.length === 1 && segs[0][0] <= 0.05 && segs[0][1] >= original - 0.05);

  if (nothingToCut) {
    await run(FFMPEG, ["-y", "-i", input, "-c", "copy", output]);
    return { original, cleaned: original, removed: 0, segments: segs, thresholdDb };
  }

  await render(input, output, segs, settings);
  const cleaned = await getDuration(output);
  return {
    original,
    cleaned,
    removed: Math.max(0, original - cleaned),
    segments: segs,
    thresholdDb,
  };
}
