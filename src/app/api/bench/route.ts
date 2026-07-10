// ===========================================================================
// Editing-engine benchmark harness (admin-only).
//   POST ?name=&label=&modes=beginner,balanced&models=nova-2,nova-3  (body = video)
//     Runs the engine for every mode x model combo on the same clip, scores each
//     run, persists a BenchmarkRun row per combo (keyed by ENGINE_VERSION), and
//     returns per-video reports in the standard format.
//   GET ?history=1
//     Version-history table (avg overall / time / filler-removal / captions per
//     engine version x model) + recent per-clip reports.
// ===========================================================================
import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdtemp, stat, unlink, readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { cleanVideo, ENGINE_VERSION, type EditMode } from "@/lib/clean";
import { runExclusive } from "@/lib/jobs";
import { requireAdmin } from "@/lib/admin";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;

const HARD = ["um", "umm", "uh", "uhh", "uhm", "erm", "er", "err", "mm", "mmm", "hmm", "hmmm", "ah"];

// Deterministic scoring. Documented penalties so scores are comparable across
// engine versions; adjust ONLY together with a conscious re-baseline.
function score(r: any, processingMs: number) {
  const words: { t: string; s: number; e: number; x: boolean }[] = r.words || [];
  const kept = words.filter((w) => !w.x);
  const remainingList = kept.filter((w) => HARD.includes(w.t));
  const fillerRemaining = remainingList.length;
  const fillerRemoved = r.fillerRemoved || 0;
  const fillerRemovalPct =
    fillerRemoved + fillerRemaining > 0 ? Math.round((fillerRemoved / (fillerRemoved + fillerRemaining)) * 100) : 100;
  const fillerSeconds = words.reduce((t, w) => (w.x ? t + (w.e - w.s) : t), 0);
  const silenceRemovedSec = Math.max(0, r.removed - fillerSeconds);

  // Longest pause the edit left in the kept word stream.
  let longestKeptPauseSec = 0;
  let pauseAt = 0;
  for (let i = 1; i < kept.length; i++) {
    const gap = kept[i].s - kept[i - 1].e;
    if (gap > longestKeptPauseSec) { longestKeptPauseSec = gap; pauseAt = kept[i - 1].e; }
  }

  const issues: string[] = [];
  let overall = 100;
  if (r.mode !== "smart") { overall -= 40; issues.push("transcription unavailable - audio-only fallback used"); }
  if (fillerRemaining > 0) {
    overall -= Math.min(20, fillerRemaining * 5);
    issues.push(`missed ${fillerRemaining} filler word${fillerRemaining === 1 ? "" : "s"} (${remainingList.slice(0, 3).map((w) => `'${w.t}'`).join(", ")})`);
  }
  if (longestKeptPauseSec > 1.2) {
    overall -= Math.min(15, Math.round((longestKeptPauseSec - 1.2) * 10));
    const mm = String(Math.floor(pauseAt / 60)).padStart(2, "0");
    const ss = String(Math.floor(pauseAt % 60)).padStart(2, "0");
    issues.push(`a ${longestKeptPauseSec.toFixed(1)}s pause was kept at ${mm}:${ss}`);
  }
  if (r.percentRemoved > 65) { overall -= 10; issues.push(`removed ${r.percentRemoved}% of the clip - may be over-cut`); }
  if (r.percentRemoved < 3 && r.original > 20) { overall -= 10; issues.push("removed almost nothing - may be under-cut"); }
  if (processingMs > r.original * 1000) { overall -= 5; issues.push("processing slower than realtime"); }
  overall = Math.max(0, Math.min(100, Math.round(overall)));

  // Caption-quality proxy until real captions ship: transcript availability and
  // cleanliness of the kept text (fillers hurt readability).
  const captionScore = r.mode === "smart" ? Math.max(0, 100 - fillerRemaining * 5 - (kept.length < 3 ? 50 : 0)) : 0;

  const takesRemoved = r.takesRemoved ?? 0;
  const report =
    `Overall Score: ${overall}/100. ` +
    `Removed: ${fillerRemoved} filler words, ${silenceRemovedSec.toFixed(1)}s of silence, ${takesRemoved} bad takes. ` +
    `Processing Time: ${(processingMs / 1000).toFixed(1)}s. ` +
    `Issues Found: ${issues.length ? issues.join("; ") : "none"}.`;

  return {
    overall, fillerRemoved, fillerRemaining, fillerRemovalPct,
    silenceRemovedSec: Math.round(silenceRemovedSec * 10) / 10,
    takesRemoved, cuts: r.cuts, percentRemoved: r.percentRemoved,
    originalSec: Math.round(r.original), cleanedSec: Math.round(r.cleaned),
    processingMs, captionScore,
    longestKeptPauseSec: Math.round(longestKeptPauseSec * 10) / 10,
    engine: r.mode, issues, report,
  };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  if (!req.body) return NextResponse.json({ error: "No video received." }, { status: 400 });

  const p = req.nextUrl.searchParams;
  const clipName = (p.get("name") || "clip.mp4").slice(0, 200);
  const label = (p.get("label") || "baseline").slice(0, 100);
  const modes = (p.get("modes") || "balanced")
    .split(",")
    .filter((m): m is EditMode => ["beginner", "balanced", "aggressive"].includes(m));
  const models = (p.get("models") || "nova-2").split(",").filter((m) => /^[a-z0-9-]{2,24}$/.test(m)).slice(0, 3);

  const dir = await mkdtemp(join(tmpdir(), "bench-"));
  const inPath = join(dir, `${randomUUID()}.mp4`);
  await pipeline(Readable.fromWeb(req.body as any), createWriteStream(inPath));
  const { size } = await stat(inPath);
  if (size < 1024) {
    await unlink(inPath).catch(() => {});
    return NextResponse.json({ error: "Empty upload." }, { status: 400 });
  }
  const clipHash = createHash("sha256").update(await readFile(inPath)).digest("hex").slice(0, 16);

  const results: any[] = [];
  try {
    for (const model of models.length ? models : ["nova-2"]) {
      for (const mode of modes.length ? modes : (["balanced"] as EditMode[])) {
        const outPath = join(dir, `${randomUUID()}-out.mp4`);
        const t0 = Date.now();
        const r = await runExclusive(() => cleanVideo(inPath, outPath, { mode, model }));
        const metrics = score(r, Date.now() - t0);
        await unlink(outPath).catch(() => {});
        await prisma.benchmarkRun.create({
          data: { engineVersion: ENGINE_VERSION, label, clipName, clipHash, mode, model, metrics: metrics as any },
        });
        results.push({ mode, model, engineVersion: ENGINE_VERSION, ...metrics });
      }
    }
  } catch (e: any) {
    await unlink(inPath).catch(() => {});
    return NextResponse.json({ error: e?.message || "Benchmark failed.", partial: results }, { status: 500 });
  }
  await unlink(inPath).catch(() => {});
  return NextResponse.json({ clipName, clipHash, engineVersion: ENGINE_VERSION, results });
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const runs = await prisma.benchmarkRun.findMany({ orderBy: { ts: "desc" }, take: 500 });

  // Version history: one row per engineVersion x model (averaged across runs)
  // so regressions between versions are instantly visible.
  const groups = new Map<string, any>();
  for (const r of runs) {
    const m: any = r.metrics;
    const k = `${r.engineVersion}|${r.model}`;
    if (!groups.has(k)) groups.set(k, { engineVersion: r.engineVersion, model: r.model, lastRun: r.ts, overall: [], ms: [], filler: [], caption: [] });
    const g = groups.get(k);
    g.overall.push(m.overall || 0);
    g.ms.push(m.processingMs || 0);
    g.filler.push(m.fillerRemovalPct || 0);
    g.caption.push(m.captionScore || 0);
    if (r.ts > g.lastRun) g.lastRun = r.ts;
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
  const history = Array.from(groups.values())
    .map((g) => ({
      engineVersion: g.engineVersion, model: g.model, lastRun: g.lastRun, runs: g.overall.length,
      overall: avg(g.overall), avgProcessingSec: Math.round(avg(g.ms) / 100) / 10,
      fillerRemovalPct: avg(g.filler), captionScore: avg(g.caption),
    }))
    .sort((a, b) => (a.engineVersion === b.engineVersion ? (a.model < b.model ? -1 : 1) : a.engineVersion < b.engineVersion ? 1 : -1));

  return NextResponse.json({
    engineVersion: ENGINE_VERSION,
    history,
    recent: runs.slice(0, 60).map((r) => ({
      ts: r.ts, engineVersion: r.engineVersion, label: r.label, clipName: r.clipName,
      clipHash: r.clipHash, mode: r.mode, model: r.model, metrics: r.metrics,
    })),
  });
}
