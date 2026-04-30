import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
    // matchOrCreatePerformer looks up by these IDs first; without an index
    // that's a seq scan per performer per show creation.
    index('performers_tm_attraction_id_idx').on(table.ticketmasterAttractionId),
    index('performers_musicbrainz_id_idx').on(table.musicbrainzId),
    index('performers_name_idx').on(table.name),
  ]
);
