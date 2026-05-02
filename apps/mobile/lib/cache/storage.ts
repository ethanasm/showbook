/**
 * Persistent cache storage abstraction.
 *
 * The cache shadows tRPC + React Query results so the app paints from
 * disk on cold start while a fresh fetch runs in the background. The
 * storage interface is small on purpose: a key/value bag with a
 * timestamp, plus list and clear. Two implementations live alongside
 * it — `sqlite-storage` (production, expo-sqlite) and
 * `memory-storage` (used by tests and any non-RN consumer).
 *
 * Cache keys are produced from React Query keys via `serializeQueryKey`
 * which renders a deterministic JSON string. Object keys are emitted
 * in sorted order so `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` collide as
 * expected.
 */

export interface CacheEntry {
  /** JSON-serialised query result. */
  value: string;
  /** Epoch milliseconds when the entry was written. */
  updatedAt: number;
}

export interface CacheStorage {
  get(key: string): Promise<CacheEntry | null>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Returns every (key, entry) pair. Order is unspecified. */
  entries(): Promise<Array<[string, CacheEntry]>>;
}

export function serializeQueryKey(key: unknown): string {
  return stableStringify(key);
}

export function isFresh(
  entry: CacheEntry,
  ttlMs: number,
  now: number = Date.now(),
): boolean {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return false;
  return now - entry.updatedAt < ttlMs;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}
