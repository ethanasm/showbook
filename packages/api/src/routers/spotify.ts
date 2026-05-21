/**
 * Spotify connection management — read connection status, disconnect.
 *
 * The OAuth callback persists tokens directly via
 * `persistInitialToken` (it's already running server-side and has the
 * token in hand); there's no client-callable `persistToken` mutation
 * because the client never sees the token in the connect-once flow.
 *
 * Phase 0 surface area:
 *   - `connectionStatus` — drives `useSpotifyConnection` on web/mobile.
 *   - `disconnect` — operator-/user-initiated revoke from Preferences.
 *
 * Phase 3 (this file's expansion):
 *   - `hypePlaylistFeature` — gate the new HypePlaylistCard UI by the
 *     `SetlistIntelHypePlaylist` flag (global ON) or admin allowlist.
 *   - `existingPlaylist` — idempotency lookup the UI uses to flip
 *     "Open in Spotify" instead of re-creating.
 *   - `createHypePlaylist` / `createHeardPlaylist` — the playlist
 *     mutations.
 */

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { child } from '@showbook/observability';
import { isFeatureOn, type FeatureFlagKey } from '@showbook/shared';
import { users } from '@showbook/db';
import { router, protectedProcedure } from '../trpc';
import {
  disconnectSpotify,
  ensureFreshUserToken,
  getConnectionStatus,
} from '../spotify-tokens';
import {
  createHeardPlaylist,
  createHypePlaylist,
  getExistingPlaylist,
} from '../spotify-playlist';
import { isAdminEmail } from '../admin';

const log = child({ component: 'api.spotify.router', provider: 'spotify' });

const FLAG_KEY: FeatureFlagKey = 'SetlistIntelHypePlaylist';

/**
 * Resolves the SetlistIntelHypePlaylist gate for a given user. The flag
 * is OFF in prod by default; admins (per ADMIN_EMAILS) bypass the gate
 * so the developer can validate the feature in prod before flipping it
 * for everyone.
 */
async function isHypePlaylistEnabledForUser(
  dbi: typeof import('@showbook/db').db,
  userId: string,
): Promise<boolean> {
  if (isFeatureOn(FLAG_KEY)) return true;
  const [user] = await dbi
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return isAdminEmail(user?.email);
}

async function requireHypePlaylistEnabled(
  dbi: typeof import('@showbook/db').db,
  userId: string,
): Promise<void> {
  if (!(await isHypePlaylistEnabledForUser(dbi, userId))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'feature_disabled:SetlistIntelHypePlaylist',
    });
  }
}

// Optional `performerId` powers the festival lineup chip rail —
// when omitted, the playlist mutations and the existing-playlist
// lookup default to the show's headliner so single-act concerts
// keep their original call shape.
const playlistMutationInput = z.object({
  showId: z.string().uuid(),
  performerId: z.string().uuid().optional(),
});
const existingPlaylistInput = z.object({
  showId: z.string().uuid(),
  kind: z.union([z.literal('hype'), z.literal('heard')]),
  performerId: z.string().uuid().optional(),
});

