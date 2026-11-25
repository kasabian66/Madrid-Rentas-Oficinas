// Minimal in-memory fixed-window rate limiter.
// Limitation: state lives in each serverless instance, so this is a best-effort brake against
// accidental or casual abuse of the search endpoint (and the free Tavily quota), not a hard guarantee.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const SEARCH_LIMIT = 5;          // requests
export const SEARCH_WINDOW_MS = 60_000; // per minute, per client

export function rateLimit(
  key: string,
  now: number = Date.now(),
  limit: number = SEARCH_LIMIT,
  windowMs: number = SEARCH_WINDOW_MS,
): { ok: boolean; remaining: number; retryAfter: number } {
  // Drop expired buckets so the map cannot grow without bound.
  if (buckets.size > 500) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }
  current.count += 1;
  if (current.count > limit) {
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  return { ok: true, remaining: limit - current.count, retryAfter: 0 };
}

export function resetRateLimit(): void {
  buckets.clear();
}
