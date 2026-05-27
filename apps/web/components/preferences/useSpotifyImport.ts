"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

// Shared with apps/web/app/api/spotify/callback/route.ts — both ends must
// agree on this key for the localStorage fallback to work.
const SPOTIFY_AUTH_LS_KEY = "showbook:spotify-auth";

// Map the `reason` string the popup broadcasts back into a user-facing
// message. Reasons correspond to branches in apps/web/app/api/spotify/
// (route.ts + callback/route.ts).
function messageForReason(reason: string | null): string {
  switch (reason) {
    case "access_denied":
      return "Spotify connection canceled.";
    case "session_missing":
      return "Your Showbook session was lost during the Spotify hop. Please sign in again and retry.";
    case "state_mismatch":
      return "Spotify connection failed (security check). Please try again.";
    case "token_exchange_failed":
      return "Spotify rejected the token exchange. Please try again.";
    case "network":
      return "Couldn't reach Spotify. Please try again.";
    case "misconfigured":
      return "Spotify import isn't configured on this server.";
    case "unknown":
    default:
      return "Spotify authorization failed.";
  }
}

export type ListedArtist = {
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
};

export type SpotifyImportPhase =
  | "idle"
  | "connecting"
  | "loading"
  | "picking"
  | "importing"
  | "done";

export interface UseSpotifyImportOptions {
  /**
   * Called once an import succeeds. Receives the count of newly-followed
   * artists and their performer IDs so callers can drive a "still
   * importing…" UI that polls `discover.ingestStatus` until the
   * background ingest jobs for those performers finish.
   */
  onImported?: (result: { count: number; performerIds: string[] }) => void;
}

