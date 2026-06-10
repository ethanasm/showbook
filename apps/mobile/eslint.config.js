// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Parity with apps/web/eslint.config.mjs, which disables these same
    // three React-Compiler-era hooks rules. eslint-config-expo ships them
    // on by default, but they flag a large set of legitimate patterns
    // (synchronous setState in effects for derived/reset state, ref writes
    // during render). The web surface already opts out; keep both surfaces
    // consistent rather than enforcing the rules on mobile only.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
    },
  },
  {
    ignores: ["dist/*"],
  }
]);
