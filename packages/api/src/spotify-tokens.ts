/**
 * Persistent server-side store + refresh wrapper for a user's Spotify
 * OAuth tokens. The single source of truth for any backend code that
 * needs a user-scoped Spotify token: `ensureFreshUserToken(userId)`.
 *
 * Other modules MUST NOT query `user_spotify_tokens` directly — the
 * refresh + revoked-handling logic lives here, and bypassing it leaks
 * stale tokens. The token text columns are AES-256-GCM ciphertext;
 * `decrypt` lives in `crypto.ts`.
 *
 * The four exports cover every legitimate touchpoint:
 *   - `persistInitialToken` — called once by the OAuth callback after
 *     `exchangeAuthorizationCode` (Phase 0).
 *   - `ensureFreshUserToken` — read path; auto-refreshes within 60s of
 *     expiry; sets `revoked_at` on Spotify 401.
 *   - `isSpotifyConnected` — cheap "is there a non-revoked row?" check
 *     for UI gating.
 *   - `disconnectSpotify` — operator/user-initiated revoke; sets
 *     `revoked_at`, leaves the row for audit.
 *
 * Phase 0 keeps the surface deliberately small: the catalog of
 * Spotify-derived stats this would need to purge on disconnect (fan
 * loyalty, priming counts, playlist URLs) doesn't exist yet, so the
 * disconnect path is a soft mark only.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { child } from '@showbook/observability';
import { db, userSpotifyTokens } from '@showbook/db';
import { decrypt, encrypt } from './crypto';
import {
  refreshSpotifyToken,
  SpotifyError,
  type SpotifyMe,
  type SpotifyTokenSet,
} from './spotify';

const log = child({ component: 'api.spotify-tokens', provider: 'spotify' });

// Refresh window: when the persisted access token has fewer than this
// many milliseconds of validity left, transparently refresh on the next
// `ensureFreshUserToken` call. 60s buys enough cushion for the worst
// case of a token used right at the boundary of a long-running request.
const REFRESH_WINDOW_MS = 60_000;

interface PersistInitialTokenInput {
  userId: string;
  tokens: SpotifyTokenSet;
  profile: SpotifyMe;
}

/**
 * Called by the OAuth callback after `exchangeAuthorizationCode`. Replaces
 * any existing row for the user (re-connect after disconnect creates a
 * new connection, not a stale half-state).
 */
export async function persistInitialToken(
  input: PersistInitialTokenInput,
): Promise<void> {
  const expiresAt = new Date(Date.now() + input.tokens.expiresIn * 1000);
  const now = new Date();
  await db
    .insert(userSpotifyTokens)
    .values({
      userId: input.userId,
      accessTokenEnc: encrypt(input.tokens.accessToken),
      refreshTokenEnc: encrypt(input.tokens.refreshToken),
      scope: input.tokens.scope,
      expiresAt,
      spotifyUserId: input.profile.id,
      displayName: input.profile.displayName,
      product: input.profile.product,
      lastRefreshedAt: now,
      createdAt: now,
      updatedAt: now,
      // Reset audit columns so a re-connect after a previous disconnect
      // looks like a fresh row rather than a "revoked but somehow
      // working" hybrid.
      revokedAt: null,
      revokedReason: null,
    })
    .onConflictDoUpdate({
      target: userSpotifyTokens.userId,
      set: {
        accessTokenEnc: encrypt(input.tokens.accessToken),
        refreshTokenEnc: encrypt(input.tokens.refreshToken),
        scope: input.tokens.scope,
        expiresAt,
        spotifyUserId: input.profile.id,
        displayName: input.profile.displayName,
        product: input.profile.product,
        lastRefreshedAt: now,
        updatedAt: now,
        revokedAt: null,
        revokedReason: null,
      },
    });
  log.info(
    {
      event: 'spotify.connect.success',
      userId: input.userId,
      spotifyUserId: input.profile.id,
      scopes: input.tokens.scope.split(' ').length,
    },
    'Spotify connection persisted',
  );
}

/**
 * Returns a usable access token for the given user, or `null` when the
 * user isn't connected (or has been revoked). Auto-refreshes when within
 * REFRESH_WINDOW_MS of expiry. On a Spotify 401 during refresh, marks
 * the row revoked and returns null — caller should surface the connect
 * modal.
 */
