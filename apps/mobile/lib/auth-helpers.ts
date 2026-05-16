/**
 * Pure auth helpers — no React Native or Expo imports.
 *
 * Lives separately from auth.ts so it can be imported in node:test without
 * pulling in expo-secure-store / expo-auth-session (mirrors theme.ts /
 * theme-utils.ts split from Task 4).
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export interface SessionData {
  token: string;
  user: SessionUser;
}

/**
 * Exchange a Google ID token for a NextAuth-compatible JWT by calling the
 * web app's `/api/auth/mobile-token` endpoint (see
 * `apps/web/app/api/auth/mobile-token/route.ts`).
 *
 * Throws:
 *   - `invalid_google_token` (401)
 *   - `access_denied` (403, allowlist rejection)
 *   - `server_error_<status>` (any other non-2xx)
 *   - `invalid_response` (malformed body)
 *   - re-raises network errors from `fetch`
 *
 * `fetchImpl` is injectable for tests; defaults to global fetch.
 */
export async function exchangeGoogleIdTokenForSession(args: {
  idToken: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<SessionData> {
  const { idToken, apiUrl, fetchImpl = fetch } = args;
  const endpoints = mobileTokenEndpointCandidates(apiUrl);
  let res: Response;
  let lastNetworkError: unknown;
  let lastEndpoint = '';
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  };

  for (const endpoint of endpoints) {
    lastEndpoint = endpoint;
    try {
      res = await fetchImpl(endpoint, init);
      return await sessionFromMobileTokenResponse(res);
    } catch (err) {
      if (!isNetworkError(err)) throw err;
      lastNetworkError = err;
    }
  }

  throw new Error(apiUnreachableErrorMessage(lastNetworkError, lastEndpoint));
}

async function sessionFromMobileTokenResponse(res: Response): Promise<SessionData> {
  if (res.status === 401) throw new Error('invalid_google_token');
  if (res.status === 403) throw new Error('access_denied');
  if (res.status === 429) throw new Error('rate_limited');
  if (!res.ok) throw new Error(`server_error_${res.status}`);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('invalid_response');
  }
  if (!isSessionData(data)) {
    throw new Error('invalid_response');
  }
  return data;
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.startsWith('api_unreachable:') || /network|fetch|request|connection|certificate|ssl|tls/i.test(err.message);
}

export function mobileTokenEndpointCandidates(apiUrl: string): string[] {
  const primary = mobileTokenEndpoint(apiUrl);
  const url = new URL(primary);
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!isLocalhost) return [primary];

  const candidates = [primary];
  const add = (protocol: 'http:' | 'https:', hostname: string) => {
    const next = new URL(primary);
    next.protocol = protocol;
    next.hostname = hostname;
    const value = next.toString();
    if (!candidates.includes(value)) candidates.push(value);
  };

  add(url.protocol as 'http:' | 'https:', url.hostname === 'localhost' ? '127.0.0.1' : 'localhost');
  add('http:', 'localhost');
  add('http:', '127.0.0.1');
  return candidates;
}

function apiUnreachableErrorMessage(err: unknown, endpoint?: string): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'request failed';
  const detail = raw.replace(/\s+/g, ' ').slice(0, 140);
  if (endpoint) {
    return `api_unreachable:${detail || 'request failed'} (${endpoint})`;
  }
  return detail ? `api_unreachable:${detail}` : 'api_unreachable';
}

/**
 * Translate a thrown sign-in error into a human-readable, end-user message.
 * Network errors and unknown errors become a generic "couldn't sign you in".
 */
