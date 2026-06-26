// Credit accounting, driven by the subscription plan's monthly edit limit.
//
// Creator Beta is a SEPARATE track from the free trial: invited creators get a
// larger one-time allowance (CREATOR_BETA_EDITS) regardless of payment. The free
// trial (free plan = 5 edits) is untouched by any of this.
import { editLimitFor } from "./plans";

// Higher than the free trial's 5. Configurable via env (defaults to 15).
export const CREATOR_BETA_EDITS = (() => {
  const n = Number(process.env.CREATOR_BETA_EDITS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15;
})();

// The edit allowance that actually applies to a user. Creator Beta lifts the
// limit to at least CREATOR_BETA_EDITS but never lowers a paid plan's limit.
export function effectiveEditLimit(plan: string, isCreatorBeta = false): number {
  const base = editLimitFor(plan);
  if (!isFinite(base)) return base; // unlimited plans stay unlimited
  return isCreatorBeta ? Math.max(base, CREATOR_BETA_EDITS) : base;
}

export function creditsLeft(plan: string, editsUsed: number, isCreatorBeta = false): number {
  const limit = effectiveEditLimit(plan, isCreatorBeta);
  if (!isFinite(limit)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, limit - editsUsed);
}

export function isUnlimited(plan: string): boolean {
  return !isFinite(editLimitFor(plan));
}
