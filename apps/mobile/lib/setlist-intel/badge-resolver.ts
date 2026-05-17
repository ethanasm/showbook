/**
 * Phase 10 — pure inline-song-badge resolver. Mirrors the resolver
 * inlined in `apps/web/components/show-tabs/SetlistTab.tsx`. Pulling it
 * here lets the mobile setlist row reuse the same lookup against the
 * shared `shows.songBadges` payload.
 *
 * The payload is keyed by song id; the row only knows the title, so we
 * use a lowercase-title → song id map (provided by the server) to bridge.
 */

export interface RareCatchInfo {
  fractionPct: number;
}

export interface SongBadge {
  firstTime: boolean;
  rareCatch: RareCatchInfo | null;
}

export interface BadgePayload {
  badges: Record<string, SongBadge>;
  titleToSongId: Record<string, string>;
}

export interface ResolvedBadge {
  songId: string | null;
  badge: SongBadge | undefined;
}

export function resolveBadge(
  title: string,
  payload: BadgePayload | null | undefined,
): ResolvedBadge {
  if (!payload) return { songId: null, badge: undefined };
  const songId = payload.titleToSongId[title.toLowerCase()] ?? null;
  const badge = songId ? payload.badges[songId] : undefined;
  return { songId, badge };
}

export interface PreviewMatch {
  previewUrl: string | null;
  spotifyTrackId: string | null;
}

export type PreviewMap = Record<string, PreviewMatch>;

/**
 * Phase 9 — resolve a row title to its cached preview / Spotify URI
 * pair. Returns nulls when the title isn't in the catalog cache; the
 * row's TrackPreview button kicks off a lazy resolve on tap.
 */
export function resolvePreview(
  title: string,
  previews: PreviewMap | null | undefined,
): PreviewMatch {
  const hit = previews?.[title.toLowerCase()];
  return {
    previewUrl: hit?.previewUrl ?? null,
    spotifyTrackId: hit?.spotifyTrackId ?? null,
  };
}
