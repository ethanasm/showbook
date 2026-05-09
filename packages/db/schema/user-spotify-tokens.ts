import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

// Persistent server-side store for a user's Spotify OAuth tokens. PK is
// `user_id` because a user has at most one Spotify connection at a time.
//
// `access_token_enc` and `refresh_token_enc` are AES-256-GCM ciphertext
// (`packages/api/src/crypto.ts`). The encryption key lives in the
// `TOKEN_KEY` env var (32-byte hex string, set per environment); rotation is
// a separate runbook (re-encrypt all rows under the new key in batch).
//
// `revoked_at` is set when the user disconnects or when Spotify returns 401
// on a token use. Rows aren't hard-deleted: they keep the audit trail of
// past connections. A nightly job hard-deletes rows revoked >30 days ago.
//
// `last_used_at` / `last_refreshed_at` track token health for ops dashboards
// and to spot tokens that have gone idle (which may indicate the user
// disconnected from Spotify's side without telling us).
export const userSpotifyTokens = pgTable('user_spotify_tokens', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scope: text('scope').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  spotifyUserId: text('spotify_user_id').notNull(),
  displayName: text('display_name'),
  product: text('product'),
  lastUsedAt: timestamp('last_used_at'),
  lastRefreshedAt: timestamp('last_refreshed_at'),
  revokedAt: timestamp('revoked_at'),
  revokedReason: text('revoked_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
