/**
 * GradientEmphasis tests — verifies the component always renders its children
 * as a plain accent-coloured `<Text>` (never a `<MaskedView>` host), so it
 * composes safely inside the parent `<Text>` element every call site nests
 * it under without crashing iOS text layout (see the comment in
 * `design-system/GradientEmphasis.tsx` for the full history).
 */

require('./_setup-rn-mocks.cjs');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { GradientEmphasis } = require('../design-system/GradientEmphasis.tsx');

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
  it('renders the children as a plain Text', () => {
    const renderer = render('Reverb');
    const text = findText(renderer, 'Reverb');
    assert.ok(text, 'children render inside a Text element');
  });

  it('never mounts a MaskedView host (would crash inside a parent <Text> on iOS)', () => {
    const renderer = render('Party');
    const masked = renderer.root.findAll(
      (n) => typeof n.type === 'string' && n.type.toLowerCase().includes('masked'),
    );
    assert.equal(masked.length, 0, 'no MaskedView host rendered');
  });

  it('applies the accent color to the Text', () => {
    const renderer = render('Hello');
    const text = findText(renderer, 'Hello');
    const styles = Array.isArray(text.props.style)
      ? Object.assign({}, ...text.props.style.filter(Boolean))
      : text.props.style;
    assert.ok(styles.color, 'accent color applied');
  });
});
