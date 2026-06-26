// Credit accounting, now driven by the subscription plan's monthly edit limit.
import { editLimitFor } from "./plans";

export function creditsLeft(plan: string, editsUsed: number): number {
  const limit = editLimitFor(plan);
  if (!isFinite(limit)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, limit - editsUsed);
}

export function isUnlimited(plan: string): boolean {
  return !isFinite(editLimitFor(plan));
}
