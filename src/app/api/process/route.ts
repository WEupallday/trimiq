import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink, mkdtemp, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanVideo, type EditMode } from "@/lib/clean";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODES: EditMode[] = ["light", "balanced", "aggressive"];

export async function POST(req: NextRequest) {
  let inPath = "";
  let outPath = "";
  try {
    // The video is sent as the raw request body (not multipart) so we can
    // stream it straight to disk without ever holding it all in memory.
    if (!req.body) {
      return NextResponse.json({ error: "No video received." }, { status: 400 });
    }

    const modeRaw = (req.nextUrl.searchParams.get("mode") || "balanced") as EditMode;
    const mode: EditMode = MODES.includes(modeRaw) ? modeRaw : "balanced";

    const dir = await mkdtemp(join(tmpdir(), "trimiq-"));
    const id = randomUUID();
    inPath = join(dir, `${id}-in.mp4`);
    outPath = join(dir, `${id}-out.mp4`);

    await pipeline(Readable.fromWeb(req.body as any), createWriteStream(inPath));

    const { size } = await stat(inPath);
    if (size < 1024) {
      return NextResponse.json({ error: "No video received." }, { status: 400 });
    }

    const result = await cleanVideo(inPath, outPath, { mode, fileBytes: size });
    await unlink(inPath).catch(() => {});
    inPath = "";

    const cleaned = await readFile(outPath);
    return new NextResponse(cleaned, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Disposition": `attachment; filename="trimiq-edit.mp4"`,
        "X-Original-Seconds": result.original.toFixed(2),
        "X-Cleaned-Seconds": result.cleaned.toFixed(2),
        "X-Removed-Seconds": result.removed.toFixed(2),
        "X-Cuts": String(result.cuts),
        "X-Percent-Removed": String(result.percentRemoved),
        "X-Mode": result.editMode,
        "X-Capped": result.capped ? "720" : "",
      },
    });
  } catch (err) {
    console.error("PROCESS ERROR:", err);
    const message = err instanceof Error ? err.message : "Processing failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (inPath) await unlink(inPath).catch(() => {});
    if (outPath) await unlink(outPath).catch(() => {});
  }
}
