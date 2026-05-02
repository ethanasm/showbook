/**
 * Auth context for the mobile app.
 *
 * Sign-in flow:
 *   1. Native Google OAuth via expo-auth-session/providers/google
 *      → returns a Google ID token in `response.params.id_token`.
 *   2. POST that to `${API_URL}/api/auth/mobile-token` (see
 *      apps/web/app/api/auth/mobile-token/route.ts), which verifies the
 *      token, runs the allowlist check, upserts the user, and mints a
 *      NextAuth-compatible JWT.
 *   3. Persist the JWT and user in expo-secure-store under
 *      `showbook.auth.token` / `showbook.auth.user`.
 *
 * The pure JWT-exchange helper lives in auth-helpers.ts so it can be unit
 * tested without expo. This file owns provider state, hook, and the OAuth
 * mechanics.
 *
 * First-run flag: `showbook.auth.firstRunComplete`. Unset = first run.
 * Set after the user finishes the last permission step. We expose
 * `isFirstRun` from useAuth so the consumer (sign-in screen) can route
 * appropriately after a successful sign-in.
 *
 * Why useIdTokenAuthRequest + a useEffect on response (not just
 * `await promptAsync`):
 *
 *   On native (iOS/Android), expo-auth-session uses ResponseType.Code by
 *   default and auto-exchanges the code for tokens *inside the hook*
 *   (see node_modules/expo-auth-session/build/providers/Google.js, the
 *   `setFullResult({ ...result, params: { id_token, access_token } })` block
 *   in the useAuthRequest useEffect). The imperative result returned from
 *   `promptAsync()` is the pre-exchange `result` — its `params` does NOT
 *   contain `id_token` on native. The id_token only appears on the
 *   *response* tuple element after the hook's internal exchange runs.
 *
 *   So we treat `promptAsync()` as a fire-and-forget trigger and watch the
 *   `response` state for `type === 'success'`, then read `id_token` from
 *   it and call exchangeGoogleIdTokenForSession from a useEffect.
 *
 *   useIdTokenAuthRequest also flips ResponseType to IdToken on web so the
 *   flow is direct there.
 */

import React from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { API_URL } from './env';
import {
  GOOGLE_OAUTH_CLIENT_ID_ANDROID,
  GOOGLE_OAUTH_CLIENT_ID_IOS,
  GOOGLE_OAUTH_CLIENT_ID_WEB,
  describeGoogleOAuthMisconfiguration,
} from './env';
import {
  exchangeGoogleIdTokenForSession,
  describeSignInError,
  isE2EMode,
  loadE2ETestSession,
  type SessionUser,
} from './auth-helpers';

// Required at module load to dismiss the in-app browser when the OAuth
// redirect comes back. Safe to call multiple times.
WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'showbook.auth.token';
const USER_KEY = 'showbook.auth.user';
const FIRST_RUN_KEY = 'showbook.auth.firstRunComplete';

export type { SessionUser };

