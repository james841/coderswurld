/**
 * A small in-process rate limiter.
 *
 * Deliberately not Redis. This guards login endpoints on a single-instance
 * deployment, and an in-memory counter is both faster and one less thing that
 * can be down when someone is trying to open their shop. If this ever runs
 * behind more than one Node process the limit becomes per-process, which is a
 * weaker guarantee but still stops the only attack that matters here: a script
 * hammering one email address with a password list.
 *
 * The window is fixed rather than sliding. A fixed window can let through up to
 * 2× the limit across a boundary; for login throttling that is irrelevant, and
 * it costs one integer instead of an array of timestamps per key.
 */

interface Bucket {
  count: number;
  /** Epoch ms when this window ends and the count resets. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Buckets are only ever created on a failed login, so the map stays tiny. Still,
 * sweep it occasionally so a long-running server doesn't accumulate keys for
 * addresses that were typo'd once six weeks ago.
 */
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Attempts left in the current window. */
  remaining: number;
  /** Whole seconds until the window resets. */
  retryAfterSeconds: number;
}

/**
 * Count one attempt against `key`.
 *
 * Call this *before* doing the expensive work, and call `clearRateLimit` on
 * success so a legitimate user who mistypes twice and then gets it right starts
 * clean rather than carrying a strike into tomorrow.
 */
export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { ok: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > options.limit) {
    return { ok: false, remaining: 0, retryAfterSeconds };
  }
  return {
    ok: true,
    remaining: options.limit - existing.count,
    retryAfterSeconds,
  };
}

export function clearRateLimit(key: string) {
  buckets.delete(key);
}

/** The client IP, as far as it can be trusted behind a proxy. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
