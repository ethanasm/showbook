import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const performers = pgTable('performers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  setlistfmMbid: text('setlistfm_mbid'),
  ticketmasterAttractionId: text('ticketmaster_attraction_id'),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
