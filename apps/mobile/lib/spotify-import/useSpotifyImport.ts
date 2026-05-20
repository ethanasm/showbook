/**
 * Mobile-side Spotify import flow. Mirror of `apps/web/components/
 * preferences/useSpotifyImport.ts` minus the OAuth popup orchestration —
 * mobile connects to Spotify via `apps/mobile/lib/spotify-connection.ts`
 * (in-app browser), so the only thing this hook owns is the
 * listFollowed → picker → importSelected loop.
 *
 * Phases:
 *   idle      — pre-connection or after a `reset`
 *   loading   — listFollowed in flight
 *   picking   — list resolved, user is checking artists
 *   importing — importSelected in flight
 *   done      — import succeeded; importedCount is set
 */

import { useCallback, useMemo, useState } from 'react';
import { trpc } from '../trpc';

export interface SpotifyImportArtist {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  tmMatch: {
    tmAttractionId: string;
    name: string;
    imageUrl: string | null;
    musicbrainzId: string | null;
  } | null;
  alreadyFollowed: boolean;
}

export type SpotifyImportPhase = 'idle' | 'loading' | 'picking' | 'importing' | 'done';

export interface UseSpotifyImportOptions {
  onImported?: (result: { count: number; performerIds: string[] }) => void;
}

export function useSpotifyImport(opts: UseSpotifyImportOptions = {}) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [artists, setArtists] = useState<SpotifyImportArtist[] | null>(null);
  const [meta, setMeta] = useState<{
    total: number;
    resolved: number;
    truncated: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const listFollowed = trpc.spotifyImport.listFollowed.useMutation({
    onSuccess: (data) => {
      setArtists(data.artists);
      setMeta({
        total: data.totalCount,
        resolved: data.resolvedCount,
        truncated: data.truncated,
      });
      // Default selection: matchable + not yet followed. The user toggles
      // the rest off as needed; this mirrors web's default-select policy.
      setSelected(
        new Set(
          data.artists
            .filter((a) => a.tmMatch && !a.alreadyFollowed)
            .map((a) => a.spotifyId),
        ),
      );
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const importSelected = trpc.spotifyImport.importSelected.useMutation({
    onSuccess: (data) => {
      setImportedCount(data.imported.length);
      setArtists(null);
      setSelected(new Set());
      // Invalidate the same cache slots the web hook touches so the
      // freshly-followed performers show up in Artists / Discover.
      void utils.performers.followed.invalidate();
      void utils.performers.list.invalidate();
      void utils.performers.count.invalidate();
      void utils.discover.followedFeed.invalidate();
      void utils.discover.followedArtistsFeed.invalidate();
      void utils.discover.ingestStatus.invalidate();
      opts.onImported?.({
        count: data.imported.length,
        performerIds: data.imported.map((i) => i.performerId),
      });
    },
    onError: (err) => setError(err.message),
  });

  const loadArtists = useCallback(() => {
    setError(null);
    setImportedCount(null);
    listFollowed.mutate({});
  }, [listFollowed]);

  const toggle = useCallback((spotifyId: string, importable: boolean) => {
    if (!importable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(spotifyId)) next.delete(spotifyId);
      else next.add(spotifyId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!artists) return;
    const importable = artists.filter((a) => a.tmMatch && !a.alreadyFollowed);
    setSelected((prev) =>
      prev.size === importable.length
        ? new Set()
        : new Set(importable.map((a) => a.spotifyId)),
    );
  }, [artists]);

  const selectAll = useCallback(() => {
    if (!artists) return;
    const importable = artists.filter((a) => a.tmMatch && !a.alreadyFollowed);
    setSelected(new Set(importable.map((a) => a.spotifyId)));
  }, [artists]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const submitImport = useCallback(() => {
    if (!artists) return;
    const byId = new Map(artists.map((a) => [a.spotifyId, a]));
    const payload = Array.from(selected)
      .map((id) => byId.get(id))
      .filter((a): a is SpotifyImportArtist => Boolean(a?.tmMatch))
      .map((a) => ({
        tmAttractionId: a.tmMatch!.tmAttractionId,
        name: a.tmMatch!.name,
        imageUrl: a.tmMatch!.imageUrl ?? undefined,
        musicbrainzId: a.tmMatch!.musicbrainzId ?? undefined,
      }));
    if (payload.length === 0) return;
    importSelected.mutate({ artists: payload });
  }, [artists, selected, importSelected]);

  const reset = useCallback(() => {
    setArtists(null);
    setSelected(new Set());
    setMeta(null);
    setError(null);
    setImportedCount(null);
  }, []);

  // Counts for the footer chrome. `importable` excludes
  // already-followed + no-tm-match rows so the "X of Y" reads correctly.
  const counts = useMemo(() => {
    if (!artists) return { selected: 0, importable: 0, matched: 0, total: 0 };
    let importable = 0;
    let matched = 0;
    for (const a of artists) {
      if (a.tmMatch) matched += 1;
      if (a.tmMatch && !a.alreadyFollowed) importable += 1;
    }
    return {
      selected: selected.size,
      importable,
      matched,
      total: artists.length,
    };
  }, [artists, selected]);

  let phase: SpotifyImportPhase = 'idle';
  if (importSelected.isPending) phase = 'importing';
  else if (importedCount !== null && !artists) phase = 'done';
  else if (artists) phase = 'picking';
  else if (listFollowed.isPending) phase = 'loading';

  return {
    phase,
    artists,
    meta,
    selected,
    counts,
    error,
    importedCount,
    loadArtists,
    toggle,
    toggleAll,
    selectAll,
    deselectAll,
    submitImport,
    reset,
  };
}

export type SpotifyImportFlow = ReturnType<typeof useSpotifyImport>;
