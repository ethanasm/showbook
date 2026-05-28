/**
 * Config plugin for the `showbook-spotify-sdk` local Expo Module.
 *
 *  - **iOS**: appends `pod 'SpotifyiOS', :git => …, :tag => v5.0.1` to
 *    the host Podfile so EAS Build / `expo prebuild` doesn't need a
 *    manual download step. Injects `SpotifyClientID` into Info.plist
 *    from `EXPO_PUBLIC_SPOTIFY_CLIENT_ID` so the native side can
 *    instantiate `SPTConfiguration` without round-tripping through JS.
 *    `LSApplicationQueriesSchemes` already declares `spotify` in
 *    `apps/mobile/app.config.ts:103`.
 *
 *  - **Android**: adds a `<package>` element to `<queries>` so
 *    `PackageManager.getPackageInfo("com.spotify.music", 0)` works on
 *    API 30+ (otherwise the call always raises `NameNotFound`). Writes
 *    the client id into `strings.xml` as `showbook_spotify_client_id`
 *    (the resource the Kotlin side reads).
 *
 * Written in plain JS to keep prebuild simple (no ts-node, no build
 * step). Local plugins under `apps/mobile/modules/` are picked up by
 * Expo's plugin resolver via the `app.config.ts` plugins array.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  withDangerousMod,
  withInfoPlist,
  withStringsXml,
  withAndroidManifest,
  AndroidConfig,
} = require('expo/config-plugins');

const IOS_SDK_GIT = 'https://github.com/spotify/ios-sdk.git';
const IOS_SDK_TAG = 'v5.0.1';

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

  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        'Podfile',
      );
      let podfile = await fs.promises.readFile(podfilePath, 'utf8');
      const marker = "pod 'SpotifyiOS'";
      if (!podfile.includes(marker)) {
        const targetEnd = podfile.lastIndexOf('end');
        if (targetEnd === -1) {
          throw new Error(
            '[showbook-spotify-sdk] could not find Podfile target end',
          );
        }
        const pin = `  pod 'SpotifyiOS', :git => '${IOS_SDK_GIT}', :tag => '${IOS_SDK_TAG}'\n`;
        podfile = podfile.slice(0, targetEnd) + pin + podfile.slice(targetEnd);
        await fs.promises.writeFile(podfilePath, podfile, 'utf8');
      }
      return cfg;
    },
  ]);

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
