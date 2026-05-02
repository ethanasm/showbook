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
 *   BottomSheetModalProvider (must be inside GestureHandlerRootView)
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
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

import { ThemeProvider } from '../lib/theme';
import { AuthProvider, useAuth } from '../lib/auth';
import { trpc, createQueryClient, createTrpcClient } from '../lib/trpc';
import { loadAppFonts } from '../lib/fonts';
import { FeedbackProvider } from '../lib/feedback';
import { ToastHost } from '../components/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';

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
                  <BottomSheetModalProvider>
                    <Slot />
                    <ToastHost />
                    <StatusBar style="auto" />
                  </BottomSheetModalProvider>
                </TrpcProviders>
              </AuthProvider>
            </ErrorBoundary>
          </FeedbackProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function TrpcProviders({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { token } = useAuth();
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

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
