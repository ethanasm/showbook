// No-op image manipulator for the web target.
//
// The mobile HEIC normalization pipeline imports this for native iOS/Android
// builds; on the web Playwright harness no real image manipulation happens
// (the picker is also a no-op there), so this just preserves the import
// surface so the web bundle can boot.

const SaveFormat = { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' };
const FlipType = { Vertical: 'vertical', Horizontal: 'horizontal' };

async function manipulateAsync(uri, _actions, _saveOptions) {
  return { uri, width: 0, height: 0 };
}

module.exports = {
  SaveFormat,
  FlipType,
  manipulateAsync,
};
