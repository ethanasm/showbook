const React = require('react');

const insets = { top: 0, bottom: 0, left: 0, right: 0 };

module.exports = {
  SafeAreaView({ children }) {
    return React.createElement('rn-safe-area', null, children);
  },
  SafeAreaProvider({ children }) {
    return React.createElement('rn-safe-area-provider', null, children);
  },
  useSafeAreaInsets() {
    return insets;
  },
};
