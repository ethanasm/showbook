"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

export type ListedArtist = {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  tmMatch: { tmAttractionId: string; name: string; imageUrl: string | null } | null;
  alreadyFollowed: boolean;
};

export type SpotifyImportPhase =
  | "idle"
  | "connecting"
  | "loading"
  | "picking"
  | "importing"
  | "done";

export interface UseSpotifyImportOptions {
  /** Called once an import succeeds; receives the count of newly-followed artists. */
  onImported?: (count: number) => void;
}

export function useSpotifyImport(opts: UseSpotifyImportOptions = {}) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [artists, setArtists] = useState<ListedArtist[] | null>(null);
  const [meta, setMeta] = useState<{
    total: number;
    resolved: number;
    truncated: boolean;
  } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const handlerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const popupRef = useRef<Window | null>(null);

  const listFollowed = trpc.spotifyImport.listFollowed.useMutation({
    onSuccess: (data) => {
      setArtists(data.artists);
      setMeta({
        total: data.totalCount,
        resolved: data.resolvedCount,
        truncated: data.truncated,
      });
      setSelected(
        new Set(
          data.artists
            .filter((a) => a.tmMatch && !a.alreadyFollowed)
            .map((a) => a.spotifyId),
        ),
      );
    },
    onError: (err) => setError(err.message),
  });

  const importSelected = trpc.spotifyImport.importSelected.useMutation({
    onSuccess: (data) => {
      setImportedCount(data.imported.length);
      setArtists(null);
      setSelected(new Set());
      utils.performers.followed.invalidate();
      utils.performers.list.invalidate();
      utils.performers.count.invalidate();
      utils.discover.followedFeed.invalidate();
      opts.onImported?.(data.imported.length);
    },
    onError: (err) => setError(err.message),
  });

  // Cleanup listener on unmount
  useEffect(() => {
    return () => {
      if (handlerRef.current) {
        window.removeEventListener("message", handlerRef.current);
        handlerRef.current = null;
      }
    };
  }, []);

  const startConnect = useCallback(() => {
    setError(null);
    setImportedCount(null);

    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "spotify-auth" && e.data.accessToken) {
        window.removeEventListener("message", handler);
        handlerRef.current = null;
        listFollowed.mutate({ accessToken: e.data.accessToken });
      }
      if (e.data?.type === "spotify-auth-error") {
        window.removeEventListener("message", handler);
        handlerRef.current = null;
        setError("Spotify authorization failed");
      }
    };
    handlerRef.current = handler;
    window.addEventListener("message", handler);

    const popup = window.open(
      "/api/spotify",
      "spotify-auth",
      "width=500,height=700,popup=yes",
    );
    popupRef.current = popup;
    if (popup) {
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          if (handlerRef.current) {
            window.removeEventListener("message", handlerRef.current);
            handlerRef.current = null;
          }
        }
      }, 500);
    }
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

  const submitImport = useCallback(() => {
    if (!artists) return;
    const byId = new Map(artists.map((a) => [a.spotifyId, a]));
    const payload = Array.from(selected)
      .map((id) => byId.get(id))
      .filter((a): a is ListedArtist => Boolean(a?.tmMatch))
      .map((a) => ({
        tmAttractionId: a.tmMatch!.tmAttractionId,
        name: a.tmMatch!.name,
        imageUrl: a.tmMatch!.imageUrl ?? undefined,
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

  let phase: SpotifyImportPhase = "idle";
  if (importSelected.isPending) phase = "importing";
  else if (importedCount !== null && !artists) phase = "done";
  else if (artists) phase = "picking";
  else if (listFollowed.isPending) phase = "loading";

  return {
    phase,
    artists,
    meta,
    selected,
    error,
    importedCount,
    isImporting: importSelected.isPending,
    startConnect,
    toggle,
    submitImport,
    reset,
  };
}
