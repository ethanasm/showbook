"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { isFeatureOn } from "@showbook/shared";
import "./spotify-follow-rail.css";

/**
 * Phase 9 of setlist-intelligence — Spotify-follow rail on the
 * Discover Artists tab. Surfaces artists the user follows on
 * Spotify but not on Showbook, minus anything explicitly skipped.
 *
 * Two actions per card:
 *   - Follow → calls performers.followAttraction or, when the
 *     Spotify artist doesn't have a TM match, falls back to
 *     spotifyImport.importSelected with the single row.
 *   - Skip × → writes to user_spotify_skipped_artists so the
 *     same card never re-surfaces.
 *
 * Hides itself entirely when:
 *   - the SetlistIntelPreviews flag is OFF
 *   - the user hasn't connected Spotify
 *   - the diff is empty (everyone they follow on Spotify is
 *     already followed on Showbook)
 */
export function SpotifyFollowRail() {
  const flagOn = isFeatureOn("SetlistIntelPreviews");
  const utils = trpc.useUtils();

  const diffQuery = trpc.setlistIntel.spotifyFollowsDiff.useQuery(undefined, {
    enabled: flagOn,
    staleTime: 5 * 60_000,
  });

  // Optimistic state for the cards the user just acted on, so they
  // disappear immediately without waiting for the diff to refetch.
  const [actedOn, setActedOn] = useState<Set<string>>(new Set());

  const skip = trpc.setlistIntel.skipSpotifyArtist.useMutation({
    onSuccess: () => {
      void utils.setlistIntel.spotifyFollowsDiff.invalidate();
    },
  });

  // Resolve a single Spotify artist to a TM attraction. Each card
  // calls this lazily on Follow; mirrors the per-row resolve from
  // the SpotifyImportModal but inlined here so the rail's Follow
  // action is a single tap (no modal).
  const importMutation = trpc.spotifyImport.importSelected.useMutation({
    onSuccess: () => {
      void utils.performers.followed.invalidate();
      void utils.performers.list.invalidate();
      void utils.discover.followedArtistsFeed.invalidate();
      void utils.discover.ingestStatus.invalidate();
      void utils.setlistIntel.spotifyFollowsDiff.invalidate();
    },
  });

  const followOne = trpc.spotifyImport.listFollowed.useMutation();

  const visible = useMemo(() => {
    const artists = diffQuery.data?.artists ?? [];
    return artists.filter((a) => !actedOn.has(a.id));
  }, [diffQuery.data, actedOn]);

  const onSkip = useCallback(
    (spotifyArtistId: string) => {
      setActedOn((prev) => {
        const next = new Set(prev);
        next.add(spotifyArtistId);
        return next;
      });
      skip.mutate({ spotifyArtistId });
    },
    [skip],
  );

  // Follow flow — we need a TM attraction id to call
  // performers.followAttraction. The simplest correct path is to
  // re-use spotifyImport.importSelected, which runs the resolution
  // server-side for one artist at a time. The Follow Them All
  // button below does the same for the whole batch.
  const followOneById = useCallback(
    async (id: string, name: string) => {
      setActedOn((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      try {
        const list = await followOne.mutateAsync({});
        const match = list.artists.find((a) => a.spotifyId === id);
        if (!match || !match.tmMatch) {
          // No TM match — surface as a skip so the rail doesn't keep
          // suggesting an unresolvable artist. The user can still
          // search Showbook directly for an alternative name.
          skip.mutate({ spotifyArtistId: id });
          return;
        }
        await importMutation.mutateAsync({
          artists: [
            {
              tmAttractionId: match.tmMatch.tmAttractionId,
              name: match.tmMatch.name ?? name,
              imageUrl: match.imageUrl ?? undefined,
              musicbrainzId: match.tmMatch.musicbrainzId ?? undefined,
            },
          ],
        });
      } catch {
        // Roll back the optimistic flip so the user can retry.
        setActedOn((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [followOne, importMutation, skip],
  );

  const onFollowAll = useCallback(async () => {
    try {
      const list = await followOne.mutateAsync({});
      const matched = list.artists.filter(
        (a) => a.tmMatch && !actedOn.has(a.spotifyId),
      );
      if (matched.length === 0) return;
      const ids = new Set(matched.map((a) => a.spotifyId));
      setActedOn((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.add(id);
        return next;
      });
      await importMutation.mutateAsync({
        artists: matched.map((a) => ({
          tmAttractionId: a.tmMatch!.tmAttractionId,
          name: a.tmMatch!.name ?? a.name,
          imageUrl: a.imageUrl ?? undefined,
          musicbrainzId: a.tmMatch!.musicbrainzId ?? undefined,
        })),
      });
    } catch {
      // Partial failures show up in the diff refetch — the user can
      // retry per-card.
    }
  }, [actedOn, followOne, importMutation]);

  if (!flagOn) return null;
  if (!diffQuery.data) return null;
  if (!diffQuery.data.connected) return null;
  if (visible.length === 0) return null;

  return (
    <section
      data-testid="spotify-follow-rail"
      className="spotify-follow-rail"
    >
      <header className="spotify-follow-rail__header">
        <div>
          <div className="spotify-follow-rail__kicker">
            You follow these on Spotify
          </div>
          <div className="spotify-follow-rail__hint">
            Tap follow to track them on Showbook too.
          </div>
        </div>
        <button
          type="button"
          className="spotify-follow-rail__follow-all"
          onClick={() => void onFollowAll()}
          disabled={importMutation.isPending || followOne.isPending}
          data-testid="spotify-follow-rail-follow-all"
        >
          Follow them all
        </button>
      </header>
      <div className="spotify-follow-rail__scroller">
        {visible.map((artist) => (
          <article
            key={artist.id}
            className="spotify-follow-rail__card"
            data-testid="spotify-follow-rail-card"
            data-spotify-artist-id={artist.id}
          >
            <button
              type="button"
              aria-label={`Hide ${artist.name}`}
              className="spotify-follow-rail__skip"
              onClick={() => onSkip(artist.id)}
              data-testid="spotify-follow-rail-skip"
            >
              <X size={11} />
            </button>
            <div className="spotify-follow-rail__avatar">
              {artist.imageUrl ? (
                // Spotify CDN images; not routed through next/image
                // because the rail can render dozens of cards and
                // each remote-image hop is expensive on Discover.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={artist.imageUrl}
                  alt=""
                  width={48}
                  height={48}
                  loading="lazy"
                />
              ) : (
                <span aria-hidden="true">♪</span>
              )}
            </div>
            <div className="spotify-follow-rail__name">{artist.name}</div>
            <div className="spotify-follow-rail__genre">
              {artist.genres[0] ?? "Spotify"}
            </div>
            <button
              type="button"
              className="spotify-follow-rail__follow"
              onClick={() => void followOneById(artist.id, artist.name)}
              disabled={importMutation.isPending || followOne.isPending}
              data-testid="spotify-follow-rail-follow"
            >
              <Check size={11} /> Follow
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
