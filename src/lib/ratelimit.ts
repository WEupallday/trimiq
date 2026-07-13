// Tiny in-memory rate limiter (per-process). Good enough for a single
// instance; swap for a shared store (Redis/Upstash) when scaling out.
const g = globalThis as unknown as { __tiqRl?: Map<string, number[]> };
if (!g.__tiqRl) g.__tiqRl = new Map();
const buckets = g.__tiqRl!;

// Returns true if the call is allowed, false if the key is over its limit.
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  // Opportunistic cleanup so the map never grows unbounded.
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
    }
  }
  return true;
}

// Best-effort client IP behind the Render proxy.
export function clientIp(req: { headers: { get(n: string): string | null } }): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  return xf.split(",")[0].trim() || "unknown";
}
