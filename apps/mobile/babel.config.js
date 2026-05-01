module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // babel-preset-expo (SDK 50+) auto-includes react-native-reanimated/plugin
    // when the dep is present. Don't list it here — running it twice is noisy.
  };
};
