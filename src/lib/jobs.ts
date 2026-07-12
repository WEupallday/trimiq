// ===========================================================================
// TrimIQ processing queue.
//
// Hybrid persistence:
//   - Hot state (file paths, live stage) lives in memory for speed.
//   - Every job row is mirrored to Postgres (QueueJob), so status, stats and
//     batch history SURVIVE server restarts and users closing the tab.
//   - Media files sit on ephemeral disk; after a deploy any job that was
//     still queued/processing is marked failed on boot ("interrupted") and
//     NO credit is charged - credits are only charged on success.
//
// Scheduling: one global gate with per-plan priority weights and
// anti-starvation aging (+1 effective tier per 10 minutes waited), plus
// per-user concurrency slots from the plan config. FIFO within a tier.
// ===========================================================================
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { prisma } from "./db";

export type JobStatus = "queued" | "processing" | "done" | "error";

export type JobStats = {
  original: number;
  cleaned: number;
  removed: number;
  cuts: number;
  percent: number;
  capped: boolean;
  segments?: [number, number][];
  words?: { t: string; s: number; e: number; x: boolean }[];
  keptText?: string;
  fillerRemoved?: number;
  stageMs?: Record<string, number>;
  engine?: string;
  model?: string;
  engineVersion?: string;
  captions?: { color: string; size: string; position: string; style?: string; count: number; coverage: number } | null;
  zooms?: { count: number; intensity: string; frequency: string; notes?: string[] } | null;
};

export type Job = {
  id: string;
  email: string;
  originalName: string;
  status: JobStatus;
  stage: string;
  error?: string;
  inputPath?: string;
  outputPath?: string;
  ownsInput?: boolean;
  paid?: boolean;
  mode?: string;
  instructions?: string;
  applied?: string[];
  stats?: JobStats;
  createdAt: number;
  batchId?: string;
  priority?: number;
};

// Survive module reloads within the same process.
const g = globalThis as unknown as { __trimiqJobs?: Map<string, Job> };
if (!g.__trimiqJobs) g.__trimiqJobs = new Map<string, Job>();
export const jobs: Map<string, Job> = g.__trimiqJobs;

const TTL_FREE = 24 * 60 * 60 * 1000;
const TTL_PAID = 72 * 60 * 60 * 1000;
const MAX_JOBS = 200; // safety cap on memory/disk

// ------------------------------ persistence -------------------------------

// On the first import after a (re)start, fail any rows left queued/processing:
// their files were on the wiped ephemeral disk. Honest + zero credits charged.
const boot = globalThis as unknown as { __trimiqBootSweep?: boolean };
if (!boot.__trimiqBootSweep) {
  boot.__trimiqBootSweep = true;
  prisma.queueJob
    .updateMany({
      where: { status: { in: ["queued", "processing"] } },
      data: {
        status: "error",
        stage: "Failed",
        error: "Processing was interrupted by a server restart. No credit was used - please upload again.",
        finishedAt: new Date(),
      },
    })
    .then((r) => { if (r.count) console.log("[QUEUE] boot sweep failed " + r.count + " interrupted job(s)"); })
    .catch(() => {});
  // Trim ancient history.
  prisma.queueJob
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } })
    .catch(() => {});
}

// Mirror a job's mutable fields to Postgres (fire-and-forget; the queue never
// blocks or fails because of a persistence hiccup).
export function persistJob(job: Job, extra?: { creditCharged?: boolean }) {
  prisma.queueJob
    .update({
      where: { id: job.id },
      data: {
        status: job.status,
        stage: job.stage,
        error: job.error ?? null,
        stats: (job.stats as object) ?? undefined,
        applied: job.applied ?? undefined,
        finishedAt: job.status === "done" || job.status === "error" ? new Date() : null,
        ...(extra?.creditCharged !== undefined ? { creditCharged: extra.creditCharged } : {}),
      },
    })
    .catch(() => {});
}

