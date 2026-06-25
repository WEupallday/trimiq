import { NextRequest, NextResponse } from "next/server";
import { unlink, mkdtemp, stat, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanVideo, type EditMode } from "@/lib/clean";
import { createJob, getJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODES: EditMode[] = ["light", "balanced", "aggressive"];

// POST: receive the upload, start editing in the background, return a job id fast.
// This keeps the HTTP request only as long as the upload itself (no processing),
// so it never trips the platform's per-request timeout.
export async function POST(req: NextRequest) {
  let inPath = "";
  try {
    if (!req.body) {
      return NextResponse.json({ error: "No video received." }, { status: 400 });
    }
    const modeRaw = (req.nextUrl.searchParams.get("mode") || "balanced") as EditMode;
    const mode: EditMode = MODES.includes(modeRaw) ? modeRaw : "balanced";

    const dir = await mkdtemp(join(tmpdir(), "trimiq-"));
    const id = randomUUID();
    inPath = join(dir, `${id}-in.mp4`);
    const outPath = join(dir, `${id}-out.mp4`);

    await pipeline(Readable.fromWeb(req.body as any), createWriteStream(inPath));

    const { size } = await stat(inPath);
    if (size < 1024) {
      await unlink(inPath).catch(() => {});
      return NextResponse.json({ error: "No video received." }, { status: 400 });
    }

    const job = createJob();
    job.inputPath = inPath;
    job.outputPath = outPath;

    // Fire-and-forget: keeps running on the Node server after we respond.
    cleanVideo(inPath, outPath, { mode, fileBytes: size })
      .then((result) => {
        job.status = "done";
        job.stats = {
          original: result.original,
          cleaned: result.cleaned,
          removed: result.removed,
          cuts: result.cuts,
          percent: result.percentRemoved,
          capped: result.capped,
        };
      })
      .catch((err) => {
        console.error("PROCESS ERROR:", err);
        job.status = "error";
        job.error = err instanceof Error ? err.message : "Processing failed.";
      })
      .finally(() => {
        unlink(inPath).catch(() => {});
      });

    return NextResponse.json({ jobId: job.id });
  } catch (err) {
    if (inPath) await unlink(inPath).catch(() => {});
    console.error("UPLOAD ERROR:", err);
    const message = err instanceof Error ? err.message : "Upload failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: poll a job's status, or (with ?download=1) download the finished video.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("jobId");
  if (!id) return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  if (req.nextUrl.searchParams.get("download") === "1") {
    if (job.status !== "done" || !job.outputPath) {
      return NextResponse.json({ error: "Not ready." }, { status: 409 });
    }
    const data = await readFile(job.outputPath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="trimiq-edit.mp4"`,
      },
    });
  }

  return NextResponse.json({
    status: job.status,
    stage: job.stage,
    error: job.error ?? null,
    stats: job.status === "done" ? job.stats : null,
  });
}
