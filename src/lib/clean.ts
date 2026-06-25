// TrimIQ core cleaning engine.
// Detects silent/dead sections of a video and removes them, keeping A/V in sync.
// Uses bundled ffmpeg/ffprobe binaries so nothing extra needs to be installed.
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

// Tunables — tuned to avoid clipping words while still catching pauses.
const NOISE_DB = -32; // a bit lower so quiet speech isn't mistaken for silence
const MIN_SILENCE = 0.4; // catch shorter pauses too (seconds)
const TAIL_PAD = 0.15; // keep this much AFTER speech ends (don't clip word endings)
const LEAD_PAD = 0.18; // resume this much BEFORE speech restarts (don't clip word starts)
const FADE = 0.045; // short audio fade at each join to smooth the cut

export type CleanResult = {
  original: number;
  cleaned: number;
  removed: number;
  segments: [number, number][];
};

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

async function detectSilences(file: string): Promise<[number, number][]> {
  const { stderr } = await run(FFMPEG, [
    "-i", file,
    "-af", `silencedetect=noise=${NOISE_DB}dB:d=${MIN_SILENCE}`,
    "-f", "null", "-",
  ]);
  const silences: [number, number][] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = line.match(/silence_start:\s*([0-9.]+)/);
    const e = line.match(/silence_end:\s*([0-9.]+)/);
    if (s) start = parseFloat(s[1]);
    if (e && start !== null) {
      silences.push([start, parseFloat(e[1])]);
      start = null;
    }
  }
  return silences;
}

function keepSegments(silences: [number, number][], duration: number): [number, number][] {
  const segs: [number, number][] = [];
  let cursor = 0;
  for (const [s, e] of silences) {
    const keepStart = cursor;
    const keepEnd = s + TAIL_PAD;
    if (keepEnd - keepStart > 0.05) segs.push([keepStart, Math.min(keepEnd, duration)]);
    cursor = Math.max(cursor, e - LEAD_PAD);
  }
  if (cursor < duration - 0.05) segs.push([cursor, duration]);
  return segs.filter(([a, b]) => b - a > 0.05);
}

export async function cleanVideo(input: string, output: string): Promise<CleanResult> {
  const original = await getDuration(input);
  const silences = await detectSilences(input);
  const segs = keepSegments(silences, original);

  const nothingToCut =
    segs.length === 0 ||
    (segs.length === 1 && segs[0][0] <= 0.06 && segs[0][1] >= original - 0.06);

  if (nothingToCut) {
    await run(FFMPEG, ["-y", "-i", input, "-c", "copy", output]);
    return { original, cleaned: original, removed: 0, segments: segs };
  }

  let filter = "";
  segs.forEach(([a, b], i) => {
    const dur = b - a;
    filter += `[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`;
    let aChain = `[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS`;
    if (dur > FADE * 3) {
      aChain += `,afade=t=in:st=0:d=${FADE},afade=t=out:st=${(dur - FADE).toFixed(3)}:d=${FADE}`;
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

  const cleaned = await getDuration(output);
  return { original, cleaned, removed: Math.max(0, original - cleaned), segments: segs };
}
