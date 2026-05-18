/**
 * GradientEmphasis tests — regression for the "View config not found for
 * component `RNCMaskedView`" crash on show detail, fixed by probing
 * `UIManager.hasViewManagerConfig` and falling back to a solid accent
 * fill when the native view manager isn't registered (stale dev client,
 * or the headless web bundle).
 */

require('./_setup-rn-mocks.cjs');

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');
const ReactNative = require('react-native');

const { ThemeProvider } = require('../../lib/theme.ts');
const { GradientEmphasis } = require('../design-system/GradientEmphasis.tsx');

const originalHas = ReactNative.UIManager.hasViewManagerConfig;
function setMaskedViewRegistered(registered) {
  ReactNative.UIManager.hasViewManagerConfig = (name) =>
    registered && name === 'RNCMaskedView' ? {} : null;
}

after(() => {
  ReactNative.UIManager.hasViewManagerConfig = originalHas;
});

function render(children) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(GradientEmphasis, null, children),
      ),
    );
  });
  return renderer;
}

function findText(renderer, body) {
  return renderer.root
    .findAllByType('rn-text')
    .find((n) => n.props.children === body);
}

describe('GradientEmphasis', () => {
  it('renders the children when the native MaskedView manager is missing (stale dev-client regression)', () => {
    setMaskedViewRegistered(false);
    const renderer = render('Reverb');
    const text = findText(renderer, 'Reverb');
    assert.ok(text, 'fallback Text renders the children');
    // No MaskedView host element — that would crash on a binary without RNCMaskedView.
    const hosts = renderer.root.findAll((n) =>
      typeof n.type === 'string' && n.type.toLowerCase().includes('masked'),
    );
    assert.equal(hosts.length, 0, 'no MaskedView host when view config is unavailable');
  });

  it('does not throw when UIManager.hasViewManagerConfig is undefined (very old RN versions)', () => {
    ReactNative.UIManager.hasViewManagerConfig = undefined;
    assert.doesNotThrow(() => render('Solid'));
    const renderer = render('Solid');
    assert.ok(findText(renderer, 'Solid'), 'still renders children as plain Text');
  });

  it('applies the accent color to the fallback Text', () => {
    setMaskedViewRegistered(false);
    const renderer = render('Hello');
    const text = findText(renderer, 'Hello');
    const styles = Array.isArray(text.props.style)
      ? Object.assign({}, ...text.props.style.filter(Boolean))
      : text.props.style;
    assert.ok(styles.color, 'accent color applied');
  });
});
