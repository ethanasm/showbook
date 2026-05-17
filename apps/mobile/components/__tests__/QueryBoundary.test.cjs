/**
 * QueryBoundary tests — loading / error / empty / success branching.
 * Renders through `react-test-renderer` with the standard RN host
 * stub used by the rest of the mobile component test suite.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { QueryBoundary } = require('../QueryBoundary.tsx');

function render(node) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(ThemeProvider, null, node),
    );
  });
  return renderer;
}

function findText(renderer, value) {
  return renderer.root
    .findAllByType('rn-text')
    .find((n) => {
      const children = Array.isArray(n.props.children)
        ? n.props.children.join('')
        : String(n.props.children ?? '');
      return children.includes(value);
    });
}

describe('QueryBoundary', () => {
  it('renders the loading slot when isLoading is true', () => {
    const r = render(
      React.createElement(
        QueryBoundary,
        {
          query: { isLoading: true, data: undefined },
          loading: React.createElement('rn-text', null, 'spinner'),
        },
        () => React.createElement('rn-text', null, 'never'),
      ),
    );
    assert.ok(findText(r, 'spinner'));
  });

  it('renders the default error UI when error is present and no slot is provided', () => {
    const r = render(
      React.createElement(
        QueryBoundary,
        {
          query: {
            isLoading: false,
            isError: true,
            error: { message: 'boom' },
            data: undefined,
          },
        },
        () => React.createElement('rn-text', null, 'never'),
      ),
    );
    assert.ok(findText(r, "Couldn't load"));
    assert.ok(findText(r, 'boom'));
  });

  it('invokes refetch when the default retry CTA is pressed', () => {
    let refetched = 0;
    const r = render(
      React.createElement(
        QueryBoundary,
        {
          query: {
            isLoading: false,
            isError: true,
            error: { message: 'oops' },
            data: undefined,
            refetch: () => {
              refetched += 1;
            },
          },
        },
        () => React.createElement('rn-text', null, 'never'),
      ),
    );
    const pressables = r.root.findAllByType('rn-pressable');
    const retryBtn = pressables.find((p) => {
      const inner = p.findAllByType('rn-text');
      return inner.some((t) => String(t.props.children ?? '').includes('Try again'));
    });
    assert.ok(retryBtn, 'retry CTA should render');
    TestRenderer.act(() => {
      retryBtn.props.onPress?.();
    });
    assert.equal(refetched, 1);
  });

  it('renders the custom error slot when provided', () => {
    const r = render(
      React.createElement(
        QueryBoundary,
        {
          query: { isLoading: false, isError: true, error: { message: 'x' }, data: undefined },
          error: (err, _retry) =>
            React.createElement('rn-text', null, `Custom: ${err.message}`),
        },
        () => React.createElement('rn-text', null, 'never'),
      ),
    );
    assert.ok(findText(r, 'Custom: x'));
  });

  it('renders empty slot when isEmpty matches', () => {
    const r = render(
      React.createElement(
        QueryBoundary,
        {
          query: { isLoading: false, data: [] },
          isEmpty: (d) => d.length === 0,
          empty: React.createElement('rn-text', null, 'nothing here'),
        },
        () => React.createElement('rn-text', null, 'never'),
      ),
    );
    assert.ok(findText(r, 'nothing here'));
  });

  it('renders children with data on success', () => {
    const r = render(
      React.createElement(
        QueryBoundary,
        {
          query: { isLoading: false, data: { name: 'Hadestown' } },
        },
        (data) => React.createElement('rn-text', null, `Hello ${data.name}`),
      ),
    );
    assert.ok(findText(r, 'Hello Hadestown'));
  });

  it('keeps showing cached data when a refetch errors (no error UI flash)', () => {
    // Matches the legacy `isError && !data` guard the migrated detail
    // screens used inline. Pull-to-refresh on a flaky network must not
    // blank the page if SQLite already hydrated `data`.
    const r = render(
      React.createElement(
        QueryBoundary,
        {
          query: {
            isLoading: false,
            isError: true,
            error: { message: 'network blip' },
            data: { name: 'Hamilton' },
          },
        },
        (data) => React.createElement('rn-text', null, `Stale ${data.name}`),
      ),
    );
    assert.ok(findText(r, 'Stale Hamilton'));
    // The default error UI must NOT have rendered.
    const errorTexts = r.root.findAllByType('rn-text').map((n) =>
      Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? ''),
    );
    assert.equal(
      errorTexts.includes("Couldn't load"),
      false,
      'error UI should not render while cached data is available',
    );
  });
});
