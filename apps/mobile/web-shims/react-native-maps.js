// Placeholder map for the web target.
//
// react-native-maps doesn't ship a web implementation. The Map tab
// renders a labelled box so layout/state changes around the map (the
// search overlay, marker count, sheet) are still verifiable.

const React = require('react');
const { View, Text, Pressable } = require('react-native');

function MapView(props) {
  const { style, children, testID } = props;
  return React.createElement(
    View,
    {
      style: [
        { backgroundColor: '#1a1a1a', alignItems: 'flex-start', justifyContent: 'flex-start', overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap', padding: 8, gap: 8 },
        style,
      ],
      testID: testID || 'map-view',
      accessibilityLabel: 'Map (web placeholder)',
    },
    children,
  );
}

function Marker(props) {
  const { children, testID, onPress, accessibilityLabel } = props;
  // On web there's no native map canvas, so render markers as a flat
  // wrap of tappable pressables. Lets headless Playwright drive the
  // marker → sheet flow even though there's no real map underneath.
  return React.createElement(
    Pressable,
    {
      testID: testID || 'map-marker',
      onPress,
      accessibilityLabel: accessibilityLabel || 'map marker',
      style: { padding: 2 },
    },
    children,
  );
}

function Callout(props) {
  return React.createElement(View, { style: { display: 'none' } }, props.children);
}

const PROVIDER_GOOGLE = 'google';
const PROVIDER_DEFAULT = null;

module.exports = MapView;
module.exports.default = MapView;
module.exports.MapView = MapView;
module.exports.Marker = Marker;
module.exports.Callout = Callout;
module.exports.PROVIDER_GOOGLE = PROVIDER_GOOGLE;
module.exports.PROVIDER_DEFAULT = PROVIDER_DEFAULT;
