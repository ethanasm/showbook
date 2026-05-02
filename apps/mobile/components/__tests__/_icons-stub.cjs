/**
 * lucide-react-native stub: every icon is a tiny named host element so
 * the test tree shows which icons render where without pulling in the
 * real package (which transitively imports react-native).
 */

const React = require('react');

function makeIcon(name) {
  return function Icon(props) {
    return React.createElement('rn-icon', { name, ...props });
  };
}

module.exports = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      return makeIcon(prop);
    },
  },
);