export function createJob(
  email: string,
  originalName: string,
  opts: { paid?: boolean; batchId?: string; priority?: number; mode?: string; instructions?: string } = {},
): Job {
  pruneOld();
  const job: Job = {
    id: randomUUID(),
    email,
    originalName,
    status: "queued",
    stage: "Queued",
    paid: !!opts.paid,
    mode: opts.mode,
    instructions: opts.instructions,
    batchId: opts.batchId || "",
    priority: opts.priority ?? 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  prisma.queueJob
    .create({
      data: {
        id: job.id, email, name: originalName, status: "queued", stage: "Queued",
        mode: opts.mode ?? null, paid: !!opts.paid, batchId: opts.batchId || "",
        priority: opts.priority ?? 0,
      },
    })
    .catch(() => {});
  return job;
}

function pruneOld() {
  const now = Date.now();
  jobs.forEach((j, id) => {
    if (now - j.createdAt > (j.paid ? TTL_PAID : TTL_FREE)) removeJob(id);
  });
  // If we still have too many, drop the oldest.
  if (jobs.size > MAX_JOBS) {
    const sorted = Array.from(jobs.values()).sort((a, b) => a.createdAt - b.createdAt);
    sorted.slice(0, jobs.size - MAX_JOBS).forEach((j) => removeJob(j.id));
  }
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(email: string): Job[] {
  return Array.from(jobs.values())
    .filter((j) => j.email === email)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Full history for the dashboard: Postgres rows (survive restarts) merged
// with in-memory hot state (live stage + downloadable flags win).
export async function listJobsMerged(email: string): Promise<(Job & { downloadable: boolean })[]> {
  const rows = await prisma.queueJob
    .findMany({ where: { email }, orderBy: { createdAt: "desc" }, take: 60 })
    .catch(() => [] as never[]);
  const out = new Map<string, Job & { downloadable: boolean }>();
  for (const r of rows as Array<Record<string, unknown>>) {
    out.set(r.id as string, {
      id: r.id as string,
      email,
      originalName: r.name as string,
      status: r.status as JobStatus,
      stage: r.stage as string,
      error: (r.error as string) ?? undefined,
      paid: !!r.paid,
      mode: (r.mode as string) ?? undefined,
      applied: (r.applied as string[]) ?? undefined,
      stats: (r.stats as JobStats) ?? undefined,
      createdAt: new Date(r.createdAt as string).getTime(),
      batchId: (r.batchId as string) || "",
      priority: (r.priority as number) ?? 0,
      downloadable: false,
    });
  }
  for (const j of listJobs(email)) {
    out.set(j.id, { ...j, downloadable: !!(j.outputPath && j.status === "done" && existsSync(j.outputPath)) });
  }
  return Array.from(out.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60);
}

export async function ackBatch(email: string, batchId: string) {
  await prisma.queueJob.updateMany({ where: { email, batchId }, data: { acked: true } }).catch(() => {});
  jobs.forEach((j) => { if (j.email === email && j.batchId === batchId) (j as Job & { acked?: boolean }).acked = true; });
}

// Jobs that will consume a credit but haven't yet (credit guard at enqueue).
export async function pendingUnchargedCount(email: string): Promise<number> {
  return prisma.queueJob
    .count({ where: { email, status: { in: ["queued", "processing"] } } })
    .catch(() => 0);
}

export async function batchSizeSoFar(email: string, batchId: string): Promise<number> {
  if (!batchId) return 0;
  return prisma.queueJob.count({ where: { email, batchId } }).catch(() => 0);
}

export function removeJob(id: string) {
  const job = jobs.get(id);
  if (!job) return;
  if (job.inputPath && job.ownsInput !== false) unlink(job.inputPath).catch(() => {});
  if (job.outputPath) unlink(job.outputPath).catch(() => {});
  jobs.delete(id);
}

// ------------------------- priority scheduling gate ------------------------
// Global concurrency (QUEUE_CONCURRENCY env, default 1 on the current single
// instance) + per-user slots from the plan. Waiters are picked by effective
// priority = plan weight + minutes-waited / 10, FIFO within ties, so Free
// jobs always finish (anti-starvation) while paid tiers jump the line.

type Waiter = { priority: number; email: string; slots: number; ts: number; resolve: () => void };
type Gate = { active: number; perUser: Map<string, number>; waiters: Waiter[] };
const gg = globalThis as unknown as { __trimiqGate2?: Gate };
if (!gg.__trimiqGate2) gg.__trimiqGate2 = { active: 0, perUser: new Map(), waiters: [] };
const gate = gg.__trimiqGate2;

const MAX_CONCURRENT = (() => {
  const n = Number(process.env.QUEUE_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
})();

function canRun(email: string, slots: number): boolean {
  return gate.active < MAX_CONCURRENT && (gate.perUser.get(email) || 0) < slots;
}

function take(email: string) {
  gate.active++;
  gate.perUser.set(email, (gate.perUser.get(email) || 0) + 1);
}

function releaseSlot(email: string) {
  gate.active = Math.max(0, gate.active - 1);
  const n = (gate.perUser.get(email) || 1) - 1;
  if (n <= 0) gate.perUser.delete(email);
  else gate.perUser.set(email, n);
  // Wake as many eligible waiters as capacity allows, best-first.
  let woke = true;
  while (woke) {
    woke = false;
    const now = Date.now();
    const eligible = gate.waiters
      .filter((w) => canRun(w.email, w.slots))
      .sort((a, b) => {
        const ea = a.priority + (now - a.ts) / 600000;
        const eb = b.priority + (now - b.ts) / 600000;
        return eb - ea || a.ts - b.ts;
      });
    const next = eligible[0];
    if (next && gate.active < MAX_CONCURRENT) {
      gate.waiters.splice(gate.waiters.indexOf(next), 1);
      take(next.email);
      next.resolve();
      woke = true;
    }
  }
}

export async function runPrioritized<T>(
  priority: number,
  email: string,
  slots: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (canRun(email, slots)) take(email);
  else await new Promise<void>((resolve) => gate.waiters.push({ priority, email, slots, ts: Date.now(), resolve }));
  try {
    return await fn();
  } finally {
    releaseSlot(email);
  }
}

// Current global load (admin dashboard).
export function queueDepth(): number {
  return gate.active + gate.waiters.length;
}

// Back-compat wrapper (benchmark harness): decent priority, own lane.
export async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  return runPrioritized(2, "__system__", 99, fn);
}
