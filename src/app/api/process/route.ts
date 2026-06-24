import { NextRequest, NextResponse } from "next/server";
import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanVideo } from "@/lib/clean";

// This route runs on the Node.js server (it needs ffmpeg + the file system),
// not on the lightweight "edge" runtime.
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let inPath = "";
  let outPath = "";
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No video file received." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) {
      return NextResponse.json({ error: "The uploaded file is empty." }, { status: 400 });
    }

    const dir = await mkdtemp(join(tmpdir(), "trimiq-"));
    const id = randomUUID();
    inPath = join(dir, `${id}-in.mp4`);
    outPath = join(dir, `${id}-out.mp4`);

    await writeFile(inPath, bytes);

    const result = await cleanVideo(inPath, outPath);
    const cleaned = await readFile(outPath);

    return new NextResponse(cleaned, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="trimiq-clean.mp4"',
        "X-Original-Seconds": result.original.toFixed(2),
        "X-Cleaned-Seconds": result.cleaned.toFixed(2),
        "X-Removed-Seconds": result.removed.toFixed(2),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (inPath) await unlink(inPath).catch(() => {});
    if (outPath) await unlink(outPath).catch(() => {});
  }
}
