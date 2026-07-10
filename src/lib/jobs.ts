// In-memory job store for background video processing. Lives on the long-running
// Node server (next start), so a job keeps running after its POST has returned.
// Projects are kept for the life of the server process (no permanent storage yet).
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";

export type JobStatus = "processing" | "done" | "error";

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
};

// Survive module reloads within the same process.
const g = globalThis as unknown as { __trimiqJobs?: Map<string, Job> };
if (!g.__trimiqJobs) g.__trimiqJobs = new Map<string, Job>();
export const jobs: Map<string, Job> = g.__trimiqJobs;

// Retention: originals are kept on disk so users can regenerate with different
// settings without re-uploading, then cleaned up automatically — 24h for free
// users, 72h for paid plans. (Disk is ephemeral across deploys either way.)
const TTL_FREE = 24 * 60 * 60 * 1000;
const TTL_PAID = 72 * 60 * 60 * 1000;
const MAX_JOBS = 200; // safety cap on memory/disk

export function createJob(email: string, originalName: string, paid = false): Job {
  pruneOld();
  const job: Job = {
    id: randomUUID(),
    email,
    originalName,
    status: "processing",
    stage: "Queued",
    paid,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
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

export function removeJob(id: string) {
  const job = jobs.get(id);
  if (job?.outputPath) unlink(job.outputPath).catch(() => {});
  // Only delete the original if no other job (e.g. a re-edit) still uses it.
  if (job?.inputPath) {
    const shared = Array.from(jobs.values()).some((o) => o.id !== id && o.inputPath === job.inputPath);
    if (!shared) unlink(job.inputPath).catch(() => {});
  }
  jobs.delete(id);
}

// ---- Concurrency gate ------------------------------------------------------
// On a single CPU we process one video at a time. Extra jobs wait their turn,
// which keeps memory predictable and avoids overloading the instance when
// several beta users upload at once.
const gate = (globalThis as unknown as { __trimiqGate?: { active: number; waiters: Array<() => void> } });
if (!gate.__trimiqGate) gate.__trimiqGate = { active: 0, waiters: [] };
const MAX_CONCURRENT = 1;

export async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const g = gate.__trimiqGate!;
  if (g.active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => g.waiters.push(resolve));
  }
  g.active++;
  try {
    return await fn();
  } finally {
    g.active--;
    const next = g.waiters.shift();
    if (next) next();
  }
}

export function queueDepth(): number {
  return gate.__trimiqGate!.waiters.length;
}
