// In-memory job store for background video processing. Lives on the long-running
// Node server (next start), so a job keeps running after its POST has returned.
import { randomUUID } from "node:crypto";

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

const MAX_AGE = 30 * 60 * 1000; // 30 minutes

export function createJob(): Job {
  // Opportunistic cleanup of old jobs.
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > MAX_AGE) jobs.delete(id);
  }
  const job: Job = { id: randomUUID(), status: "processing", stage: "Analyzing", createdAt: now };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
