import { sql } from 'drizzle-orm';
import {
  index,
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