export interface AuthContextValue {
  user: SessionUser | null;
  token: string | null;
  isLoading: boolean; // true while restoring the cached session on mount
  isSigningIn: boolean; // true while OAuth is in flight
  isFirstRun: boolean; // true if the user hasn't finished first-run yet
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  markFirstRunComplete: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue>({
  user: null,
  token: null,
  isLoading: true,
  isSigningIn: false,
  isFirstRun: true,
  error: null,
  signIn: async () => undefined,
  signOut: async () => undefined,
  markFirstRunComplete: async () => undefined,
});

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSigningIn, setIsSigningIn] = React.useState(false);
  // Default true: absence of the SecureStore flag means first-run not done.
  // The mount effect overwrites this after reading the stored value.
  const [isFirstRun, setIsFirstRun] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // expo-auth-session's hook MUST be called in the render body.
  // We use useIdTokenAuthRequest (not useAuthRequest) because it asks the
  // hook to populate `response.params.id_token` after the internal code
  // exchange completes. See the note at the top of this file.
  const [, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: GOOGLE_OAUTH_CLIENT_ID_IOS,
    androidClientId: GOOGLE_OAUTH_CLIENT_ID_ANDROID,
    webClientId: GOOGLE_OAUTH_CLIENT_ID_WEB,
  });

  // Keep a ref to promptAsync so signIn (returned in context) reads the
  // latest version after re-renders, even though signIn's useCallback deps
  // are empty.
  const promptAsyncRef = React.useRef(promptAsync);
  React.useEffect(() => {
    promptAsyncRef.current = promptAsync;
  }, [promptAsync]);

  // signIn's "in-flight" guard. Held in a ref so the callback's deps stay
  // empty (avoiding callback identity churn that would force consumers to
  // re-render).
  const isSigningInRef = React.useRef(false);

  // Restore cached session on mount.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [storedToken, storedUserJson, firstRunFlag] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
          SecureStore.getItemAsync(FIRST_RUN_KEY),
        ]);
        if (cancelled) return;
        if (storedToken && storedUserJson) {
          try {
            const parsed = JSON.parse(storedUserJson) as SessionUser;
            setToken(storedToken);
            setUser(parsed);
          } catch {
            // Corrupted entry — treat as signed-out
          }
        }
        // First-run is needed if we have a session AND the flag is unset.
        // For a brand new install (no session) the welcome screen will
        // run after sign-in completes.
        setIsFirstRun(firstRunFlag !== 'true');
      } catch {
        // SecureStore read failure (shouldn't happen) — stay signed out.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Helper that takes a Google ID token, exchanges it for a Showbook
  // session, persists it, and updates state. Called from the response
  // useEffect below.
  const exchangeAndPersist = React.useCallback(async (idToken: string) => {
    try {
      const session = await exchangeGoogleIdTokenForSession({
        idToken,
        apiUrl: API_URL,
      });

      // Persist before updating state so a fast remount sees the session.
      await Promise.all([
        SecureStore.setItemAsync(TOKEN_KEY, session.token),
        SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user)),
      ]);
      setToken(session.token);
      setUser(session.user);

      // Re-read first-run flag — it might be set already from a previous
      // install if SecureStore wasn't cleared.
      const firstRunFlag = await SecureStore.getItemAsync(FIRST_RUN_KEY);
      setIsFirstRun(firstRunFlag !== 'true');
    } catch (err) {
      setError(describeSignInError(err));
    } finally {
      isSigningInRef.current = false;
      setIsSigningIn(false);
    }
  }, []);

  // Watch the auth-session response for success. The id_token is only
  // available here (not from the imperative promptAsync return value) on
  // native, because the hook auto-exchanges the code-flow result inside
  // its own useEffect.
  React.useEffect(() => {
    if (!response) return;
    if (response.type !== 'success') {
      // cancel/dismiss/error are handled in signIn after promptAsync
      // returns. Don't double-handle here.
      return;
    }
    const idToken = response.params?.id_token;
    if (typeof idToken !== 'string' || !idToken) {
      setError(describeSignInError(new Error('invalid_response')));
      isSigningInRef.current = false;
      setIsSigningIn(false);
      return;
    }
    void exchangeAndPersist(idToken);
  }, [response, exchangeAndPersist]);

  const signIn = React.useCallback(async () => {
    if (isSigningInRef.current) return;
    setError(null);

    // ---- E2E TEST MODE BYPASS — DO NOT REMOVE WITHOUT READING ----
    // Active only when EXPO_PUBLIC_E2E_MODE === '1', which is set ONLY by
    // the `e2e` EAS profile (see eas.json). Production builds (TestFlight,
    // Play Store) ship with this var unset, so this branch is dead code
    // there. Maestro pre-seeds SecureStore with a JWT under
    // `e2e.test-token` + a SessionUser blob under `e2e.test-user` before
    // tapping "Continue with Google" — see apps/mobile/e2e/flows/sign-in.yaml.
    // If either key is missing we surface invalid_response so a misconfigured
    // flow fails loudly rather than silently signing in.
    if (isE2EMode()) {
      isSigningInRef.current = true;
      setIsSigningIn(true);
      try {
        const session = await loadE2ETestSession(SecureStore);
        if (!session) {
          setError(describeSignInError(new Error('invalid_response')));
          return;
        }
        await Promise.all([
          SecureStore.setItemAsync(TOKEN_KEY, session.token),
          SecureStore.setItemAsync(USER_KEY, JSON.stringify(session.user)),
        ]);
        setToken(session.token);
        setUser(session.user);
        const firstRunFlag = await SecureStore.getItemAsync(FIRST_RUN_KEY);
        setIsFirstRun(firstRunFlag !== 'true');
      } catch (err) {
        setError(describeSignInError(err));
      } finally {
        isSigningInRef.current = false;
        setIsSigningIn(false);
      }
      return;
    }
    // ---- END E2E TEST MODE BYPASS ----

    const platform: 'ios' | 'android' | 'web' =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    const configError = describeGoogleOAuthMisconfiguration(platform);
    if (configError) {
      setError(`Sign-in is not configured: ${configError}`);
      return;
    }

    isSigningInRef.current = true;
    setIsSigningIn(true);
    try {
      const result = await promptAsyncRef.current();
      // result.type ∈ 'cancel' | 'dismiss' | 'success' | 'error' | 'opened' | 'locked'.
      // We don't read `result.params.id_token` here because on native that
      // value isn't populated yet — the response useEffect handles 'success'.
      if (result?.type === 'cancel' || result?.type === 'dismiss') {
        // User cancelled — silent, no error
        isSigningInRef.current = false;
        setIsSigningIn(false);
        return;
      }
      if (result?.type === 'error') {
        setError(describeSignInError(new Error('oauth_error')));
        isSigningInRef.current = false;
        setIsSigningIn(false);
        return;
      }
      // For 'success', the response useEffect picks it up and calls
      // exchangeAndPersist. signIn intentionally does not await it —
      // isSigningIn stays true until exchangeAndPersist runs to completion.
    } catch (err) {
      setError(describeSignInError(err));
      isSigningInRef.current = false;
      setIsSigningIn(false);
    }
  }, []);

  const signOut = React.useCallback(async () => {
    // Drop every persisted artefact tied to the previous user. The
    // first-run flag has to be deleted from SecureStore (not just reset
    // in memory) or `exchangeAndPersist` would reload the stale `'true'`
    // value on the next sign-in and skip the welcome flow for a
    // different account on the same device. The React Query cache and
    // SQLite cache are cleared by a sibling effect in the layout that
    // watches the `user` transition (see `_layout.tsx`).
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined),
      SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined),
      SecureStore.deleteItemAsync(FIRST_RUN_KEY).catch(() => undefined),
    ]);
    setToken(null);
    setUser(null);
    setError(null);
    setIsFirstRun(true);
  }, []);

  const markFirstRunComplete = React.useCallback(async () => {
    await SecureStore.setItemAsync(FIRST_RUN_KEY, 'true').catch(() => undefined);
    setIsFirstRun(false);
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isLoading,
      isSigningIn,
      isFirstRun,
      error,
      signIn,
      signOut,
      markFirstRunComplete,
    }),
    [
      user,
      token,
      isLoading,
      isSigningIn,
      isFirstRun,
      error,
      signIn,
      signOut,
      markFirstRunComplete,
    ],
  );

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  return React.useContext(AuthContext);
}
