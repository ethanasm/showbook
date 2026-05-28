/**
 * Web no-op. The Expo Web bundle (driven by Playwright in
 * `apps/mobile/web-tests/`) doesn't have the native Spotify SDK and
 * never will — surface a permanently-unavailable module so the driver
 * adapter degrades to the deep-link / preview path without throwing.
 */

import type { ShowbookSpotifySDK } from './index';

const sdk: ShowbookSpotifySDK = {
  isAvailable: async () => false,
  connect: async () => {
    throw new Error('showbook-spotify-sdk: unavailable on web');
  },
  play: async () => {
    throw new Error('showbook-spotify-sdk: unavailable on web');
  },
  pause: async () => {
    // No-op so callers can fire-and-forget on teardown.
  },
  disconnect: async () => {
    // No-op so callers can fire-and-forget on teardown.
  },
};

export default sdk;
