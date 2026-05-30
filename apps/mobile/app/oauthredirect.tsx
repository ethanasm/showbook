/**
 * Fallback OAuth callback handler.
 *
 * ASWebAuthenticationSession (the iOS system browser used internally by
 * `expo-web-browser.openAuthSessionAsync`) is supposed to intercept the
 * Google OAuth callback URL automatically. When it does, the user never
 * sees this route — the sign-in completes inside the auth provider's
 * `response` useEffect and the auth gate redirects to `(tabs)`.
 *
 * But ASWebAuthenticationSession's intercept can fail on iOS when the
 * Google OAuth flow goes through intermediate 301 redirects — the
 * `prompt=consent` screen forced for Advanced Protection Program
 * accounts is the documented case (expo/expo #34187). When that
 * happens, iOS falls through to the OS deep-link router, the URL
 * arrives at Showbook as a regular `Linking` event, and Expo Router
 * routes the path `/oauthredirect` to this component.
 *
 * Without this route, Expo Router renders its default 404 ("Unmatched
 * Route") page and the sign-in is permanently stuck — that's what
 * Brandon hit on his iOS TestFlight install on 2026-05-30 after
 * PR #494 fixed the Android side.
 *
 * The route reads the `code` and `state` URL params and calls
 * `completeOAuthCallback` on the auth provider, which does the
 * code-for-token exchange manually against Google's token endpoint
 * using the in-memory `AuthRequest`'s PKCE codeVerifier. The
 * `completeOAuthCallback` no-ops if the happy path already finished
 * (sign-in completed via ASWebAuthenticationSession), so the auth code
 * can't be redeemed twice.
 *
 * Documented in:
 *   - expo/router #157  (Android variant of the same race)
 *   - expo/expo  #22662 (canonical Unmatched-Route report)
 *   - expo/expo  #34187 (iOS 301-redirect ASWebAuthSession miss)
 */

import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default function OAuthRedirectRoute(): React.JSX.Element {
  const params = useLocalSearchParams<{
    code?: string | string[];
    state?: string | string[];
    error?: string | string[];
  }>();
  const code = firstParam(params.code);
  const state = firstParam(params.state);
  const oauthError = firstParam(params.error);

  const { user, isSigningIn, completeOAuthCallback, error: authError } = useAuth();
  const { tokens } = useTheme();
  const [done, setDone] = React.useState(false);

  React.useEffect(() => {
    if (done) return;
    if (oauthError) {
      setDone(true);
      return;
    }
    // Android race-with-polyfill guard: when expo-web-browser's polyfill
    // already caught the URL (the happy path on Android when the Linking
    // event beats AppState), `isSigningIn` stays true from the moment
    // `signIn` was called through to `exchangeAndPersist` completing.
    // The same URL is also routed here by expo-router, but we don't want
    // to redeem the authorization code twice — Google's token endpoint
    // returns `invalid_grant` on the second exchange. Skip our manual
    // path entirely; the response useEffect in AuthProvider will set
    // `user` once exchangeAndPersist finishes and the `if (user)` branch
    // below redirects to `(tabs)`.
    if (isSigningIn) return;
    if (typeof code === 'string' && typeof state === 'string') {
      void completeOAuthCallback({ code, state }).finally(() => setDone(true));
      return;
    }
    // No usable params (someone opened the deep link manually, or the
    // callback URL was malformed). Bounce to sign-in.
    setDone(true);
  }, [code, state, oauthError, completeOAuthCallback, done, isSigningIn]);

  if (user) return <Redirect href="/(tabs)" />;
  if (done) return <Redirect href="/(auth)/signin" />;

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: tokens.colors.bg }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.center}>
        <ActivityIndicator color={tokens.colors.ink} />
        <Text style={[styles.message, { color: tokens.colors.muted }]}>
          {authError ? authError : 'Finishing sign-in…'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  message: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
    textAlign: 'center',
  },
});
