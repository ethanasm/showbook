// Placeholder map for the web target.
//
// react-native-maps doesn't ship a web implementation. The Map tab
// renders a labelled box so layout/state changes around the map (the
// search overlay, marker count, sheet) are still verifiable.

const React = require('react');
const { View, Text } = require('react-native');

function MapView(props) {
  const { style, children, testID } = props;
  return React.createElement(
    View,
    {
      style: [
        { backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
        style,
      ],
      testID: testID || 'map-view',
      accessibilityLabel: 'Map (web placeholder)',
    },
    React.createElement(
      Text,
      { style: { color: '#666', fontSize: 14 } },
      'Map (web placeholder)',
    ),
    children,
  );
}

function Marker(props) {
  const { children, testID } = props;
  return React.createElement(
    View,
    { testID: testID || 'map-marker', style: { display: 'none' } },
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
