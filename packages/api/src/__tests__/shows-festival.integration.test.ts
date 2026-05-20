/**
 * Per-performer setlist enrichment for festivals.
 *
 * Festivals are stored as a single `shows` row (kind='festival') with N
 * `show_performers` rows. Before this coverage, shows.create gated its
 * enrichment-queue insert on kind === 'concert', so every festival
 * lineup artist was silently dropped from the setlist pipeline.
 *
 * These tests assert the per-performer fanout: each lineup artist
 * without an inline setlist gets its own enrichment_queue row.
 *
 * Run with:
 *   DATABASE_URL=postgresql://showbook:showbook_dev@localhost:5433/showbook_e2e \
 *     pnpm --filter @showbook/api exec node --import tsx --test \
 *     src/__tests__/shows-festival.integration.test.ts
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  db,
  shows,
  enrichmentQueue,
  performers,
  venues,
} from '@showbook/db';
import { eq, inArray, like } from 'drizzle-orm';
import {
  callerFor,
  cleanupByPrefix,
  createTestUser,
  createTestVenue,
  fakeUuid,
} from './_test-helpers';

const PREFIX = 'ff222222';
const USER = `${PREFIX}-user`;
const VENUE = fakeUuid(PREFIX, 'venue');

describe('shows.create festival setlist enrichment', () => {
  before(async () => {
    await cleanupByPrefix(PREFIX);
    await createTestUser(USER);
    await createTestVenue({
      id: VENUE,
      name: `${PREFIX} Venue`,
      city: 'NYC',
      latitude: 40.7,
      longitude: -74,
      stateRegion: 'NY',
    });
  });

  after(async () => {
    await db.delete(shows).where(inArray(shows.userId, [USER]));
    await db.delete(performers).where(like(performers.name, `${PREFIX}%`));
    await db.delete(venues).where(like(venues.name, `${PREFIX}%`));
    await cleanupByPrefix(PREFIX);
  });

  it('past festival enqueues one setlist row per lineup performer', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'festival',
      headliner: { name: `${PREFIX} Some Big Festival` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2022-08-15',
      ticketCount: 1,
      productionName: `${PREFIX} Some Big Festival`,
      performers: [
        {
          name: `${PREFIX} Festival Top Artist`,
          role: 'headliner',
          sortOrder: 1,
        },
        {
          name: `${PREFIX} Festival Second Artist`,
          role: 'support',
          sortOrder: 2,
        },
        {
          name: `${PREFIX} Festival Third Artist`,
          role: 'support',
          sortOrder: 3,
        },
      ],
    });
    assert.ok(created);
    assert.equal(created!.kind, 'festival');
    assert.equal(created!.state, 'past');
    // Festivals do NOT mint a synthetic performer for the festival
    // name — only the three lineup artists are persisted.
    assert.equal(created!.showPerformers.length, 3);
    assert.ok(
      !created!.showPerformers.some(
        (sp) => sp.performer.name === `${PREFIX} Some Big Festival`,
      ),
      'festival name must not appear as a performer',
    );

    const queueRows = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, created!.id));
    // One queue row per lineup artist (no synthetic festival-name
    // headliner row anymore).
    assert.equal(queueRows.length, 3, 'one queue row per festival artist');
    const queuedPerformerIds = new Set(queueRows.map((r) => r.performerId));
    for (const sp of created!.showPerformers) {
      assert.ok(
        queuedPerformerIds.has(sp.performerId),
        `expected queue row for performer ${sp.performerId}`,
      );
    }
    for (const row of queueRows) {
      assert.equal(row.type, 'setlist');
      assert.equal(row.attempts, 0);
      assert.equal(row.maxAttempts, 14);
    }
  });

  it('past festival skips queueing performers that arrive with inline setlists', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'festival',
      headliner: { name: `${PREFIX} Inline Festival` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2022-08-16',
      ticketCount: 1,
      productionName: `${PREFIX} Inline Festival`,
      performers: [
        {
          name: `${PREFIX} Festival Inline Top`,
          role: 'headliner',
          sortOrder: 1,
          setlist: {
            sections: [{ kind: 'set', songs: [{ title: 'Opener' }] }],
          },
        },
        {
          name: `${PREFIX} Festival Inline Support`,
          role: 'support',
          sortOrder: 2,
        },
      ],
    });
    assert.ok(created);
    const queueRows = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, created!.id));
    // The lineup artist with an inline setlist is skipped; the other
    // lineup artist is queued.
    assert.equal(queueRows.length, 1, 'only the artist without an inline setlist is queued');
    const supportSp = created!.showPerformers.find((sp) => sp.role === 'support');
    assert.ok(supportSp);
    assert.equal(queueRows[0].performerId, supportSp!.performerId);
  });

  it('future-dated festival enqueues no setlist rows (waits for shows-nightly)', async () => {
    const created = await callerFor(USER).shows.create({
      kind: 'festival',
      headliner: { name: `${PREFIX} Festival Future Artist` },
      venue: { name: `${PREFIX} Venue`, city: 'NYC' },
      date: '2099-08-15',
      ticketCount: 1,
      seat: 'GA',
      pricePaid: '100.00',
      performers: [
        { name: `${PREFIX} Festival Future Support`, role: 'support', sortOrder: 1 },
      ],
    });
    assert.ok(created);
    assert.equal(created!.state, 'ticketed');
    const queueRows = await db
      .select()
      .from(enrichmentQueue)
      .where(eq(enrichmentQueue.showId, created!.id));
    assert.equal(queueRows.length, 0, 'future festivals should not enqueue setlist rows yet');
  });
});
