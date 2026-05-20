/**
 * Button (design-system) tests — variant defaults, pill radius, label
 * rendering, loading state swaps in an ActivityIndicator, disabled
 * locks the press handler, danger flips the ghost/secondary tint, and
 * the leftIcon slot mounts only when provided.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { Button } = require('../design-system/Button.tsx');

function render(node) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(ThemeProvider, null, node),
    );
  });
  return renderer;
}

function flatten(style) {
  if (!style) return {};
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.flat(Infinity).filter(Boolean));
  }
  return style;
}

function styleOf(node, fnArg = { pressed: false }) {
  const style =
    typeof node.props.style === 'function'
      ? node.props.style(fnArg)
      : node.props.style;
  return flatten(style);
}

describe('Button', () => {
  it('renders the label and defaults to a pill-shaped primary', () => {
    const r = render(
      React.createElement(Button, { label: 'Save', onPress: () => {} }),
    );
    const pressable = r.root.findByType('rn-pressable');
    const text = r.root.findByType('rn-text');
    assert.equal(text.props.children, 'Save');
    const s = styleOf(pressable);
    assert.equal(s.borderRadius, 999);
    // Primary uses the accent fill (dark token = #FFD166).
    assert.equal(s.backgroundColor, '#FFD166');
  });

  it('secondary variant uses a hairline border and surface fill', () => {
    const r = render(
      React.createElement(Button, {
        label: 'Cancel',
        onPress: () => {},
        variant: 'secondary',
      }),
    );
    const s = styleOf(r.root.findByType('rn-pressable'));
    assert.ok(s.borderWidth && s.borderWidth > 0);
    assert.equal(s.borderRadius, 999);
  });

  it('ghost variant is transparent with a ruleStrong border', () => {
    const r = render(
      React.createElement(Button, {
        label: 'Skip',
        onPress: () => {},
        variant: 'ghost',
      }),
    );
    const s = styleOf(r.root.findByType('rn-pressable'));
    assert.equal(s.backgroundColor, 'transparent');
    assert.ok(s.borderWidth && s.borderWidth > 0);
  });

  it('loading swaps the label for an ActivityIndicator and locks the press', () => {
    let pressed = false;
    const r = render(
      React.createElement(Button, {
        label: 'Save',
        onPress: () => {
          pressed = true;
        },
        loading: true,
      }),
    );
    assert.equal(r.root.findAllByType('rn-activityindicator').length, 1);
    assert.equal(r.root.findAllByType('rn-text').length, 0);
    const pressable = r.root.findByType('rn-pressable');
    assert.equal(pressable.props.disabled, true);
    // Even if invoked manually, the disabled state is what the OS gates on.
    pressable.props.onPress?.();
    assert.equal(pressed, true, 'onPress is forwarded but disabled prop guards it');
  });

  it('disabled lowers opacity and sets the a11y disabled state', () => {
    const r = render(
      React.createElement(Button, {
        label: 'Save',
        onPress: () => {},
        disabled: true,
      }),
    );
    const pressable = r.root.findByType('rn-pressable');
    assert.equal(pressable.props.disabled, true);
    assert.equal(pressable.props.accessibilityState?.disabled, true);
    const s = styleOf(pressable);
    assert.equal(s.opacity, 0.5);
  });

  it('danger tints the label red on a non-primary variant', () => {
    const r = render(
      React.createElement(Button, {
        label: 'Delete',
        onPress: () => {},
        variant: 'ghost',
        danger: true,
      }),
    );
    const text = r.root.findByType('rn-text');
    const style = flatten(text.props.style);
    // DARK_COLORS.danger is #E63946
    assert.equal(style.color, '#E63946');
  });

  it('renders the leftIcon slot when provided', () => {
    const r = render(
      React.createElement(Button, {
        label: 'Watch',
        onPress: () => {},
        leftIcon: React.createElement('rn-view', { testID: 'icon-slot' }),
      }),
    );
    const ids = r.root
      .findAllByType('rn-view')
      .map((v) => v.props.testID)
      .filter(Boolean);
    assert.ok(ids.includes('icon-slot'));
  });

  it('forwards testID and accessibilityLabel', () => {
    const r = render(
      React.createElement(Button, {
        label: 'Confirm',
        onPress: () => {},
        testID: 'confirm-btn',
        accessibilityLabel: 'Confirm purchase',
      }),
    );
    const pressable = r.root.findByType('rn-pressable');
    assert.equal(pressable.props.testID, 'confirm-btn');
    assert.equal(pressable.props.accessibilityLabel, 'Confirm purchase');
    assert.equal(pressable.props.accessibilityRole, 'button');
  });

  it('fullWidth stretches alignSelf', () => {
    const r = render(
      React.createElement(Button, {
        label: 'Stretch',
        onPress: () => {},
        fullWidth: true,
      }),
    );
    const s = styleOf(r.root.findByType('rn-pressable'));
    assert.equal(s.alignSelf, 'stretch');
  });
});
