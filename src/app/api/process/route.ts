import { NextRequest, NextResponse } from "next/server";
import { unlink, mkdtemp, stat, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanVideo, type EditMode } from "@/lib/clean";
import { createJob, getJob, runExclusive, queueDepth } from "@/lib/jobs";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { creditsLeft } from "@/lib/credits";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODES: EditMode[] = ["light", "balanced", "aggressive"];

// Hard server-side ceiling. Render has no fixed upload cap, but this protects the
// instance from absurdly large files. The client warns well before this.
const MAX_BYTES = 600 * 1024 * 1024;

// Store a beta user's rating + comment (POST /api/process?feedback=1).
async function handleFeedback(req: NextRequest) {
  try {
    const { rating, comment } = await req.json();
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return NextResponse.json({ error: "Rating must be between 1 and 5." }, { status: 400 });
    }
    const session = await getSession();
    await prisma.feedback.create({
      data: {
        email: session?.email ?? null,
        rating: r,
        comment: typeof comment === "string" ? comment.slice(0, 2000) : null,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("FEEDBACK ERROR:", e);
    return NextResponse.json({ error: "Could not save feedback." }, { status: 500 });
  }
}

// POST: receive the upload, start editing in the background, return a job id fast.
// This keeps the HTTP request only as long as the upload itself (no processing),
// so it never trips the platform's per-request timeout.
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("feedback") === "1") {
    return handleFeedback(req);
  }
  let inPath = "";
  try {
    if (!req.body) {
      return NextResponse.json({ error: "No video received." }, { status: 400 });
    }
    // Require a logged-in user and enforce free-trial credits before any work.
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Please log in to edit videos." }, { status: 401 });
    }
    const user = await prisma.user.findUnique({ where: { email: session.email } });
    const plan = user?.plan ?? "free";
    if (creditsLeft(plan, user?.editsUsed ?? 0) <= 0) {
      return NextResponse.json(
        { error: "You've used all your free edits. Upgrade to keep editing.", outOfCredits: true },
        { status: 402 }
      );
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
    if (size > MAX_BYTES) {
      await unlink(inPath).catch(() => {});
      return NextResponse.json(
        { error: "That video is too large. Please use a clip under 500 MB (record in 1080p, not 4K)." },
        { status: 413 }
      );
    }

    const job = createJob();
    job.inputPath = inPath;
    job.outputPath = outPath;
    if (queueDepth() > 0) job.stage = "Queued";

    // Fire-and-forget: keeps running on the Node server after we respond. The
    // gate ensures only one video is processed at a time.
    runExclusive(() => {
      job.stage = "Processing";
      return cleanVideo(inPath, outPath, { mode, fileBytes: size });
    })
      .then(async (result) => {
        job.status = "done";
        job.stats = {
          original: result.original,
          cleaned: result.cleaned,
          removed: result.removed,
          cuts: result.cuts,
          percent: result.percentRemoved,
          capped: result.capped,
        };
        // Deduct exactly one credit, and only on success.
        await prisma.user
          .update({ where: { email: session.email }, data: { editsUsed: { increment: 1 } } })
          .catch((e) => console.error("CREDIT UPDATE ERROR:", e));
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