export const spotifyRouter = router({
  /**
   * Read the user's current Spotify connection metadata. Lightweight —
   * doesn't decrypt or refresh tokens. Use `requireConnection` on the
   * client for action-gating; this endpoint just feeds the
   * "Disconnect Spotify" preferences row.
   */
  connectionStatus: protectedProcedure.query(async ({ ctx }) => {
    return getConnectionStatus(ctx.session.user.id);
  }),

  /**
   * Phase 9 — return a fresh Spotify access token for the Web
   * Playback SDK (Premium-only). The SDK runs in the browser and
   * cannot use the server-side encrypted refresh token directly; it
   * needs a bearer access token to instantiate. Tokens are
   * short-lived (~1h) and Premium-gated server-side so a non-
   * Premium user can't accidentally request one.
   *
   * Returns `null` when the user isn't connected or isn't on
   * Premium — the client renders the preview-only experience in
   * that case.
   */
  playbackToken: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const status = await getConnectionStatus(userId);
    if (!status.connected || status.product !== 'premium') {
      return null;
    }
    const accessToken = await ensureFreshUserToken(userId);
    if (!accessToken) return null;
    return { accessToken };
  }),

  /**
   * Gate query for the Phase 3 HypePlaylistCard UI. Returns `enabled`
   * when the global feature flag is ON or the caller is on the
   * `ADMIN_EMAILS` allowlist (the in-prod developer override).
   */
  hypePlaylistFeature: protectedProcedure.query(async ({ ctx }) => {
    const enabled = await isHypePlaylistEnabledForUser(
      ctx.db,
      ctx.session.user.id,
    );
    return { enabled };
  }),

  /**
   * Look up the existing hype or heard playlist row for a show. Used by
   * the UI to flip the card's primary button from "Open in Spotify"
   * (build new) to "Open in Spotify" (open existing) without a new
   * mutation.
   */
  existingPlaylist: protectedProcedure
    .input(existingPlaylistInput)
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return getExistingPlaylist({
        userId,
        showId: input.showId,
        kind: input.kind,
        performerId: input.performerId,
      });
    }),

  /**
   * Create (or return existing) hype playlist for a pre-show. Loads the
   * predicted setlist, resolves to Spotify URIs, creates a private
   * playlist, and adds tracks in setlist order. Idempotent —
   * re-tapping returns the previously persisted row.
   */
  createHypePlaylist: protectedProcedure
    .input(playlistMutationInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireHypePlaylistEnabled(ctx.db, userId);
      const startedAt = Date.now();
      try {
        const result = await createHypePlaylist({
          userId,
          showId: input.showId,
          performerId: input.performerId,
        });
        const durationMs = Date.now() - startedAt;
        if (result.reused) {
          log.info(
            {
              event: 'spotify.playlist.hype_reused',
              userId,
              showId: input.showId,
              performerId: input.performerId ?? null,
              playlistId: result.playlistId,
              trackCount: result.trackCount,
              durationMs,
            },
            'Hype playlist reused',
          );
        } else {
          log.info(
            {
              event: 'spotify.playlist.hype_created',
              userId,
              showId: input.showId,
              performerId: input.performerId ?? null,
              playlistId: result.playlistId,
              trackCount: result.trackCount,
              missingCount: result.missing.length,
              durationMs,
            },
            'Hype playlist created',
          );
        }
        return result;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        log.error(
          {
            err,
            event: 'spotify.hype_playlist.failed',
            userId,
            showId: input.showId,
            performerId: input.performerId ?? null,
          },
          'Hype playlist creation failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'hype_playlist_failed',
        });
      }
    }),

  /**
   * Post-show counterpart of `createHypePlaylist`. Uses the actual
   * setlist rather than the prediction.
   */
  createHeardPlaylist: protectedProcedure
    .input(playlistMutationInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await requireHypePlaylistEnabled(ctx.db, userId);
      const startedAt = Date.now();
      try {
        const result = await createHeardPlaylist({
          userId,
          showId: input.showId,
          performerId: input.performerId,
        });
        const durationMs = Date.now() - startedAt;
        if (result.reused) {
          log.info(
            {
              event: 'spotify.playlist.heard_reused',
              userId,
              showId: input.showId,
              performerId: input.performerId ?? null,
              playlistId: result.playlistId,
              trackCount: result.trackCount,
              durationMs,
            },
            'Heard playlist reused',
          );
        } else {
          log.info(
            {
              event: 'spotify.playlist.heard_created',
              userId,
              showId: input.showId,
              performerId: input.performerId ?? null,
              playlistId: result.playlistId,
              trackCount: result.trackCount,
              missingCount: result.missing.length,
              durationMs,
            },
            'Heard playlist created',
          );
        }
        return result;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        log.error(
          {
            err,
            event: 'spotify.heard_playlist.failed',
            userId,
            showId: input.showId,
            performerId: input.performerId ?? null,
          },
          'Heard playlist creation failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'heard_playlist_failed',
        });
      }
    }),

  /**
   * User-initiated disconnect. Marks `revoked_at` (soft delete for
   * audit) and returns success. The token row remains in the DB for
   * 30 days before a separate hard-delete job removes it.
   */
  disconnect: protectedProcedure
    .input(
      z
        .object({
          // Free-form caller note kept short — surfaces in the audit log.
          reason: z.string().max(120).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      try {
        await disconnectSpotify(userId, input?.reason ?? 'user_disconnect');
        return { ok: true as const };
      } catch (err) {
        log.error(
          { err, event: 'spotify.disconnect.failed', userId },
          'Spotify disconnect failed',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to disconnect Spotify',
        });
      }
    }),
});