export function useSpotifyImport(opts: UseSpotifyImportOptions = {}) {
  const utils = trpc.useUtils();
  const router = useRouter();
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
  const storageHandlerRef = useRef<((e: StorageEvent) => void) | null>(null);
  const popupRef = useRef<Window | null>(null);

  const listFollowed = trpc.spotifyImport.listFollowed.useMutation({
    meta: { errorToast: false },
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
    meta: { errorToast: false },
    onSuccess: (data) => {
      setImportedCount(data.imported.length);
      setArtists(null);
      setSelected(new Set());
      utils.performers.followed.invalidate();
      utils.performers.list.invalidate();
      utils.performers.count.invalidate();
      utils.discover.followedFeed.invalidate();
      utils.discover.followedArtistsFeed.invalidate();
      // The IngestStatusPoller only refetches on a 2s loop while it sees
      // pending work. Without this invalidate, the poller stays asleep
      // after import — so per-artist loading dots and the
      // "Loading shows… X/N" header never appear even though pg-boss is
      // actively running ingest jobs for the freshly-followed performers.
      utils.discover.ingestStatus.invalidate();
      opts.onImported?.({
        count: data.imported.length,
        performerIds: data.imported.map((i) => i.performerId),
      });
      // Artist-source imports always land on the followed-artists tab in
      // Discover. Soft navigation: when already on /discover, this only
      // updates the search params (the View reacts via useSearchParams),
      // so the modal's onClose timeout still runs without remounting.
      router.push("/discover?tab=artists");
    },
    onError: (err) => setError(err.message),
  });

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      if (handlerRef.current) {
        window.removeEventListener("message", handlerRef.current);
        handlerRef.current = null;
      }
      if (storageHandlerRef.current) {
        window.removeEventListener("storage", storageHandlerRef.current);
        storageHandlerRef.current = null;
      }
    };
  }, []);

  const startConnect = useCallback(() => {
    setError(null);
    setImportedCount(null);

    // Drop any stale auth payload from a previous (aborted) flow so the
    // storage listener below only fires for this round-trip.
    try {
      window.localStorage.removeItem(SPOTIFY_AUTH_LS_KEY);
    } catch {
      // Private-mode quota errors etc. — non-fatal.
    }

    const cleanup = () => {
      if (handlerRef.current) {
        window.removeEventListener("message", handlerRef.current);
        handlerRef.current = null;
      }
      if (storageHandlerRef.current) {
        window.removeEventListener("storage", storageHandlerRef.current);
        storageHandlerRef.current = null;
      }
    };

    // Track whether we received a payload from the popup. Used by the
    // checkClosed interval below to decide whether to show "popup closed
    // before completing" feedback.
    let payloadReceived = false;

    const handlePayload = (data: unknown): boolean => {
      if (!data || typeof data !== "object") return false;
      // Connect-once flow: the callback persists tokens server-side and
      // posts `spotify-connected` (no token in payload). The legacy
      // `spotify-auth` shape (with an `accessToken` field) stays accepted
      // as a fallback for any in-flight popup that started against an
      // older callback build during the rollout. `accessToken` is no
      // longer threaded into `listFollowed` either way.
      const payload = data as {
        type?: unknown;
        reason?: unknown;
      };
      if (
        payload.type === "spotify-connected" ||
        payload.type === "spotify-auth"
      ) {
        payloadReceived = true;
        cleanup();
        try {
          window.localStorage.removeItem(SPOTIFY_AUTH_LS_KEY);
        } catch {
          /* ignore */
        }
        utils.spotify.connectionStatus.invalidate();
        listFollowed.mutate({});
        return true;
      }
      if (payload.type === "spotify-auth-error") {
        payloadReceived = true;
        cleanup();
        try {
          window.localStorage.removeItem(SPOTIFY_AUTH_LS_KEY);
        } catch {
          /* ignore */
        }
        const reason =
          typeof payload.reason === "string" ? payload.reason : null;
        setError(messageForReason(reason));
        return true;
      }
      return false;
    };

    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      handlePayload(e.data);
    };
    handlerRef.current = handler;
    window.addEventListener("message", handler);

    // localStorage fallback: mobile Safari typically nulls out window.opener
    // after the cross-origin Spotify hop, so the popup's postMessage never
    // arrives. The callback also writes the token to localStorage, which
    // dispatches a storage event in this (originating) tab cross-window.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SPOTIFY_AUTH_LS_KEY || !e.newValue) return;
      try {
        handlePayload(JSON.parse(e.newValue));
      } catch {
        /* malformed payload, ignore */
      }
    };
    storageHandlerRef.current = onStorage;
    window.addEventListener("storage", onStorage);

    const popup = window.open(
      "/api/spotify",
      "spotify-auth",
      "width=500,height=700,popup=yes",
    );
    popupRef.current = popup;
    if (!popup) {
      // Popup blocked by the browser (most often Safari with default
      // settings, or content blockers). Without this, the user clicks
      // Connect Spotify and absolutely nothing visible happens.
      cleanup();
      setError(
        "Couldn't open the Spotify popup. Allow popups for Showbook and try again.",
      );
      return;
    }
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        cleanup();
        // The popup closed without ever sending us an auth-success or
        // auth-error payload — most often the user dismissed the Spotify
        // dialog or closed the tab. Surface that so the connect button
        // doesn't look broken.
        if (!payloadReceived) {
          setError(
            "Spotify connection canceled. Click Connect Spotify to try again.",
          );
        }
      }
    }, 500);
  }, [listFollowed, utils.spotify.connectionStatus]);

  // Direct listFollowed trigger for callers that already know the user is
  // connected (the preferences page reads `connectionStatus` and uses this
  // to load the picker without bouncing through OAuth again). The popup
  // flow lives in `startConnect`; this is the no-popup fast path.
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
        musicbrainzId: a.tmMatch!.musicbrainzId ?? undefined,
        // Spotify followed-artist payload already carries the catalog
        // id; thread it through so the new performer row gets its
        // `spotify_artist_id` set at create time without needing the
        // fire-and-forget hook in matchOrCreatePerformer to search by
        // name afterwards.
        spotifyArtistId: a.spotifyId,
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
    loadArtists,
    toggle,
    submitImport,
    reset,
  };
}
