/**
 * FilterChipsRow tests — the pre-measurement frame must be invisible
 * (no flash of un-collapsed chips spilling past the right edge), and
 * once the container + chip measurements land the row becomes visible
 * with the greedy inline/overflow split applied.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { FilterChipsRow } = require('../FilterChipsRow.tsx');

const GROUPS = [
  { id: 'g1', name: 'Cold War Kids', count: 12 },
  { id: 'g2', name: 'Khalid', count: 8 },
  { id: 'g3', name: 'Lauv', count: 5 },
  { id: 'g4', name: 'Modest Mouse', count: 4 },
  { id: 'g5', name: 'Purity Ring', count: 2 },
];

function render(props) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(FilterChipsRow, {
          groups: GROUPS,
          selected: null,
          onSelect: () => {},
          totalCount: 31,
          testIdPrefix: 'discover',
          ...props,
        }),
      ),
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

/** The visible chip row: flexDirection row + gap, but not the
 *  absolutely-positioned off-screen measure host. */
function findVisibleRow(r) {
  return r.root.find((n) => {
    if (n.type !== 'rn-view') return false;
    const s = flatten(n.props.style);
    return s.gap === 6 && s.position !== 'absolute';
  });
}

/** Drives the measuring pass: fires the container onLayout, then one
 *  onLayout per hidden measured chip (order: All, ...groups, More). */
function fireMeasurements(r, { containerWidth, chipWidths }) {
  const wrap = r.root.find(
    (n) => n.type === 'rn-view' && n.props.testID === 'discover-row',
  );
  const measured = r.root.findAll(
    (n) =>
      n.type === 'rn-view' &&
      typeof n.props.onLayout === 'function' &&
      n.props.testID === undefined,
  );
  assert.equal(measured.length, chipWidths.length);
  TestRenderer.act(() => {
    wrap.props.onLayout({
      nativeEvent: { layout: { width: containerWidth } },
    });
    measured.forEach((node, i) => {
      node.props.onLayout({
        nativeEvent: { layout: { width: chipWidths[i] } },
      });
    });
  });
}

describe('FilterChipsRow', () => {
  it('keeps the pre-measurement row invisible so chips never flash past the edge', () => {
    const r = render();
    const row = findVisibleRow(r);
    const s = flatten(row.props.style);
    assert.equal(s.opacity, 0);
    assert.equal(s.pointerEvents, 'none');
    // All groups render inline during the hidden measuring frame (they
    // hold the rail's height); no overflow chip yet.
    for (const g of GROUPS) {
      assert.ok(r.root.findAll((n) => n.props.testID === `discover-${g.id}`).length > 0);
    }
    assert.equal(
      r.root.findAll((n) => n.props.testID === 'discover-more').length,
      0,
    );
  });

  it('reveals the collapsed layout once measurements land', () => {
    const r = render();
    // Container 200 wide → 168 usable after the 16px wrap padding.
    // All=50, each group=60, More=40: only g1 fits next to All + More.
    fireMeasurements(r, {
      containerWidth: 200,
      chipWidths: [50, 60, 60, 60, 60, 60, 40],
    });

    const s = flatten(findVisibleRow(r).props.style);
    assert.notEqual(s.opacity, 0);
    assert.notEqual(s.pointerEvents, 'none');

    assert.ok(
      r.root.findAll((n) => n.props.testID === 'discover-g1').length > 0,
    );
    for (const id of ['g2', 'g3', 'g4', 'g5']) {
      assert.equal(
        r.root.findAll((n) => n.props.testID === `discover-${id}`).length,
        0,
      );
    }
    const more = r.root.find((n) => n.props.testID === 'discover-more');
    assert.equal(more.props.accessibilityLabel, 'Show 4 more filters');
  });

  it('shows every chip with no overflow when the row fits', () => {
    const r = render();
    fireMeasurements(r, {
      containerWidth: 1000,
      chipWidths: [50, 60, 60, 60, 60, 60, 40],
    });

    const s = flatten(findVisibleRow(r).props.style);
    assert.notEqual(s.opacity, 0);
    for (const g of GROUPS) {
      assert.ok(
        r.root.findAll((n) => n.props.testID === `discover-${g.id}`).length > 0,
      );
    }
    assert.equal(
      r.root.findAll((n) => n.props.testID === 'discover-more').length,
      0,
    );
  });
});
