/**
 * Mobile mirror of `apps/web/components/spotify/useSpotifyConnection.ts`.
 *
 * On mobile we don't have a popup window — `expo-web-browser` opens an
 * in-app auth session, the server-side callback persists the token, and
 * when the browser dismisses we invalidate `spotify.connectionStatus`
 * so the cached state flips to connected.
 *
 * Same `requireConnection(action)` API as the web hook so call sites in
 * Phase 3+ (Hype playlist, Save to Spotify, etc.) wrap their tap
 * handlers identically: if connected, run; otherwise present the sheet,
 * resume the action on success.
 */

import { useCallback, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { trpc } from './trpc';
import { API_URL } from './env';

export type SpotifyConnectionStatus =
  | { status: 'loading' }
  | { status: 'disconnected' }
  | {
      status: 'connected';
      displayName: string | null;
      product: string | null;
      spotifyUserId: string | null;
    };

export interface UseSpotifyConnectionOptions {
  onError?: (message: string) => void;
}

export function useSpotifyConnection(opts: UseSpotifyConnectionOptions = {}) {
  const utils = trpc.useUtils();
  const status = trpc.spotify.connectionStatus.useQuery();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingActionRef = useRef<(() => void | Promise<void>) | null>(null);

  /**
   * Open the OAuth in-app browser, wait for it to dismiss, then
   * re-resolve connection status. The web callback handles persistence
   * — we just need to detect "user came back" and refetch.
   */
  const startConnect = useCallback(async () => {
    if (!API_URL) {
      const msg = 'API URL not configured. Reinstall the app and try again.';
      setError(msg);
      opts.onError?.(msg);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // The web app's `/api/spotify` route requires an authed session;
      // the mobile WebView shares the same Showbook session cookie set
      // via the mobile token bridge, so the popup-style HTML the
      // callback emits at the end is a benign "you can close this" page.
      const result = await WebBrowser.openAuthSessionAsync(
        `${API_URL}/api/spotify`,
        `${API_URL}/api/spotify/callback`,
      );
      if (result.type === 'cancel' || result.type === 'dismiss') {
        // Treat dismiss as a soft cancel — the user may have completed
        // OAuth and just closed the sheet, so we still re-resolve the
        // status before bailing.
        await utils.spotify.connectionStatus.invalidate();
        const fresh = await utils.spotify.connectionStatus.fetch();
        if (!fresh.connected) {
          // Genuine cancel — the action stays pending for retry.
          return;
        }
      } else if (result.type !== 'success') {
        const msg = 'Spotify connection failed. Try again.';
        setError(msg);
        opts.onError?.(msg);
        return;
      }
      await utils.spotify.connectionStatus.invalidate();
      setSheetOpen(false);
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      if (action) {
        try {
          await action();
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Action failed';
          setError(msg);
          opts.onError?.(msg);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [opts, utils.spotify.connectionStatus]);

  const requireConnection = useCallback(
    async (action: () => void | Promise<void>) => {
      const data = status.data;
      if (data?.connected) {
        await action();
        return;
      }
      pendingActionRef.current = action;
      setSheetOpen(true);
    },
    [status.data],
  );

  const closeSheet = useCallback(() => {
    pendingActionRef.current = null;
    setSheetOpen(false);
    setError(null);
  }, []);

  const connection: SpotifyConnectionStatus = !status.data
    ? { status: 'loading' }
    : status.data.connected
      ? {
          status: 'connected',
          displayName: status.data.displayName ?? null,
          product: status.data.product ?? null,
          spotifyUserId: status.data.spotifyUserId ?? null,
        }
      : { status: 'disconnected' };

  return {
    connection,
    requireConnection,
    sheetOpen,
    closeSheet,
    startConnect,
    busy,
    error,
  };
}