export function describeSignInError(err: unknown): string {
  if (err instanceof Error) {
    switch (err.message) {
      case 'api_url_invalid':
        return 'Sign-in is not configured: EXPO_PUBLIC_API_URL must be a full http:// or https:// URL.';
      case 'api_unreachable':
        return 'Showbook is not reachable. Start the web app and make EXPO_PUBLIC_API_URL point to it.';
      case 'expo_go_oauth_unsupported':
        return 'Google sign-in cannot run in Expo Go. Run pnpm mobile:ios to install the Showbook development client, then open Showbook.';
      case 'invalid_google_token':
        return 'Google rejected the sign-in token. Check GOOGLE_OAUTH_MOBILE_AUDIENCES on the web app.';
      case 'access_denied':
        return 'Access denied. Contact the admin to be added to the allowlist.';
      case 'invalid_response':
        return "The server's response wasn't what we expected. Try again.";
      case 'oauth_dismissed':
        return 'Sign-in was cancelled.';
      case 'oauth_error':
        return 'Google sign-in failed. Please try again.';
      case 'rate_limited':
        return 'Too many sign-in attempts. Wait a minute and try again.';
      default:
        if (err.message.startsWith('api_unreachable:')) {
          const detail = err.message.slice('api_unreachable:'.length);
          if (/network request failed/i.test(detail)) {
            return 'Showbook is not reachable. Native fetch failed: Network request failed. If the web app is running, trust the mkcert root CA in the iOS simulator.';
          }
          return `Showbook is not reachable. Native fetch failed: ${detail}`;
        }
        if (err.message === 'server_error_500') {
          return 'Showbook sign-in is misconfigured. Check AUTH_SECRET and GOOGLE_OAUTH_MOBILE_AUDIENCES on the web app.';
        }
        if (err.message.startsWith('server_error_')) {
          return "We couldn't reach Showbook. Please try again in a moment.";
        }
    }
  }
  return "We couldn't sign you in. Please check your connection and try again.";
}

/**
 * E2E test mode — Maestro-only escape hatch for the sign-in flow.
 *
 * Active only when the build-time env var EXPO_PUBLIC_E2E_MODE === '1'.
 * That var is set exclusively by the `e2e` EAS profile (see eas.json) so
 * production / TestFlight / Play Store builds CAN'T enable it. Helpers are
 * inert if the env var is unset.
 *
 * Contract — when active, instead of running real Google OAuth, signIn
 * reads a pre-baked Showbook session from SecureStore:
 *   key `e2e.test-token` — the JWT minted by `/api/auth/mobile-token`
 *   key `e2e.test-user`  — JSON-serialized SessionUser
 *
 * Maestro is responsible for writing those keys before the sign-in tap,
 * via the e2e debug deeplink the mobile app exposes only when E2E mode is
 * on (see `apps/mobile/e2e/flows/sign-in.yaml`).
 */
export function isE2EMode(envValue: string | undefined = process.env.EXPO_PUBLIC_E2E_MODE): boolean {
  return envValue === '1';
}

export function mobileTokenEndpoint(apiUrl: string): string {
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error('api_url_invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('api_url_invalid');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/api/auth/mobile-token`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function isExpoGoAuthUnsupported(appOwnership: string | null | undefined): boolean {
  return appOwnership === 'expo';
}

export const E2E_TOKEN_KEY = 'e2e.test-token';
export const E2E_USER_KEY = 'e2e.test-user';

export interface SecureStoreLike {
  getItemAsync: (key: string) => Promise<string | null>;
}

/**
 * Read the Maestro-injected test session from SecureStore. Returns null
 * if either key is missing or the user blob doesn't parse / validate —
 * callers should treat null as "Maestro hasn't seeded the session yet"
 * and surface a sign-in error rather than silently signing in.
 */
export async function loadE2ETestSession(
  store: SecureStoreLike,
): Promise<SessionData | null> {
  const [token, userJson] = await Promise.all([
    store.getItemAsync(E2E_TOKEN_KEY),
    store.getItemAsync(E2E_USER_KEY),
  ]);
  if (!token || !userJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(userJson);
  } catch {
    return null;
  }
  if (!isSessionUser(parsed)) return null;
  return { token, user: parsed };
}

function isSessionUser(value: unknown): value is SessionUser {
  if (typeof value !== 'object' || value === null) return false;
  const u = value as Record<string, unknown>;
  if (typeof u.id !== 'string' || u.id.length === 0) return false;
  if (typeof u.email !== 'string' || u.email.length === 0) return false;
  if (u.name !== null && typeof u.name !== 'string') return false;
  if (u.image !== null && typeof u.image !== 'string') return false;
  return true;
}

function isSessionData(value: unknown): value is SessionData {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.token !== 'string' || v.token.length === 0) return false;
  if (typeof v.user !== 'object' || v.user === null) return false;
  const u = v.user as Record<string, unknown>;
  if (typeof u.id !== 'string' || u.id.length === 0) return false;
  if (typeof u.email !== 'string' || u.email.length === 0) return false;
  if (u.name !== null && typeof u.name !== 'string') return false;
  if (u.image !== null && typeof u.image !== 'string') return false;
  return true;
}
