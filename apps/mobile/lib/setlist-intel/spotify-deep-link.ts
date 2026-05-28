/**
 * Phase 10 (Part B4) — mobile Spotify deep-link resolver.
 *
 * Tapping "Open in Spotify" on a Hype playlist card should hand off to
 * the native Spotify app when installed (`spotify://playlist/{id}`),
 * else fall back to the in-app browser on `https://open.spotify.com/...`.
 *
 * The same plan shape covers individual tracks via
 * `buildSpotifyTrackOpenPlan` — used by `TrackPreviewButton` when a
 * setlist row has a resolved `spotify_track_id` but no 30-second
 * `preview_url` (the common case post-Spotify-preview-deprecation; see
 * `packages/api/src/routers/setlist-intel.ts` `resolveTrackPreview` and
 * the `spotify.preview.resolved` events in Axiom for the breakdown).
 *
 * Pure helpers live here; the React layer in `HypePlaylistCardMobile`
 * and `TrackPreviewButton` wires them up to `Linking.canOpenURL` /
 * `Linking.openURL`.
 */

const PLAYLIST_URL_RE = /^https?:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)(?:\?.*)?$/;
const NATIVE_URL_RE = /^spotify:playlist:([A-Za-z0-9]+)$/;
const NATIVE_DEEP_LINK_RE = /^spotify:\/\/playlist\/([A-Za-z0-9]+)$/;
const TRACK_ID_RE = /^[A-Za-z0-9]+$/;

/**
 * Extract the Spotify playlist id from any of the four shapes the
 * server-side `createHypePlaylist` mutation can emit:
 *  - `https://open.spotify.com/playlist/{id}`
 *  - `https://open.spotify.com/playlist/{id}?si=…`
 *  - `spotify:playlist:{id}`        (Spotify URI)
 *  - `spotify://playlist/{id}`      (already-formed deep link)
 *
 * Returns null when the input doesn't match — callers should fall back
 * to the raw URL with `Linking.openURL`.
 */
export function extractPlaylistId(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const match =
    trimmed.match(PLAYLIST_URL_RE) ??
    trimmed.match(NATIVE_URL_RE) ??
    trimmed.match(NATIVE_DEEP_LINK_RE);
  return match?.[1] ?? null;
}

export function buildNativeDeepLink(playlistId: string): string {
  return `spotify://playlist/${playlistId}`;
}

export function buildWebUrl(playlistId: string): string {
  return `https://open.spotify.com/playlist/${playlistId}`;
}

export interface SpotifyOpenPlan {
  /** URL to attempt first (native deep link when possible). */
  primary: string;
  /** URL to fall back to when `Linking.canOpenURL(primary) === false`. */
  fallback: string;
}

/**
 * Build the open-in-Spotify plan for a playlist URL. Caller pattern:
 *
 *   const plan = buildSpotifyOpenPlan(existing.spotifyUrl);
 *   if (await Linking.canOpenURL(plan.primary)) {
 *     await Linking.openURL(plan.primary);
 *   } else {
 *     await Linking.openURL(plan.fallback);
 *   }
 *
 * When the URL doesn't parse to a known shape we degrade to "primary
 * and fallback are both the raw URL" so the caller's logic is the same.
 */
export function buildSpotifyOpenPlan(url: string | null | undefined): SpotifyOpenPlan {
  const id = extractPlaylistId(url);
  if (id) {
    return {
      primary: buildNativeDeepLink(id),
      fallback: buildWebUrl(id),
    };
  }
  const raw = (url ?? '').trim();
  return { primary: raw, fallback: raw };
}

/**
 * Build the open-in-Spotify plan for an individual track id. Used by
 * `TrackPreviewButton` when the resolver has filled `spotify_track_id`
 * but couldn't get a `preview_url` from either Spotify (deprecated) or
 * iTunes. The native app honours `spotify:track:<id>` and plays the
 * track in-app — Premium plays on-demand, Free degrades to shuffle.
 *
 * `__none__` is the sentinel `resolveTrackPreview` writes when Spotify
 * search returned no track for the title; treat it as "no id" so the
 * caller falls back to "unavailable" rather than opening a broken link.
 */
export function buildSpotifyTrackOpenPlan(
  trackId: string | null | undefined,
): SpotifyOpenPlan | null {
  if (!trackId) return null;
  const trimmed = trackId.trim();
  if (!trimmed || trimmed === '__none__') return null;
  if (!TRACK_ID_RE.test(trimmed)) return null;
  return {
    primary: `spotify:track:${trimmed}`,
    fallback: `https://open.spotify.com/track/${trimmed}`,
  };
}
