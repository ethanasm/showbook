import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { shows } from './shows';
import { performers } from './performers';

export const mediaTypeEnum = pgEnum('media_type', ['photo', 'video']);
export const mediaStatusEnum = pgEnum('media_status', [
  'pending',
  'ready',
  'failed',
]);

export type MediaVariant = {
  key: string;
  mimeType: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
};

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showId: uuid('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    mediaType: mediaTypeEnum('media_type').notNull(),
    status: mediaStatusEnum('status').notNull().default('pending'),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    variants: jsonb('variants').$type<Record<string, MediaVariant>>(),
    caption: text('caption'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('media_assets_user_idx').on(table.userId),
    index('media_assets_show_idx').on(table.showId, table.status, table.sortOrder),
    index('media_assets_type_idx').on(table.mediaType),
  ],
);

export const mediaAssetPerformers = pgTable(
  'media_asset_performers',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.performerId] }),
    index('media_asset_performers_performer_idx').on(table.performerId),
  ],
);
