import { TRPCError } from '@trpc/server';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

function check(key: string, opts: RateLimitOptions): boolean {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return true;
  }
  if (existing.count >= opts.max) return false;
  existing.count += 1;
  return true;
}

export function enforceRateLimit(key: string, opts: RateLimitOptions): void {
  if (!check(key, opts)) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded; please slow down.',
    });
  }
}

export function isRateLimited(key: string, opts: RateLimitOptions): boolean {
  return !check(key, opts);
}

if (typeof setInterval !== 'undefined') {
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  if (typeof sweep.unref === 'function') sweep.unref();
}
