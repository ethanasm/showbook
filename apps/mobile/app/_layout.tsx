/**
 * Root layout — provider chain for the entire mobile app.
 *
 * Provider order (outermost → innermost):
 *   GestureHandlerRootView   (required by react-native-gesture-handler)
 *   SafeAreaProvider         (insets for notches/home indicators)
 *   ThemeProvider            (color tokens, dark/light)
 *   AuthProvider             (must wrap tRPC because tRPC needs the token)
 *   tRPC Provider            (sub-component reads useAuth() to mint client)
 *   QueryClientProvider      (mounted via the same sub-component)
 *   Slot                     (the active route)
 *
 * The trpc client is created once per app session. Its `getToken` getter
 * reads from a ref that we keep in sync with useAuth().token, so the client
 * sees the latest token after sign-in/sign-out without being recreated.
 *
 * Font loading: loadAppFonts() is called during mount with the splash
 * screen kept visible until fonts are ready. Today loadAppFonts is a no-op
 * (system font fallbacks), so this gates the UI for one tick. When Geist
 * is wired up later, the gate will hold the splash until the .ttf files
 * are loaded — no other code change required.
 */

import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { ThemeProvider, useTheme } from '../lib/theme';
import { AuthProvider, useAuth } from '../lib/auth';
import { trpc, createQueryClient, createTrpcClient } from '../lib/trpc';
import { setMobileTelemetryLogger } from '../lib/telemetry';
import { CacheBridge } from '../lib/cache/CacheBridge';
import { deleteCacheDatabase } from '../lib/cache';
import { warmCacheForOfflineUse } from '../lib/cache/warmup';
import { useForegroundWarmup } from '../lib/cache/useForegroundWarmup';
import { loadAppFonts } from '../lib/fonts';
import { FeedbackProvider } from '../lib/feedback';
import {
  NetworkProvider,
  OfflineSyncProvider,
  useOfflineSync,
  type OutboxDispatch,
  type PendingMutation,
} from '../lib/network';
import { ToastHost } from '../components/Toast';
import { BannerHost } from '../components/Banner';
import { OfflineBanner } from '../components/OfflineBanner';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { PendingWritesDrawer } from '../components/PendingWritesDrawer';
import { PreviewMiniPlayer } from '../components/PreviewMiniPlayer';
import { PreviewPlayerProvider } from '../lib/preview-player-provider';
import { useNetwork } from '../lib/network';

// Keep the splash screen up until fonts are ready. Errors here are
// non-fatal — if preventAutoHideAsync rejects, the splash hides on its
// own schedule and the UI still renders once fontsLoaded flips to true.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout(): React.JSX.Element {
  const [fontsLoaded, setFontsLoaded] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    loadAppFonts()
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        setFontsLoaded(true);
        SplashScreen.hideAsync().catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!fontsLoaded) return <></>;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <FeedbackProvider>
            <ErrorBoundary>
              <AuthProvider>
                <TrpcProviders>
                  <CacheBridge>
                    <NetworkProvider>
                      <OfflineBridge>
                        <PreviewPlayerProvider>
                          <BannerHost />
                          <OfflineBanner />
                          {/*
                           * Root <Stack> exposes per-screen `presentation`
                           * options (modal + native swipe-down) to leaf
                           * route files via `<Stack.Screen options={...} />`.
                           * Defaults: header hidden, swipe-back gesture on.
                           */}
                          <Stack
                            screenOptions={{
                              headerShown: false,
                              gestureEnabled: true,
                            }}
                          />
                          <ToastHost />
                          <ThemedStatusBar />
                          <PendingWritesDrawerHost />
                          {/*
                           * Floating stop button — visible whenever the
                           * preview controller's `isPlaying` flag is set.
                           * Mounted at this level (above the Stack)
                           * so it survives navigation between Show /
                           * Artist / Song detail screens.
                           */}
                          <PreviewMiniPlayer />
                        </PreviewPlayerProvider>
                      </OfflineBridge>
                    </NetworkProvider>
                  </CacheBridge>
                </TrpcProviders>
              </AuthProvider>
            </ErrorBoundary>
          </FeedbackProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Bridges tRPC's vanilla client into the offline outbox dispatcher. Lives
 * inside TrpcProviders + NetworkProvider so it can read both contexts.
 * Exists as its own component so the dispatcher captures the freshest
 * client without re-mounting OfflineSyncProvider.
 *
 * The dispatcher refuses to apply pending writes when there's no active
 * session, which closes a race where a sign-out + sign-in (different
 * user) happens mid-replay and queued writes from the previous user
 * would be applied with the new user's bearer token. The cache cleanup
 * in `useSignOutCleanup` also drops the SQLite file, so the next
 * outbox read inside `replayOutbox` returns null and the loop short-
 * circuits — but enforcing the check here is defence-in-depth.
 */
