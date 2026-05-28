/**
 * SpotifySdkMount — mounts the native `showbook-spotify-sdk` driver
 * onto the root `PreviewPlayerController` once the user is connected
 * to Spotify on Premium. Mirrors `apps/web/components/show-tabs/
 * ShowDetailTabsView.tsx:511 FullTrackDriverMount`.
 *
 *  - Gates on `spotify.connectionStatus.connected === true` AND
 *    `product === 'premium'`. Free users skip the SDK entirely; their
 *    taps fall through to the deep-link path landed in PR #440.
 *  - Fetches a fresh access token via `spotify.playbackToken` (same
 *    procedure the web Web Playback SDK uses; rejects non-Premium
 *    server-side so the client gate is defense-in-depth).
 *  - Connects, then registers the driver on the controller. On
 *    failure (no app installed, IPC denied, token revoked) the driver
 *    is left unmounted and `TrackPreviewButton` falls back to the
 *    deep-link / preview-URL chain transparently.
 *  - On unmount (sign-out, Spotify disconnect, Premium downgrade)
 *    tears the driver down so subsequent renders re-attempt cleanly.
 *
 * Renders nothing. Place inside `PreviewPlayerProvider` so
 * `usePreviewPlayer()` resolves.
 */

import React from 'react';

import { trpc } from '@/lib/trpc';
import { usePreviewPlayer } from '@/lib/preview-player-provider';
import { createSpotifySdkDriver } from '@/lib/spotify-sdk-driver';

export function SpotifySdkMount(): null {
  const player = usePreviewPlayer();
  const status = trpc.spotify.connectionStatus.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const utils = trpc.useUtils();

  React.useEffect(() => {
    if (!player) return;
    if (!status.data?.connected) return;
    if (status.data.product !== 'premium') return;

    let cancelled = false;
    const driver = createSpotifySdkDriver();

    void (async () => {
      const token = await utils.spotify.playbackToken.fetch(undefined);
      if (cancelled) return;
      if (!token) return; // server returned null — non-Premium or disconnected
      const installed = await driver.isAvailable();
      if (cancelled) return;
      if (!installed) return; // no Spotify app — leave the driver unmounted
      const ok = await driver.connect(token.accessToken);
      if (cancelled || !ok) return;
      player.controller.setFullTrackDriver(driver);
    })();

    return () => {
      cancelled = true;
      // Unwire the driver before we tear down its IPC link so a stray
      // tap mid-teardown can't trigger a play() against a half-stopped
      // SDK. Then disconnect; failures here are non-fatal.
      player.controller.setFullTrackDriver(null);
      void driver.disconnect().catch(() => undefined);
    };
  }, [player, status.data, utils.spotify.playbackToken]);

  return null;
}
