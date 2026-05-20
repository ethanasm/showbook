/**
 * Mobile Gmail OAuth handshake. Mirrors `apps/mobile/lib/spotify-connection.ts`
 * but Gmail tokens aren't persisted server-side — instead, the callback
 * ships the short-lived (1h) access token back via the
 * `showbook://gmail/connected?accessToken=…` redirect URL. The
 * `ASWebAuthenticationSession` / Chrome Custom Tabs sandbox guarantees
 * the URL is captured by this app and never exposed to anything else
 * on the device, so passing the token through the URL is safe within
 * the auth-session boundary.
 *
 * The hook returns a `connect()` action that resolves with the token
 * (or `null` on user cancel) and rejects with a user-readable string
 * on error.
 */

import { useCallback, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';

import { API_URL } from './env';
import {
  buildGmailOAuthStartUrl,
  describeGmailRedirectError,
  MOBILE_REDIRECT_SCHEME,
  parseGmailRedirect,
} from './gmail-import/redirect';

export interface UseGmailConnectionResult {
  /**
   * Open the OAuth in-app browser. `bearerToken` is the Showbook mobile
   * JWT — required because the auth-session browser has no Showbook
   * cookie jar; without it the server has no way to identify the
   * caller and returns `session_missing`.
   */
  connect: (bearerToken: string | null) => Promise<string | null>;
  busy: boolean;
  error: string | null;
  /** Clear the surfaced error without re-running connect. */
  clearError: () => void;
}

export function useGmailConnection(): UseGmailConnectionResult {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (
    bearerToken: string | null,
  ): Promise<string | null> => {
    if (!API_URL) {
      const msg = 'API URL not configured. Reinstall the app and try again.';
      setError(msg);
      return null;
    }
    if (!bearerToken) {
      const msg = 'Sign in to Showbook first, then retry.';
      setError(msg);
      return null;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await WebBrowser.openAuthSessionAsync(
        buildGmailOAuthStartUrl(API_URL, bearerToken),
        MOBILE_REDIRECT_SCHEME,
      );
      if (result.type === 'cancel' || result.type === 'dismiss') {
        return null;
      }
      if (result.type !== 'success') {
        const msg = 'Gmail connection failed. Try again.';
        setError(msg);
        return null;
      }
      const parsed = parseGmailRedirect(result.url);
      if (!parsed) {
        const msg = 'Gmail handshake returned an unexpected response.';
        setError(msg);
        return null;
      }
      if (parsed.status === 'error') {
        const msg = describeGmailRedirectError(parsed.reason);
        setError(msg);
        return null;
      }
      return parsed.accessToken;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gmail connection failed.';
      setError(msg);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { connect, busy, error, clearError };
}
