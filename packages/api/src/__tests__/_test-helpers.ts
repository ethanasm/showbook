/**
 * Shared scaffolding for integration tests. All helpers operate on the DB
 * pointed at by DATABASE_URL (see CLAUDE.md — integration tests run
 * against the showbook_e2e database via the `test:integration` script).
 *
 * Conventions:
 *   - Every test creates rows with deterministic IDs prefixed by the
 *     caller's `prefix` so cleanup is reliable.
 *   - cleanupByPrefix wipes everything that matches the prefix across all
 *     mutation-touching tables.
 */

import {
  db,
  performers,
  showPerformers,
  shows,
  users,
  venues,
  mediaAssets,
  mediaAssetPerformers,
  userVenueFollows,
  userPerformerFollows,
  userRegions,
  announcements,
  showAnnouncementLinks,
} from '@showbook/db';
import { sql, like, eq } from 'drizzle-orm';
import { appRouter } from '../root';
import { createContext } from '../trpc';

export function callerFor(userId: string) {
  return appRouter.createCaller(createContext({ session: { user: { id: userId } } }));
}

export async function createTestUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local` }).onConflictDoNothing();
}

export async function createTestVenue(opts: {
  id: string;
  name: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  stateRegion?: string | null;
}): Promise<void> {
  await db
    .insert(venues)
    .values({
      id: opts.id,
      name: opts.name,
      city: opts.city,
      country: 'US',
      latitude: opts.latitude ?? null,
      longitude: opts.longitude ?? null,
      stateRegion: opts.stateRegion ?? null,
    })
    .onConflictDoNothing();
}

export async function createTestShow(opts: {
  id: string;
  userId: string;
  venueId: string;
  date?: string;
  kind?: 'concert' | 'theatre' | 'comedy' | 'festival';
  state?: 'past' | 'ticketed' | 'watching';
}): Promise<void> {
  await db
    .insert(shows)
    .values({
      id: opts.id,
      userId: opts.userId,
      venueId: opts.venueId,
      date: opts.date ?? '2026-08-01',
      kind: opts.kind ?? 'concert',
      state: opts.state ?? 'ticketed',
    })
    .onConflictDoNothing();
}

/**
 * Cleanup helper. Deletes every row whose id (or referenced id) starts with
 * `prefix` across the workspace's tables. Order matters: child tables
 * before parents to satisfy FKs.
 */
export async function cleanupByPrefix(prefix: string): Promise<void> {
  const p = `${prefix}%`;
  // Delete media link rows for assets we created.
  await db.execute(
    sql`DELETE FROM ${mediaAssetPerformers} WHERE asset_id IN (SELECT id FROM ${mediaAssets} WHERE id::text LIKE ${p})`,
  );
  await db.delete(mediaAssets).where(like(sql`${mediaAssets.id}::text`, p));
  await db.delete(showPerformers).where(like(sql`${showPerformers.showId}::text`, p));
  await db.delete(showAnnouncementLinks).where(like(sql`${showAnnouncementLinks.showId}::text`, p));
  await db.delete(shows).where(like(sql`${shows.id}::text`, p));
  await db.delete(announcements).where(like(sql`${announcements.id}::text`, p));
  await db.delete(userVenueFollows).where(like(userVenueFollows.userId, p));
  await db.delete(userPerformerFollows).where(like(userPerformerFollows.userId, p));
  await db.delete(userRegions).where(like(sql`${userRegions.id}::text`, p));
  await db.delete(performers).where(like(sql`${performers.id}::text`, p));
  await db.delete(venues).where(like(sql`${venues.id}::text`, p));
  // Users last (FK target).
  await db.delete(users).where(like(users.id, p));
}

/**
 * Generate a UUID-v4-shaped string starting with the given prefix and
 * a hash of `suffix` for uniqueness. Postgres uuid columns require strict
 * 0-9a-f, and zod's uuid validator enforces v4 layout (third group
 * starts with 1-8, fourth with 8/9/a/b).
 */
export function fakeUuid(prefix: string, suffix: string): string {
  function toHex(s: string): string {
    return s
      .toLowerCase()
      .split('')
      .map((c) => (/[0-9a-f]/.test(c) ? c : (c.charCodeAt(0) & 0xf).toString(16)))
      .join('');
  }
  // FNV-1a-style 32-bit hash so each suffix gets a unique 8-hex-char tag,
  // even when suffixes share leading characters (showa vs showb both
  // hash to distinct values).
  function hash32(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
  const prefixHex = toHex(prefix).padEnd(8, '0').slice(0, 8);
  const tag = hash32(suffix);
  const base = (prefixHex + tag).padEnd(32, '0').slice(0, 32);
  const segs = [
    base.slice(0, 8),
    base.slice(8, 12),
    '4' + base.slice(13, 16),
    '8' + base.slice(17, 20),
    base.slice(20, 32),
  ];
  return segs.join('-');
}

export { db, eq };
