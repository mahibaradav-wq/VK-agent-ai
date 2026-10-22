type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export const AUTH_RATE_LIMITS = {
  login: { limit: 8, windowMs: 15 * 60 * 1000 },
  register: { limit: 20, windowMs: 15 * 60 * 1000 },
  reset: { limit: 5, windowMs: 15 * 60 * 1000 },
  contact: { limit: 8, windowMs: 15 * 60 * 1000 },
} as const;

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }
  if (current.count >= limit) {
    return { ok: false, remaining: 0 };
  }
  current.count += 1;
  return { ok: true, remaining: limit - current.count };
}

export function resetRateLimits() {
  buckets.clear();
}