function OfflineBridge({ children }: { children: React.ReactNode }): React.JSX.Element {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const userIdRef = React.useRef<string | null>(user?.id ?? null);
  React.useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  const dispatch = React.useCallback<OutboxDispatch>(
    async (write) => {
      if (!userIdRef.current) {
        // Surface as a TRPCError-shaped object so `classifyError` in
        // `replayOutbox` treats it as a hard 401 (non-transient) and
        // doesn't burn the backoff schedule retrying.
        const err = new Error('No active session — replay aborted') as Error & {
          data?: { httpStatus?: number };
        };
        err.data = { httpStatus: 401 };
        throw err;
      }
      const c = utils.client;
      const payload = write.payload as never;
      const m: PendingMutation = write.mutation;
      switch (m) {
        case 'shows.create':
          return c.shows.create.mutate(payload);
        case 'shows.update':
          return c.shows.update.mutate(payload);
        case 'shows.delete':
          return c.shows.delete.mutate(payload);
        case 'shows.updateState':
          return c.shows.updateState.mutate(payload);
        case 'shows.setSetlist':
          return c.shows.setSetlist.mutate(payload);
        case 'shows.setNotes':
          return c.shows.setNotes.mutate(payload);
        case 'venues.follow':
          return swallowAlreadyInState(() => c.venues.follow.mutate(payload));
        case 'venues.unfollow':
          return swallowAlreadyInState(() => c.venues.unfollow.mutate(payload));
        case 'performers.follow':
          return swallowAlreadyInState(() => c.performers.follow.mutate(payload));
        case 'performers.unfollow':
          return swallowAlreadyInState(() => c.performers.unfollow.mutate(payload));
        case 'preferences.update':
          return c.preferences.update.mutate(payload);
        case 'preferences.addRegion':
          return c.preferences.addRegion.mutate(payload);
        case 'preferences.removeRegion':
          // The server 404s when the region was already deleted from
          // another device — treat that as success so the queued row
          // doesn't stick forever.
          return swallowAlreadyInState(() => c.preferences.removeRegion.mutate(payload));
        case 'preferences.toggleRegion':
          return c.preferences.toggleRegion.mutate(payload);
        case 'spotify.createHypePlaylist':
          return c.spotify.createHypePlaylist.mutate(payload);
        case 'spotify.createHeardPlaylist':
          return c.spotify.createHeardPlaylist.mutate(payload);
        case 'discover.watchlist':
          // The server 409s when a show + link already exist; swallow so
          // a queued tap from a different device doesn't stick forever.
          return swallowAlreadyInState(() => c.discover.watchlist.mutate(payload));
        case 'discover.unwatchlist':
          // 404 fires when the show has already been removed.
          return swallowAlreadyInState(() => c.discover.unwatchlist.mutate(payload));
        default: {
          const _exhaustive: never = m;
          throw new Error(`Unknown pending mutation: ${String(_exhaustive)}`);
        }
      }
    },
    [utils],
  );
  return <OfflineSyncProvider dispatch={dispatch}>{children}</OfflineSyncProvider>;
}

/**
/**
 * On post-replay paths and offline mutations that move the server to a state
 * the user already wants, the server typically returns 404 (target row gone)
 * or 409 (already there). For follow/unfollow + region remove these are
 * end-state matches, not failures — swallow them so the queued row drops
 * cleanly. Other 4xx (e.g. addRegion 400 "max 5 regions") still surface.
 */
