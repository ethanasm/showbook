/**
 * FormField tests — label uppercase, embedded TextInput vs. children
 * slot, error state, multiline. Renders through the standard RN host
 * stub used by the rest of the mobile component test suite.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { FormField, FormRow } = require('../FormField.tsx');

function render(node) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(ThemeProvider, null, node),
    );
  });
  return renderer;
}

function texts(renderer) {
  return renderer.root.findAllByType('rn-text').map((n) => {
    const children = Array.isArray(n.props.children)
      ? n.props.children.join('')
      : String(n.props.children ?? '');
    return children;
  });
}

describe('FormField', () => {
  it('uppercases the label', () => {
    const r = render(
      React.createElement(FormField, {
        label: 'Headliner',
        value: '',
        onChangeText: () => {},
      }),
    );
    assert.ok(texts(r).includes('HEADLINER'));
  });

  it('renders a TextInput by default with the passed value', () => {
    const r = render(
      React.createElement(FormField, {
        label: 'Name',
        value: 'Bowie',
        onChangeText: () => {},
        placeholder: 'enter name',
      }),
    );
    const inputs = r.root.findAllByType('rn-textinput');
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].props.value, 'Bowie');
    assert.equal(inputs[0].props.placeholder, 'enter name');
  });

  it('skips the TextInput when children are provided', () => {
    const r = render(
      React.createElement(
        FormField,
        { label: 'Custom' },
        React.createElement('rn-view', { testID: 'slot' }),
      ),
    );
    assert.equal(r.root.findAllByType('rn-textinput').length, 0);
    assert.ok(
      r.root
        .findAllByType('rn-view')
        .some((v) => v.props.testID === 'slot'),
    );
  });

  it('renders an error message when error prop is set', () => {
    const r = render(
      React.createElement(FormField, {
        label: 'Date',
        value: '',
        onChangeText: () => {},
        error: 'Required',
      }),
    );
    assert.ok(texts(r).includes('Required'));
  });

  it('applies multiline styling via the multiline prop', () => {
    const r = render(
      React.createElement(FormField, {
        label: 'Notes',
        value: '',
        onChangeText: () => {},
        multiline: true,
      }),
    );
    const input = r.root.findByType('rn-textinput');
    assert.equal(input.props.multiline, true);
    const styles = Array.isArray(input.props.style)
      ? Object.assign({}, ...input.props.style.filter(Boolean))
      : input.props.style;
    assert.ok(styles.minHeight && styles.minHeight >= 72);
  });

  it('forwards keyboardType through to the underlying TextInput', () => {
    const r = render(
      React.createElement(FormField, {
        label: 'Price',
        value: '',
        onChangeText: () => {},
        keyboardType: 'decimal-pad',
      }),
    );
    const input = r.root.findByType('rn-textinput');
    assert.equal(input.props.keyboardType, 'decimal-pad');
  });
});

describe('FormRow', () => {
  it('wraps children in a flex-row container', () => {
    const r = render(
      React.createElement(
        FormRow,
        null,
        React.createElement('rn-view', { testID: 'a' }),
        React.createElement('rn-view', { testID: 'b' }),
      ),
    );
    const ids = r.root.findAllByType('rn-view').map((v) => v.props.testID);
    assert.ok(ids.includes('a'));
    assert.ok(ids.includes('b'));
  });
});
