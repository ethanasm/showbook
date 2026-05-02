/**
 * In-memory `CacheStorage` for tests and non-RN environments. Not
 * thread-safe and not persisted; throw it away when the process exits.
 */

import type { CacheEntry, CacheStorage } from './storage';

export function createMemoryStorage(): CacheStorage {
  const map = new Map<string, CacheEntry>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, entry) {
      map.set(key, entry);
    },
    async delete(key) {
      map.delete(key);
    },
    async clear() {
      map.clear();
    },
    async entries() {
      return Array.from(map.entries());
    },
  };
}
