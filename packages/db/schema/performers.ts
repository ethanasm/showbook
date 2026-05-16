import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const performers = pgTable(
  'performers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    musicbrainzId: text('musicbrainz_id'),
    ticketmasterAttractionId: text('ticketmaster_attraction_id'),
    imageUrl: text('image_url'),
    // One of 'stable' | 'rotating' | 'theatrical' | 'improvised' | 'unknown'.
    // The "effective" style — derived from (override > computed-after-three-
    // disagreements > seed) by the nightly setlist-style-refresh cron. Null
    // means the prediction served falls back to the cold-empty-state branch.
    setlistStyle: text('setlist_style'),
    setlistStyleInferredAt: timestamp('setlist_style_inferred_at'),
    // Phase 5 — manual override (operator + future "is this artist
    // really rotating?" UI). Always wins over the auto-classifier.
    setlistStyleOverride: text('setlist_style_override'),
    // Phase 5 — last value the auto-classifier produced from corpus
    // stats. Stored alongside `setlistStyle` so the cron can decide
    // whether to flip the effective value (three-runs-to-disagree).
    computedStyle: text('computed_style'),
    // Phase 5 — three-runs-to-disagree counter. Increments each cron run
    // where the auto-classifier disagrees with a seed-table entry. At
    // ≥3 the cron flips `setlistStyle` to `computedStyle`.
    styleDisagreementCount: integer('style_disagreement_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Partial UNIQUE on the external IDs: a single TM attraction id /
    // MusicBrainz id should map to exactly one row. The IS NOT NULL
    // predicate keeps the constraint from forcing every row to fill the
    // column. matchOrCreatePerformer's catch(isUniqueViolation) branch
    // relies on these indexes to fall back to the existing row under a
    // race.
    uniqueIndex('performers_tm_attraction_uniq')
      .on(table.ticketmasterAttractionId)
      .where(sql`${table.ticketmasterAttractionId} IS NOT NULL`),
    uniqueIndex('performers_musicbrainz_uniq')
      .on(table.musicbrainzId)
      .where(sql`${table.musicbrainzId} IS NOT NULL`),
    index('performers_name_idx').on(table.name),
  ]
);
