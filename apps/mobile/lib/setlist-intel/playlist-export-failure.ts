/**
 * Failure classification for the Spotify playlist export cards
 * (`HypePlaylistCard`, both `hype` and `heard` kinds).
 *
 * Background (2026-08-10 incident): the card's catch block only split
 * failures by `network.online`, so an expired mobile session — every
 * tRPC call rejecting UNAUTHORIZED while the device was online — showed
 * the generic "Spotify export failed. Try again in a moment." while the
 * queued sentinel claimed "we'll create it when you're back online".
 * Neither was true: the user was online and no amount of retrying or
 * reconnecting could fix a dead bearer token.
 *
 * This module gives the card one pure, unit-tested decision:
 *   - `message` — what to show under the card.
 *   - `keepQueued` — whether the pending outbox row is worth keeping for
 *     the reconnect replay. Only transport-shaped failures (offline,
 *     5xx, connection blips) are replayable; terminal application
 *     rejections (missing scopes, not connected, cold prediction, empty
 *     setlist, expired session) would fail identically on every replay
 *     and must not leave a zombie row in the pending-writes drawer.
 */

import { isUnauthorizedError } from '../refresh-failure';
import { isTransientTrpcError } from '../trpc-retry';

export interface PlaylistExportFailurePlan {
  message: string;
  /** Keep the pending outbox row so the reconnect replay retries it. */
  keepQueued: boolean;
}

export function describePlaylistExportFailure(
  err: unknown,
  online: boolean,
): PlaylistExportFailurePlan {
  const msg = err instanceof Error ? err.message : String(err ?? 'Failed');

  if (msg.includes('spotify_scopes_missing:')) {
    return {
      message: 'Spotify needs an updated permission. Reconnect from Preferences.',
      keepQueued: false,
    };
  }
  if (msg.includes('spotify_not_connected')) {
    return {
      message: 'Connect Spotify to create this playlist.',
      keepQueued: false,
    };
  }
  if (msg.includes('prediction_cold') || msg.includes('prediction_empty')) {
    return {
      message: 'Not enough setlist data yet — try again closer to the show.',
      keepQueued: false,
    };
  }
  if (msg.includes('setlist_empty')) {
    return {
      message: 'No setlist on file yet — add songs from the Edit panel.',
      keepQueued: false,
    };
  }
  if (isUnauthorizedError(err)) {
    // Same copy as the global session-expired banner / pull-to-refresh
    // toast so the states read as one condition. Dropping the row does
    // not lose anything the offline contract would have kept: the only
    // recovery from an expired session is sign-out → sign-in, and
    // sign-out's cache cleanup deletes the outbox database anyway.
    return {
      message: 'Session expired — sign in again to sync.',
      keepQueued: false,
    };
  }
  if (!online) {
    return {
      message: "Queued — we'll create it on Spotify when you're back online.",
      keepQueued: true,
    };
  }
  if (isTransientTrpcError(err)) {
    // Transport blip / 5xx while online: the replay sweep can clear it,
    // and the user can also just tap again.
    return {
      message: 'Spotify export failed. Try again in a moment.',
      keepQueued: true,
    };
  }
  // Terminal application rejection we don't have specific copy for —
  // replaying the identical call would fail the same way.
  return {
    message: 'Spotify export failed. Try again in a moment.',
    keepQueued: false,
  };
}
