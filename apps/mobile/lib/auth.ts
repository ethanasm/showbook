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
  isFirstRun: false,
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
  const [isFirstRun, setIsFirstRun] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // expo-auth-session's hook MUST be called in the render body.
  // If a client ID is missing for the current platform, pass undefined and
  // surface a config error when signIn is invoked.
  const [, , promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_OAUTH_CLIENT_ID_IOS,
    androidClientId: GOOGLE_OAUTH_CLIENT_ID_ANDROID,
    webClientId: GOOGLE_OAUTH_CLIENT_ID_WEB,
  });

  // Keep a ref to promptAsync so signIn (returned in context) reads the
  // latest version after re-renders.
  const promptAsyncRef = React.useRef(promptAsync);
  React.useEffect(() => {
    promptAsyncRef.current = promptAsync;
  }, [promptAsync]);

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

  const signIn = React.useCallback(async () => {
    if (isSigningIn) return;
    setError(null);

    const platform: 'ios' | 'android' | 'web' =
      Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
    const configError = describeGoogleOAuthMisconfiguration(platform);
    if (configError) {
      setError(`Sign-in is not configured: ${configError}`);
      return;
    }

    setIsSigningIn(true);
    try {
      const result = await promptAsyncRef.current();
      if (result.type === 'cancel' || result.type === 'dismiss') {
        // User cancelled — silent, no error
        return;
      }
      if (result.type === 'error') {
        setError(describeSignInError(new Error('oauth_error')));
        return;
      }
      if (result.type !== 'success') {
        setError(describeSignInError(new Error('oauth_error')));
        return;
      }
      const idToken = result.params?.id_token;
      if (!idToken || typeof idToken !== 'string') {
        setError(describeSignInError(new Error('invalid_response')));
        return;
      }

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
      setIsSigningIn(false);
    }
  }, [isSigningIn]);

  const signOut = React.useCallback(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined),
      SecureStore.deleteItemAsync(USER_KEY).catch(() => undefined),
    ]);
    setToken(null);
    setUser(null);
    setError(null);
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
