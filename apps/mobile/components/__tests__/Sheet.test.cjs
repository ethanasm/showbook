/**
 * Sheet primitive — layout regression coverage.
 *
 * The bottom-sheet's inner View must apply `height: <snap>` (not
 * `maxHeight: <snap>`) so that `flex: 1` children — like the
 * scrollable visit list inside the Map tab's venue sheet — have a
 * defined parent height to grow into. With only `maxHeight`, Yoga
 * treats the parent as indefinite, `flex: 1` resolves to 0, and the
 * sheet collapses to ~zero visible height; the user only sees the
 * gray backdrop. See #map-popup-regression.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { Sheet } = require('../Sheet.tsx');

function render(node) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(ThemeProvider, null, node),
    );
  });
  return renderer;
}

function flattenStyle(style) {
  if (!style) return {};
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
  }
  return style;
}

describe('Sheet', () => {
  it('renders the inner sheet panel with a fixed height (not maxHeight)', () => {
    const r = render(
      React.createElement(
        Sheet,
        { open: true, onClose: () => {}, snapPoints: ['45%'] },
        React.createElement('rn-text', { testID: 'sheet-body' }, 'hello'),
      ),
    );

    // Window height in the stub is 812; 45% of 812 = ~365.
    const expectedHeight = Math.round(812 * 0.45);

    // The inner sheet panel is the rn-view that owns the snap-point
    // height — find it by inspecting the style for that height value.
    const panel = r.root.findAll((node) => {
      if (node.type !== 'rn-view') return false;
      const style = flattenStyle(node.props.style);
      return style.height === expectedHeight;
    });
    assert.equal(
      panel.length,
      1,
      `expected exactly one inner sheet view with height=${expectedHeight}, found ${panel.length}`,
    );

    // And it must NOT also be using maxHeight at the snap-point value
    // — that's the regression we're guarding against. flex:1 children
    // need a definite height to flex against.
    const style = flattenStyle(panel[0].props.style);
    assert.equal(style.maxHeight, undefined, 'sheet panel should not set maxHeight');
  });

  it('caps the height to the screen size when snapPoint resolves larger', () => {
    const r = render(
      React.createElement(
        Sheet,
        { open: true, onClose: () => {}, snapPoints: [2000] },
        React.createElement('rn-text', null, 'hello'),
      ),
    );
    // Numeric snap point 2000 > screen height 812 — clamped to 812.
    const panel = r.root.findAll((node) => {
      if (node.type !== 'rn-view') return false;
      const style = flattenStyle(node.props.style);
      return style.height === 812;
    });
    assert.equal(panel.length, 1);
  });

  it('wraps the sheet in a KeyboardAvoidingView so inputs stay visible above the keyboard', () => {
    // Regression: the rename-venue sheet (and any other sheet that hosts
    // a TextInput) had the keyboard overlay the field on iOS because the
    // Modal does not propagate the activity's keyboard inset.
    const r = render(
      React.createElement(
        Sheet,
        { open: true, onClose: () => {}, snapPoints: ['42%'] },
        React.createElement('rn-textinput', { testID: 'sheet-input' }),
      ),
    );
    const kav = r.root.findAllByType('rn-keyboardavoidingview');
    assert.equal(kav.length, 1, 'Sheet must wrap its contents in a KeyboardAvoidingView');
    assert.equal(kav[0].props.behavior, 'padding');
  });
});
