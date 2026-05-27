/**
 * Minimal `react-native-reanimated` shim for plain-Node component tests.
 * The real module touches `TurboModuleRegistry`, which only exists in a
 * native runtime, so importing it under `node --test` blows up at load
 * time. Tests don't need to observe animation values — they only care
 * about the rendered tree — so this stub keeps shared-value reads
 * synchronous and returns a static style object from
 * `useAnimatedStyle`.
 */

const React = require('react');

function host(type) {
  return function StubComponent(props) {
    return React.createElement(type, props, props.children);
  };
}

const AnimatedView = host('rn-view');
AnimatedView.displayName = 'Animated.View';

const Animated = {
  View: AnimatedView,
  createAnimatedComponent(Component) {
    return Component;
  },
};

function useSharedValue(initial) {
  return { value: initial };
}

function useAnimatedStyle(worklet) {
  try {
    return worklet();
  } catch {
    return {};
  }
}

function withTiming(toValue, _config, callback) {
  if (typeof callback === 'function') {
    callback(true);
  }
  return toValue;
}

function withSpring(toValue, _config, callback) {
  if (typeof callback === 'function') {
    callback(true);
  }
  return toValue;
}

function runOnJS(fn) {
  return fn;
}

const Easing = {
  linear: (t) => t,
  in: () => (t) => t,
  out: () => (t) => t,
  inOut: () => (t) => t,
  cubic: (t) => t,
  quad: (t) => t,
  bezier: () => (t) => t,
};

module.exports = {
  __esModule: true,
  default: Animated,
  Animated,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
};