export async function ensureFreshUserToken(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select()
    .from(userSpotifyTokens)
    .where(
      and(
        eq(userSpotifyTokens.userId, userId),
        isNull(userSpotifyTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const now = Date.now();
  if (row.expiresAt.getTime() > now + REFRESH_WINDOW_MS) {
    // Fast path: still fresh.
    await db
      .update(userSpotifyTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(userSpotifyTokens.userId, userId));
    return decrypt(row.accessTokenEnc);
  }

  // Refresh.
  let refreshed: SpotifyTokenSet;
  try {
    refreshed = await refreshSpotifyToken(decrypt(row.refreshTokenEnc));
  } catch (err) {
    if (err instanceof SpotifyError && err.status === 401) {
      // Spotify revoked us (user disconnected on their end, or scope
      // changed). Mark the row revoked and bail; UI surfaces re-connect.
      await db
        .update(userSpotifyTokens)
        .set({
          revokedAt: new Date(),
          revokedReason: '401_from_spotify',
          updatedAt: new Date(),
        })
        .where(eq(userSpotifyTokens.userId, userId));
      log.warn(
        { event: 'spotify.connect.revoked', userId, reason: '401_from_spotify' },
        'Spotify token revoked by provider',
      );
      return null;
    }
    log.error(
      { err, event: 'spotify.token.refresh_failed', userId },
      'Spotify token refresh failed',
    );
    throw err;
  }

  const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
  const updateNow = new Date();
  await db
    .update(userSpotifyTokens)
    .set({
      accessTokenEnc: encrypt(refreshed.accessToken),
      refreshTokenEnc: encrypt(refreshed.refreshToken),
      scope: refreshed.scope,
      expiresAt,
      lastRefreshedAt: updateNow,
      lastUsedAt: updateNow,
      updatedAt: updateNow,
    })
    .where(eq(userSpotifyTokens.userId, userId));

  log.info(
    { event: 'spotify.token.refreshed', userId },
    'Spotify access token refreshed',
  );

  return refreshed.accessToken;
}

/**
 * Lightweight "is the user connected?" check for connection-status UI.
 * Doesn't decrypt or refresh — useful in render paths where any extra
 * work would be wasted if the answer is "no."
 */
export async function isSpotifyConnected(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: userSpotifyTokens.userId })
    .from(userSpotifyTokens)
    .where(
      and(
        eq(userSpotifyTokens.userId, userId),
        isNull(userSpotifyTokens.revokedAt),
      ),
    )
    .limit(1);
  return !!row;
}

export interface SpotifyConnectionStatus {
  connected: boolean;
  displayName?: string | null;
  product?: string | null;
  spotifyUserId?: string | null;
  scope?: string | null;
}

/**
 * Read the connection's display metadata for the connection-status tRPC
 * procedure. Doesn't return the token. Returns `connected: false` when
 * the user has no row or the row is revoked.
 */
export async function getConnectionStatus(
  userId: string,
): Promise<SpotifyConnectionStatus> {
  const [row] = await db
    .select({
      displayName: userSpotifyTokens.displayName,
      product: userSpotifyTokens.product,
      spotifyUserId: userSpotifyTokens.spotifyUserId,
      scope: userSpotifyTokens.scope,
      revokedAt: userSpotifyTokens.revokedAt,
    })
    .from(userSpotifyTokens)
    .where(eq(userSpotifyTokens.userId, userId))
    .limit(1);
  if (!row || row.revokedAt) return { connected: false };
  return {
    connected: true,
    displayName: row.displayName,
    product: row.product,
    spotifyUserId: row.spotifyUserId,
    scope: row.scope,
  };
}

/**
 * User- or operator-initiated disconnect. Sets `revoked_at` rather than
 * deleting the row so the audit trail survives; a separate hard-delete
 * job (Phase 11+) drops rows that have been revoked > 30 days. Idempotent
 * — re-running on an already-revoked row is a no-op.
 *
 * Cascading purge of Spotify-derived columns on `shows` (fan-loyalty %,
 * priming counts, playlist URLs) lands as those columns ship in Phase 3
 * / 7. In Phase 0 the caller is the only thing that needs to know.
 */
export async function disconnectSpotify(
  userId: string,
  reason: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(userSpotifyTokens)
    .set({
      revokedAt: now,
      revokedReason: reason,
      updatedAt: now,
    })
    .where(
      and(
        eq(userSpotifyTokens.userId, userId),
        // Only flip rows that aren't already revoked — keeps the original
        // revoked_at / revoked_reason for auditing the first event.
        sql`${userSpotifyTokens.revokedAt} IS NULL`,
      ),
    );
  log.info(
    { event: 'spotify.connect.revoked', userId, reason },
    'Spotify connection revoked',
  );
}
