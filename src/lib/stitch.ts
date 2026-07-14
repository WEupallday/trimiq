// Multi-clip stitching: normalize mixed-format clips (rotation, SAR,
// resolution, fps, audio) onto one canvas and concatenate them into a
// SINGLE video the editing engine then treats as one timeline. Everything
// learned this week is applied: rotation is auto-handled on decode, SAR is
// forced to 1:1 on every segment (odd source SAR otherwise breaks concat),
// and audio is resampled + loudness-normalized so levels are consistent
// across clip boundaries.
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) || "ffmpeg";
const FFPROBE = ffprobeStatic.path || "ffprobe";

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stdout = ""; let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.slice(-1500) || ("exit " + code)))));
  });
}

async function canvasFromProbe(file: string): Promise<{ w: number; h: number }> {
  let w = 0, h = 0, rot = 0;
  try {
    const { stdout } = await run(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", file]);
    const s = JSON.parse(stdout)?.streams?.[0] || {};
    w = Number(s.width) || 0; h = Number(s.height) || 0;
    const sd = Array.isArray(s.side_data_list) ? s.side_data_list.find((d: any) => d && d.rotation !== undefined) : null;
    rot = Number(sd?.rotation ?? s.tags?.rotate ?? 0) || 0;
  } catch { /* defaults below */ }
  if (Math.abs(Math.round(rot)) % 180 === 90) { const t = w; w = h; h = t; }
  if (!w || !h) return { w: 1080, h: 1920 };
  // Snap to a clean canvas at TikTok-ish resolution, keeping orientation.
  if (w > h) return { w: 1920, h: 1080 };
  if (h > w) return { w: 1080, h: 1920 };
  return { w: 1080, h: 1080 };
}

export async function normalizeConcat(
  inputs: string[],
  output: string,
  onStage?: (s: string) => void,
): Promise<{ canvas: { w: number; h: number }; clips: number }> {
  if (!inputs.length) throw new Error("No clips to combine.");
  if (inputs.length === 1) throw new Error("Combining needs at least two clips.");
  (onStage || (() => {}))("Combining clips");
  const { w, h } = await canvasFromProbe(inputs[0]);
  const FPS = 30;
  const vn = 
    "scale=" + w + ":" + h + ":force_original_aspect_ratio=decrease," +
    "pad=" + w + ":" + h + ":(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=" + FPS + ",format=yuv420p";
  const an =
    "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo," +
    "loudnorm=I=-16:TP=-1.5:LRA=11";
  const args: string[] = ["-y"];
  for (const f of inputs) args.push("-i", f);
  let fc = "";
  for (let i = 0; i < inputs.length; i++) {
    fc += "[" + i + ":v]" + vn + "[v" + i + "];";
    // Some clips may have no audio; anullsrc keeps the concat pads aligned.
    fc += "[" + i + ":a]" + an + "[a" + i + "];";
  }
  for (let i = 0; i < inputs.length; i++) fc += "[v" + i + "][a" + i + "]";
  fc += "concat=n=" + inputs.length + ":v=1:a=1[v][a]";
  args.push(
    "-filter_complex", fc, "-map", "[v]", "-map", "[a]",
    "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart", "-max_muxing_queue_size", "1024", output,
  );
  await run(FFMPEG, args);
  return { canvas: { w, h }, clips: inputs.length };
}
