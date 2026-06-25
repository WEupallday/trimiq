// Free-trial credit accounting. Paid plans are unmetered for now (payments come
// later); the free plan gets a fixed number of edits.
export const FREE_EDIT_LIMIT = 5;
const UNMETERED = 999999;

export function creditsLeft(plan: string, editsUsed: number): number {
  if (plan !== "free") return UNMETERED;
  return Math.max(0, FREE_EDIT_LIMIT - editsUsed);
}

export function isUnlimited(plan: string): boolean {
  return plan !== "free";
}
