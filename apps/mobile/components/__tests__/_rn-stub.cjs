/**
 * Minimal `react-native` shim used by component tests. Each "host"
 * primitive renders a tiny React.createElement so react-test-renderer
 * can build a tree we can introspect by `findAll`.
 *
 * Don't add behaviour here — keep stubs dumb and predictable so tests
 * stay focused on the component under test.
 */

const React = require('react');

function host(type) {
  return function StubComponent(props) {
    return React.createElement(type, props, props.children);
  };
}

const View = host('rn-view');
const Text = host('rn-text');
const ScrollView = host('rn-scrollview');
const TextInput = host('rn-textinput');
const Pressable = host('rn-pressable');
const ActivityIndicator = host('rn-activityindicator');
const KeyboardAvoidingView = host('rn-keyboardavoidingview');
const FlatList = host('rn-flatlist');
const SectionList = host('rn-sectionlist');
const Image = host('rn-image');
const Modal = host('rn-modal');
const Switch = host('rn-switch');

const StyleSheet = {
  create(styles) {
    return styles;
  },
  hairlineWidth: 1,
  flatten(s) {
    if (!s) return undefined;
    if (Array.isArray(s)) return Object.assign({}, ...s.filter(Boolean));
    return s;
  },
};

const Platform = {
  OS: 'ios',
  select(spec) {
    return spec.ios ?? spec.default;
  },
};

const Appearance = {
  getColorScheme: () => 'dark',
  addChangeListener: () => ({ remove() {} }),
};

const Dimensions = {
  get: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
  addEventListener: () => ({ remove() {} }),
};

module.exports = {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  FlatList,
  SectionList,
  Image,
  Modal,
  Switch,
  StyleSheet,
  Platform,
  Appearance,
  Dimensions,
};
