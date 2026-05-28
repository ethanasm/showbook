/**
 * Web shim for the local `showbook-spotify-sdk` Expo Module. Metro
 * picks this up for the Expo Web bundle so Playwright doesn't try to
 * load the native module loader. Mirrors `src/index.web.ts` exactly —
 * we keep both because Metro's resolver only honors the shim alias
 * declared in `metro.config.js`, while package consumers that import
 * the module by name through Node resolution want `index.web.ts`.
 */

module.exports = {
  default: {
    isAvailable: async () => false,
    connect: async () => {
      throw new Error('showbook-spotify-sdk: unavailable on web');
    },
    play: async () => {
      throw new Error('showbook-spotify-sdk: unavailable on web');
    },
    pause: async () => {},
    disconnect: async () => {},
  },
};
