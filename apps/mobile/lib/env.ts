/**
 * Public env vars exposed to the JS bundle.
 *
 * Expo only inlines variables prefixed with `EXPO_PUBLIC_` into the client
 * bundle. Anything else stays server-only. We resolve everything at import
 * time, but DO NOT throw if values are missing — the sign-in flow surfaces
 * a friendly error when the OAuth client IDs are not configured.
 *
 * Required for production builds:
 *   EXPO_PUBLIC_API_URL                       — base URL of the showbook web app
 *   EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS    — iOS OAuth client (from Google Cloud)
 *   EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID
 *   EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB    — web client; required by AuthSession
 *                                                even when using iOS/Android clients
 *
 * Configure these in `apps/mobile/.env.local` for `pnpm start`, or via EAS
 * secrets for managed builds.
 */

// EXPO_PUBLIC_API_URL must be set at build time (EAS secrets) or in
// `apps/mobile/.env.local` for local dev. The runtime fallback below
// is intentionally an empty string — we'd rather have the sign-in
// flow surface a clear "API URL not configured" error than have the
// app silently hit a non-existent example.com host.
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? '';

export const GOOGLE_OAUTH_CLIENT_ID_IOS: string | undefined =
  process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS;
export const GOOGLE_OAUTH_CLIENT_ID_ANDROID: string | undefined =
  process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID;
export const GOOGLE_OAUTH_CLIENT_ID_WEB: string | undefined =
  process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB;

/**
 * Returns null when Google OAuth is correctly configured for the current
 * platform, or a human-readable error message when something's missing.
 *
 * Callers (e.g. the sign-in screen) can show the message in dev to tell the
 * developer which env var is unset. In release builds the IDs should be
 * baked in via EAS so this never fires.
 */
export function describeGoogleOAuthMisconfiguration(
  platform: 'ios' | 'android' | 'web',
): string | null {
  if (!API_URL) {
    return 'EXPO_PUBLIC_API_URL is not set';
  }
  // The `webClientId` is required by `expo-auth-session/providers/google` in
  // every config (used as the audience), so we always check it.
  if (!GOOGLE_OAUTH_CLIENT_ID_WEB) {
    return 'EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB is not set';
  }
  if (platform === 'ios' && !GOOGLE_OAUTH_CLIENT_ID_IOS) {
    return 'EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS is not set';
  }
  if (platform === 'android' && !GOOGLE_OAUTH_CLIENT_ID_ANDROID) {
    return 'EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID is not set';
  }
  return null;
}
