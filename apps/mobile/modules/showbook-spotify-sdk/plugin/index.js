/**
 * Config plugin for the `showbook-spotify-sdk` local Expo Module.
 *
 *  - **iOS**: injects `SpotifyClientID` into Info.plist from
 *    `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` so the native side (when
 *    authored) can instantiate `SPTConfiguration` without
 *    round-tripping through JS. `LSApplicationQueriesSchemes`
 *    already declares `spotify` in `apps/mobile/app.config.ts:103`.
 *
 *  - **Android**: adds a `<package>` element to `<queries>` so
 *    `PackageManager.getPackageInfo("com.spotify.music", 0)` works on
 *    API 30+ (otherwise the call always raises `NameNotFound`). Writes
 *    the client id into `strings.xml` as `showbook_spotify_client_id`
 *    (the resource the Kotlin side reads).
 *
 *  - **iOS Podfile pod 'SpotifyiOS' injection is intentionally
 *    skipped.** Spotify ships the iOS SDK as a downloadable
 *    framework, not as a podspec'd CocoaPod, so `pod 'SpotifyiOS',
 *    :git => 'https://github.com/spotify/ios-sdk.git', :tag =>
 *    'v5.0.1'` fails CocoaPods resolution with "Unable to find a
 *    specification for 'SpotifyiOS'". Every iOS EAS build from PR
 *    #442 through 2026-05-29 silently failed at this exact step;
 *    `eas build --no-wait` doesn't surface async build failures in
 *    the GitHub workflow, so it went unnoticed. The Kotlin / Swift
 *    sources this pod would link against don't exist anywhere in
 *    the repo either (we set `platforms: []` on the Expo Module
 *    config in #456 for the same reason), so the pod injection is
 *    config-prepared-but-unwired anyway. Reinstate when the iOS
 *    Swift native module + a proper integration with the
 *    framework-distribution model lands.
 *
 * Written in plain JS to keep prebuild simple (no ts-node, no build
 * step). Local plugins under `apps/mobile/modules/` are picked up by
 * Expo's plugin resolver via the `app.config.ts` plugins array.
 */

const {
  withInfoPlist,
  withStringsXml,
  withAndroidManifest,
  AndroidConfig,
} = require('expo/config-plugins');

function withShowbookSpotifySdk(config, props) {
  const clientId =
    (props && props.clientId) ||
    process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID ||
    '';

  if (!clientId) {
    // Loud at prebuild time so misconfigured builds surface immediately
    // rather than failing inside `connect()` at runtime.
    console.warn(
      '[showbook-spotify-sdk] EXPO_PUBLIC_SPOTIFY_CLIENT_ID is unset — App Remote connect() will reject with ERR_NO_CLIENT_ID until it is provided.',
    );
  }

  // --- iOS ---
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.SpotifyClientID = clientId;
    return cfg;
  });

  // --- Android ---
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries || [];
    const alreadyDeclared = manifest.queries.some(
      (q) =>
        q.package &&
        q.package.some((p) => p.$ && p.$['android:name'] === 'com.spotify.music'),
    );
    if (!alreadyDeclared) {
      manifest.queries.push({
        package: [{ $: { 'android:name': 'com.spotify.music' } }],
      });
    }
    return cfg;
  });

  config = withStringsXml(config, (cfg) => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      [
        {
          $: { name: 'showbook_spotify_client_id', translatable: 'false' },
          _: clientId,
        },
      ],
      cfg.modResults,
    );
    return cfg;
  });

  return config;
}

module.exports = withShowbookSpotifySdk;
