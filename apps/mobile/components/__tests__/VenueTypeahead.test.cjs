/**
 * VenueTypeahead component tests.
 *
 * Uses react-test-renderer with the local react-native shim from
 * `_setup-rn-mocks.cjs`. Each test renders the component, asserts on
 * the produced tree (props, children), and triggers Pressable
 * `onPress` / TextInput `onChangeText` directly off the tree.
 *
 * The debounce assertion uses MockTracker.timers to fast-forward
 * setTimeout deterministically.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { VenueTypeahead } = require('../VenueTypeahead.tsx');

const SAMPLES = [
  { id: 'v1', name: 'Greek Theatre', city: 'Berkeley', stateRegion: 'California' },
  { id: 'v2', name: 'Walter Kerr Theatre', city: 'New York', stateRegion: 'New York' },
];

function renderTypeahead(overrides = {}) {
  const props = {
    value: '',
    onChange: () => {},
    onSelect: () => {},
    onSearch: () => {},
    suggestions: [],
    ...overrides,
  };
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(VenueTypeahead, props),
      ),
    );
  });
  return renderer;
}

function findInput(renderer) {
  return renderer.root.findAllByType('rn-textinput')[0];
}

function findSuggestionRows(renderer) {
  // Suggestion rows are Pressable host elements that have an
  // accessibilityLabel starting with "Select ".
  return renderer.root
    .findAllByType('rn-pressable')
    .filter((p) => typeof p.props.accessibilityLabel === 'string' && p.props.accessibilityLabel.startsWith('Select '));
}

describe('VenueTypeahead', () => {
  it('renders nothing in the suggestion list when value is empty', () => {
    const renderer = renderTypeahead({ value: '', suggestions: SAMPLES });
    assert.equal(findSuggestionRows(renderer).length, 0);
  });

  it('renders suggestions when value is non-empty', () => {
    const renderer = renderTypeahead({ value: 'gre', suggestions: SAMPLES });
    const rows = findSuggestionRows(renderer);
    assert.equal(rows.length, 2);
  });

  it('calls onSelect with the chosen venue when a row is pressed', () => {
    const onSelect = mock.fn();
    const renderer = renderTypeahead({
      value: 'gre',
      suggestions: SAMPLES,
      onSelect,
    });
    const rows = findSuggestionRows(renderer);
    TestRenderer.act(() => {
      rows[0].props.onPress();
    });
    assert.equal(onSelect.mock.callCount(), 1);
    assert.deepEqual(onSelect.mock.calls[0].arguments[0], SAMPLES[0]);
  });

  it('debounces: rapid typing fires onSearch exactly once', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const onSearch = mock.fn();
      let value = '';
      const onChange = (next) => {
        value = next;
      };
      let renderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(VenueTypeahead, {
              value,
              onChange,
              onSelect: () => {},
              onSearch,
              suggestions: [],
              debounceMs: 50,
            }),
          ),
        );
      });

      // Type "g", "gr", "gre", "gree" within 30ms each — well under the
      // 50ms debounce window. Only the final settled value should fire
      // onSearch.
      const sequence = ['g', 'gr', 'gre', 'gree'];
      for (const next of sequence) {
        value = next;
        TestRenderer.act(() => {
          renderer.update(
            React.createElement(
              ThemeProvider,
              null,
              React.createElement(VenueTypeahead, {
                value,
                onChange,
                onSelect: () => {},
                onSearch,
                suggestions: [],
                debounceMs: 50,
              }),
            ),
          );
        });
        TestRenderer.act(() => {
          mock.timers.tick(30);
        });
      }
      // Settle past the debounce window.
      TestRenderer.act(() => {
        mock.timers.tick(60);
      });

      assert.equal(onSearch.mock.callCount(), 1);
      assert.equal(onSearch.mock.calls[0].arguments[0], 'gree');
    } finally {
      mock.timers.reset();
    }
  });

  it('passes the trimmed query to onSearch (whitespace-only input is ignored)', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const onSearch = mock.fn();
      let renderer;
      TestRenderer.act(() => {
        renderer = TestRenderer.create(
          React.createElement(
            ThemeProvider,
            null,
            React.createElement(VenueTypeahead, {
              value: '   ',
              onChange: () => {},
              onSelect: () => {},
              onSearch,
              suggestions: [],
              debounceMs: 10,
            }),
          ),
        );
      });
      TestRenderer.act(() => {
        mock.timers.tick(50);
      });
      assert.equal(onSearch.mock.callCount(), 0);
      void renderer;
    } finally {
      mock.timers.reset();
    }
  });

  it('forwards typed text via onChange', () => {
    const onChange = mock.fn();
    const renderer = renderTypeahead({ onChange });
    const input = findInput(renderer);
    TestRenderer.act(() => {
      input.props.onChangeText('phoebe');
    });
    assert.equal(onChange.mock.callCount(), 1);
    assert.equal(onChange.mock.calls[0].arguments[0], 'phoebe');
  });
});
