"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";

// Shared key with `apps/web/app/api/spotify/callback/route.ts` — must agree
// for the localStorage fallback to wake the originating tab when mobile
// Safari nulls out `window.opener` after the cross-origin Spotify hop.
const SPOTIFY_AUTH_LS_KEY = "showbook:spotify-auth";

/**
 * Outcome callbacks for `requireConnection`. The hook wraps a click
 * handler in OAuth-or-action: if connected, the action runs immediately;
 * otherwise the modal opens and the action fires automatically once the
 * popup posts back `spotify-connected`. If the user closes the popup
 * without granting, `onCancel` fires.
 */
export interface UseSpotifyConnectionOptions {
  onError?: (message: string) => void;
}

export type SpotifyConnectionStatus =
  | { status: "loading" }
  | { status: "disconnected" }
  | {
      status: "connected";
      displayName: string | null;
      product: string | null;
      spotifyUserId: string | null;
    };

/**
 * The connect-once hook. Every Spotify-touching feature on the web wraps
 * its action in `await requireConnection(() => doTheThing())`:
 *
 *   - If a token exists, the action fires immediately.
 *   - If not, the modal opens. On `spotify-connected` postMessage from
 *     the OAuth callback, the action fires automatically. No second
 *     click needed.
 *
 * Multiple call sites can mount the hook in parallel (each manages its
 * own modal-open state); they share the cached `connectionStatus`
 * query so a successful connect from one component invalidates the
 * status everywhere.
 */
export function useSpotifyConnection(opts: UseSpotifyConnectionOptions = {}) {
  const utils = trpc.useUtils();
  const status = trpc.spotify.connectionStatus.useQuery();
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);
  const popupRef = useRef<Window | null>(null);
  const messageHandlerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const storageHandlerRef = useRef<((e: StorageEvent) => void) | null>(null);

  // Wipe listeners on unmount.
  useEffect(() => {
    return () => {
      if (messageHandlerRef.current) {
        window.removeEventListener("message", messageHandlerRef.current);
        messageHandlerRef.current = null;
      }
      if (storageHandlerRef.current) {
        window.removeEventListener("storage", storageHandlerRef.current);
        storageHandlerRef.current = null;
      }
    };
  }, []);

  const cleanup = useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current);
      messageHandlerRef.current = null;
    }
    if (storageHandlerRef.current) {
      window.removeEventListener("storage", storageHandlerRef.current);
      storageHandlerRef.current = null;
    }
    popupRef.current = null;
  }, []);

  const finishConnect = useCallback(
    async (kind: "ok" | "error") => {
      cleanup();
      setModalOpen(false);
      try {
        window.localStorage.removeItem(SPOTIFY_AUTH_LS_KEY);
      } catch {
        // Private-mode quota errors etc. — non-fatal.
      }
      if (kind === "error") {
        const msg = "Spotify connection failed. Try again.";
        setError(msg);
        opts.onError?.(msg);
        pendingActionRef.current = null;
        return;
      }
      // Refresh the status query so consumers re-render in the connected
      // state, then fire whatever the user originally clicked.
      await utils.spotify.connectionStatus.invalidate();
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      if (action) {
        try {
          await action();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Action failed";
          setError(msg);
          opts.onError?.(msg);
        }
      }
    },
    [cleanup, opts, utils.spotify.connectionStatus],
  );

  const handlePayload = useCallback(
    (data: unknown): boolean => {
      if (!data || typeof data !== "object") return false;
      const payload = data as { type?: unknown };
      if (payload.type === "spotify-connected") {
        void finishConnect("ok");
        return true;
      }
      if (payload.type === "spotify-auth-error") {
        void finishConnect("error");
        return true;
      }
      return false;
    },
    [finishConnect],
  );

  const openPopupAndListen = useCallback(() => {
    setError(null);
    try {
      window.localStorage.removeItem(SPOTIFY_AUTH_LS_KEY);
    } catch {
      // ignore
    }

    const message = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      handlePayload(e.data);
    };
    messageHandlerRef.current = message;
    window.addEventListener("message", message);

    const storage = (e: StorageEvent) => {
      if (e.key !== SPOTIFY_AUTH_LS_KEY || !e.newValue) return;
      try {
        handlePayload(JSON.parse(e.newValue));
      } catch {
        /* malformed payload, ignore */
      }
    };
    storageHandlerRef.current = storage;
    window.addEventListener("storage", storage);

    const popup = window.open(
      "/api/spotify",
      "spotify-auth",
      "width=500,height=700,popup=yes",
    );
    popupRef.current = popup;
    if (!popup) {
      // Popup blocker engaged — surface a friendly error so the caller
      // can render a "allow popups" hint.
      const msg = "Please allow popups for this site to connect Spotify.";
      setError(msg);
      opts.onError?.(msg);
      cleanup();
      setModalOpen(false);
      return;
    }
    const checkClosed = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(checkClosed);
        // If the popup closed *without* posting spotify-connected, treat
        // as a cancellation. The status query will re-resolve to
        // disconnected and the modal stays open so the user can retry.
        if (pendingActionRef.current && popupRef.current) {
          // Still pending — fall through to "modal stays visible".
          popupRef.current = null;
        }
      }
    }, 500);
  }, [cleanup, handlePayload, opts]);

  const requireConnection = useCallback(
    async (action: () => void | Promise<void>) => {
      const data = status.data;
      if (data?.connected) {
        await action();
        return;
      }
      pendingActionRef.current = action;
      setModalOpen(true);
    },
    [status.data],
  );

  // The "Connect" button on the modal opens the OAuth popup. Separate
  // from `requireConnection` so the consumer can render the modal with
  // its own copy and trigger the popup from a click handler that
  // inherits the user gesture.
  const startConnect = useCallback(() => {
    openPopupAndListen();
  }, [openPopupAndListen]);

  const closeModal = useCallback(() => {
    pendingActionRef.current = null;
    setModalOpen(false);
    setError(null);
    cleanup();
  }, [cleanup]);

  const connection: SpotifyConnectionStatus = !status.data
    ? { status: "loading" }
    : status.data.connected
    ? {
        status: "connected",
        displayName: status.data.displayName ?? null,
        product: status.data.product ?? null,
        spotifyUserId: status.data.spotifyUserId ?? null,
      }
    : { status: "disconnected" };

  return {
    connection,
    requireConnection,
    modalOpen,
    closeModal,
    startConnect,
    error,
  };
}
