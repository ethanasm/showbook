/**
 * SetlistRow tests — track number, drag handle, long-press semantics,
 * encore styling. Uses the same `_setup-rn-mocks.cjs` shim as
 * VenueTypeahead so we can render through `react-test-renderer`
 * without pulling in the real React Native runtime.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { SetlistRow } = require('../SetlistRow.tsx');

function renderRow(props) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SetlistRow, props),
      ),
    );
  });
  return renderer;
}

function findText(renderer, predicate) {
  return renderer.root
    .findAllByType('rn-text')
    .find(predicate);
}

function findHandle(renderer) {
  return renderer.root
    .findAllByType('rn-view')
    .find((v) => v.props.testID === 'setlist-row-handle');
}

describe('SetlistRow', () => {
  it('renders the track number and title', () => {
    const renderer = renderRow({ trackNumber: 4, title: 'Motion Sickness' });
    const number = findText(renderer, (n) => n.props.children === 4);
    const title = findText(renderer, (n) => n.props.children === 'Motion Sickness');
    assert.ok(number, 'track number visible');
    assert.ok(title, 'title visible');
  });

  it('renders a drag handle by default', () => {
    const renderer = renderRow({ trackNumber: 1, title: 'X' });
    const handle = findHandle(renderer);
    assert.ok(handle, 'drag handle present');
  });

  it('toggles encore styling via the isEncore prop', () => {
    const normalRenderer = renderRow({ trackNumber: 1, title: 'A', isEncore: false });
    const encoreRenderer = renderRow({ trackNumber: 1, title: 'A', isEncore: true });

    const normalNumber = findText(normalRenderer, (n) => n.props.children === 1);
    const encoreNumber = findText(encoreRenderer, (n) => n.props.children === 1);

    // Style is an array; flatten and look for the heavier weight only when encore.
    const normalStyle = Array.isArray(normalNumber.props.style)
      ? Object.assign({}, ...normalNumber.props.style.filter(Boolean))
      : normalNumber.props.style;
    const encoreStyle = Array.isArray(encoreNumber.props.style)
      ? Object.assign({}, ...encoreNumber.props.style.filter(Boolean))
      : encoreNumber.props.style;

    assert.notEqual(normalStyle.fontWeight, '700');
    assert.equal(encoreStyle.fontWeight, '700');
  });

  it('fires onLongPress on long press, NOT on regular tap', () => {
    const onLongPress = mock.fn();
    const renderer = renderRow({
      trackNumber: 1,
      title: 'Pressable test',
      onLongPress,
    });
    const pressable = renderer.root.findAllByType('rn-pressable')[0];
    // Regular tap — must not fire onLongPress.
    TestRenderer.act(() => {
      pressable.props.onPress?.();
    });
    assert.equal(onLongPress.mock.callCount(), 0);

    // Long-press fires.
    TestRenderer.act(() => {
      pressable.props.onLongPress?.();
    });
    assert.equal(onLongPress.mock.callCount(), 1);
  });

  it('fires onRemove when the X button is pressed', () => {
    const onRemove = mock.fn();
    const renderer = renderRow({
      trackNumber: 1,
      title: 'Remove me',
      onRemove,
    });
    const removeBtn = renderer.root
      .findAllByType('rn-pressable')
      .find((p) => p.props.accessibilityLabel === 'Remove track');
    assert.ok(removeBtn, 'remove button present when onRemove is supplied');
    TestRenderer.act(() => {
      removeBtn.props.onPress?.();
    });
    assert.equal(onRemove.mock.callCount(), 1);
  });

  it('renders an editable input when editable=true', () => {
    const onChangeTitle = mock.fn();
    const renderer = renderRow({
      trackNumber: 2,
      title: 'editable',
      editable: true,
      onChangeTitle,
    });
    const input = renderer.root.findAllByType('rn-textinput')[0];
    assert.ok(input);
    TestRenderer.act(() => {
      input.props.onChangeText?.('new title');
    });
    assert.equal(onChangeTitle.mock.callCount(), 1);
    assert.equal(onChangeTitle.mock.calls[0].arguments[0], 'new title');
  });
});
