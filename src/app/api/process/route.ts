import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink, mkdtemp } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanVideo, type EditMode, type ExportFormat } from "@/lib/clean";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODES: EditMode[] = ["light", "balanced", "aggressive"];
const FORMATS: ExportFormat[] = ["tiktok", "reels", "shorts"];

export async function POST(req: NextRequest) {
  let inPath = "";
  let outPath = "";
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No video file received." }, { status: 400 });
    }

    const modeRaw = String(form.get("mode") || "balanced") as EditMode;
    const formatRaw = String(form.get("format") || "tiktok") as ExportFormat;
    const mode: EditMode = MODES.includes(modeRaw) ? modeRaw : "balanced";
    const format: ExportFormat = FORMATS.includes(formatRaw) ? formatRaw : "tiktok";

    const dir = await mkdtemp(join(tmpdir(), "trimiq-"));
    const id = randomUUID();
    inPath = join(dir, `${id}-in.mp4`);
    outPath = join(dir, `${id}-out.mp4`);

    // Stream the upload straight to disk (no full-video Buffer held in memory).
    await pipeline(Readable.fromWeb((file as File).stream() as any), createWriteStream(inPath));

    const result = await cleanVideo(inPath, outPath, { mode, format });
    // Free the input file before sending the response.
    await unlink(inPath).catch(() => {});
    inPath = "";

    const cleaned = await readFile(outPath);
    return new NextResponse(cleaned, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="trimiq-${format}.mp4"`,
        "X-Original-Seconds": result.original.toFixed(2),
        "X-Cleaned-Seconds": result.cleaned.toFixed(2),
        "X-Removed-Seconds": result.removed.toFixed(2),
        "X-Cuts": String(result.cuts),
        "X-Percent-Removed": String(result.percentRemoved),
        "X-Mode": result.editMode,
        "X-Format": result.format,
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
