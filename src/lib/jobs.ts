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
  stats?: JobStats;
  createdAt: number;
};

// Survive module reloads within the same process.
const g = globalThis as unknown as { __trimiqJobs?: Map<string, Job> };
if (!g.__trimiqJobs) g.__trimiqJobs = new Map<string, Job>();
export const jobs: Map<string, Job> = g.__trimiqJobs;

// Keep recent projects available for the whole server session (best-effort).
const MAX_AGE = 12 * 60 * 60 * 1000; // 12 hours
const MAX_JOBS = 200; // safety cap on memory/disk

export function createJob(email: string, originalName: string): Job {
  pruneOld();
  const job: Job = {
    id: randomUUID(),
    email,
    originalName,
    status: "processing",
    stage: "Queued",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

function pruneOld() {
  const now = Date.now();
  jobs.forEach((j, id) => {
    if (now - j.createdAt > MAX_AGE) removeJob(id);
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
  if (job?.inputPath) unlink(job.inputPath).catch(() => {});
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