async function swallowAlreadyInState<T>(call: () => Promise<T>): Promise<T | { success: true }> {
  try {
    return await call();
  } catch (err) {
    const status =
      (err as { data?: { httpStatus?: number } } | null | undefined)?.data?.httpStatus ?? 0;
    if (status === 404 || status === 409) return { success: true };
    throw err;
  }
}

/**
 * Routes the StatusBar style to the resolved theme mode so dark
 * surfaces get light glyphs and vice versa. Lives inside ThemeProvider
 * so it sees the current `mode`; the `expo-status-bar` component
 * updates the native bar on each render.
 */
function ThemedStatusBar(): React.JSX.Element {
  const { mode } = useTheme();
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />;
}

function PendingWritesDrawerHost(): React.JSX.Element {
  const sync = useOfflineSync();
  const network = useNetwork();
  return (
    <PendingWritesDrawer
      open={sync.drawerOpen}
      onClose={sync.closeDrawer}
      entries={sync.entries}
      onRetry={sync.retry}
      onDiscard={sync.discard}
      online={network.online}
      syncing={sync.syncing}
    />
  );
}

function TrpcProviders({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { token, user } = useAuth();
  const tokenRef = React.useRef<string | null>(token);
  React.useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Both the QueryClient and the tRPC client are created exactly once.
  // The headers function on the http link reads tokenRef.current on every
  // request, so a fresh sign-in or sign-out is reflected immediately.
  const [queryClient] = React.useState(createQueryClient);
  const [trpcClient] = React.useState(() =>
    createTrpcClient(() => tokenRef.current),
  );

  // Wire the mobile telemetry sink to the tRPC client so any failed
  // procedure (or out-of-band failure like an R2 PUT 403) round-trips to
  // Axiom via `telemetry.logClientError`. Reset on unmount so a torn-down
  // client doesn't keep getting hit.
  React.useEffect(() => {
    setMobileTelemetryLogger((payload) => {
      // Auth required — silently drop reports before sign-in. The user
      // hasn't acted yet, so anything failing is environmental, and we
      // don't have a session to attribute it to.
      if (!tokenRef.current) return;
      void trpcClient.telemetry.logClientError
        .mutate({
          event: payload.event,
          message: payload.message,
          level: payload.level ?? 'error',
          context: payload.context,
        })
        .catch(() => undefined);
    });
    return () => setMobileTelemetryLogger(null);
  }, [trpcClient]);

  useSignOutCleanup(queryClient, user?.id ?? null);
  usePostSignInWarmup(trpcClient, queryClient, user?.id ?? null);
  useForegroundWarmup(trpcClient, queryClient, user?.id ?? null);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}

/**
 * Fires `warmCacheForOfflineUse` exactly once per sign-in (null → set
 * transition). Best-effort: failures are swallowed inside warm-up so the
 * sign-in flow never blocks on cache hydration. The warm-up walker also
 * runs `replayOutboxOnce` first to drain any queued writes from the
 * previous online session before we overwrite their cache slots with
 * fresh server state.
 */
function usePostSignInWarmup(
  trpcClient: ReturnType<typeof createTrpcClient>,
  queryClient: QueryClient,
  userId: string | null,
): void {
  const previousUserId = React.useRef<string | null>(userId);
  React.useEffect(() => {
    const prev = previousUserId.current;
    previousUserId.current = userId;
    if (prev || !userId) return;
    void warmCacheForOfflineUse({ client: trpcClient, queryClient }).catch(
      () => undefined,
    );
  }, [trpcClient, queryClient, userId]);
}

/**
 * Watches the `user` transition. When the previous render had a user and
 * the current render has none, drop everything tied to the old session:
 * the React Query in-memory cache, the SQLite-backed persisted cache,
 * and the pending-writes outbox. Without this the next user — same
 * device, different account — sees the previous user's shows / venues /
 * outbox until each query refetches over the new bearer.
 */
function useSignOutCleanup(queryClient: QueryClient, userId: string | null): void {
  const previousUserId = React.useRef<string | null>(userId);
  React.useEffect(() => {
    const prev = previousUserId.current;
    previousUserId.current = userId;
    if (prev && !userId) {
      queryClient.clear();
      void deleteCacheDatabase();
    }
  }, [queryClient, userId]);
}
