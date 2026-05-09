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
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { child } from '@showbook/observability';
import { router, protectedProcedure } from '../trpc';
import {
  disconnectSpotify,
  getConnectionStatus,
} from '../spotify-tokens';

const log = child({ component: 'api.spotify.router', provider: 'spotify' });

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
