// Learn more https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Block stale pnpm _tmp_ directories that cause ENOENT spam in the file watcher
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  /_tmp_\d+/,
];

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force Metro to resolve (sub)dependencies only from the `nodeModulesPaths`
config.resolver.disableHierarchicalLookup = true;

// 4. Web-only module shims.
//
// The web target exists for headless Playwright verification in the
// sandbox (see apps/mobile/CLAUDE.md § Headless web verification).
// Native-only modules don't ship a usable web implementation, so we
// swap them out at resolve time. These shims are NEVER pulled in for
// the iOS or Android bundles — the swap is gated on `platform === 'web'`.
const WEB_SHIMS = {
  'expo-sqlite': path.resolve(projectRoot, 'web-shims/expo-sqlite.js'),
  'expo-secure-store': path.resolve(projectRoot, 'web-shims/expo-secure-store.js'),
  'expo-auth-session/providers/google': path.resolve(
    projectRoot,
    'web-shims/expo-auth-session-google.js',
  ),
  'expo-image-picker': path.resolve(projectRoot, 'web-shims/expo-image-picker.js'),
  'expo-image-manipulator': path.resolve(projectRoot, 'web-shims/expo-image-manipulator.js'),
  'expo-media-library': path.resolve(projectRoot, 'web-shims/expo-media-library.js'),
  'expo-location': path.resolve(projectRoot, 'web-shims/expo-location.js'),
  'expo-notifications': path.resolve(projectRoot, 'web-shims/expo-notifications.js'),
  'expo-haptics': path.resolve(projectRoot, 'web-shims/expo-haptics.js'),
  'react-native-maps': path.resolve(projectRoot, 'web-shims/react-native-maps.js'),
  'showbook-spotify-sdk': path.resolve(
    projectRoot,
    'web-shims/showbook-spotify-sdk.js',
  ),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && Object.prototype.hasOwnProperty.call(WEB_SHIMS, moduleName)) {
    return { type: 'sourceFile', filePath: WEB_SHIMS[moduleName] };
  }
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
