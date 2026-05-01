/**
 * Unit tests for theme token utilities.
 *
 * Imports from theme-utils.ts (no RN/Expo deps) — runs clean in Node.js.
 * Provider/hook wiring will be tested in Task 6 when screens exist;
 * react-test-renderer is intentionally not introduced in M1.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getKindColor,
  DARK_COLORS,
  LIGHT_COLORS,
  SPACING,
  RADII,
  TYPE_RAMP,
} from '../theme-utils.js';

// ---------------------------------------------------------------------------
// 1. Kind color values — design spec validation (dark mode)
// ---------------------------------------------------------------------------

describe('dark mode kind colors', () => {
  it('concert dark = #3A86FF', () => {
    assert.equal(getKindColor('concert', 'dark'), '#3A86FF');
  });

  it('theatre dark = #E63946', () => {
    assert.equal(getKindColor('theatre', 'dark'), '#E63946');
  });

  it('comedy dark = #9D4EDD', () => {
    assert.equal(getKindColor('comedy', 'dark'), '#9D4EDD');
  });

  it('festival dark = #2A9D8F', () => {
    assert.equal(getKindColor('festival', 'dark'), '#2A9D8F');
  });

  it('sports dark = #E8772E', () => {
    assert.equal(getKindColor('sports', 'dark'), '#E8772E');
  });
});

// ---------------------------------------------------------------------------
// 2. Kind color values — light mode
// ---------------------------------------------------------------------------

describe('light mode kind colors', () => {
  it('concert light = #2E6FD9', () => {
    assert.equal(getKindColor('concert', 'light'), '#2E6FD9');
  });

  it('theatre light = #D42F3A', () => {
    assert.equal(getKindColor('theatre', 'light'), '#D42F3A');
  });

  it('comedy light = #8340C4', () => {
    assert.equal(getKindColor('comedy', 'light'), '#8340C4');
  });

  it('festival light = #238577', () => {
    assert.equal(getKindColor('festival', 'light'), '#238577');
  });

  it('sports light = #D06A28', () => {
    assert.equal(getKindColor('sports', 'light'), '#D06A28');
  });
});

// ---------------------------------------------------------------------------
// 3. mode switching — dark ≠ light for all kinds
// ---------------------------------------------------------------------------

describe('getKindColor mode switching', () => {
  const kinds = ['concert', 'theatre', 'comedy', 'festival', 'sports'] as const;

  for (const kind of kinds) {
    it(`${kind}: dark ≠ light, both valid hex`, () => {
      const dark = getKindColor(kind, 'dark');
      const light = getKindColor(kind, 'light');
      assert.notEqual(dark, light);
      assert.match(dark, /^#[0-9A-Fa-f]{6}$/);
      assert.match(light, /^#[0-9A-Fa-f]{6}$/);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Color token spot-checks — bg and accent per spec
// ---------------------------------------------------------------------------

describe('dark color tokens', () => {
  it('bg = #0C0C0C', () => {
    assert.equal(DARK_COLORS.bg, '#0C0C0C');
  });

  it('accent = #FFD166', () => {
    assert.equal(DARK_COLORS.accent, '#FFD166');
  });

  it('accentText = #0C0C0C (dark bg)', () => {
    assert.equal(DARK_COLORS.accentText, '#0C0C0C');
  });

  it('danger = #E63946 (destructive red, dark mode)', () => {
    assert.equal(DARK_COLORS.danger, '#E63946');
  });
});

describe('light color tokens', () => {
  it('bg = #FAFAF8', () => {
    assert.equal(LIGHT_COLORS.bg, '#FAFAF8');
  });

  it('accent = #E5A800', () => {
    assert.equal(LIGHT_COLORS.accent, '#E5A800');
  });

  it('accentText = #FFFFFF (white on amber)', () => {
    assert.equal(LIGHT_COLORS.accentText, '#FFFFFF');
  });

  it('danger = #D42F3A (destructive red, light mode)', () => {
    assert.equal(LIGHT_COLORS.danger, '#D42F3A');
  });
});

// ---------------------------------------------------------------------------
// 5. Type ramp — presence and key values
// ---------------------------------------------------------------------------

describe('type ramp', () => {
  it('heroTitle: 32pt Georgia 700', () => {
    assert.equal(TYPE_RAMP.heroTitle.fontSize, 32);
    assert.equal(TYPE_RAMP.heroTitle.fontWeight, '700');
    assert.equal(TYPE_RAMP.heroTitle.fontFamily, 'Georgia');
  });

  it('heroTitle lineHeight = round(32 × 1.1) = 35', () => {
    assert.equal(TYPE_RAMP.heroTitle.lineHeight, 35);
  });

  it('screenTitle: 24pt Geist Sans 700', () => {
    assert.equal(TYPE_RAMP.screenTitle.fontSize, 24);
    assert.equal(TYPE_RAMP.screenTitle.fontWeight, '700');
    assert.equal(TYPE_RAMP.screenTitle.fontFamily, 'Geist Sans');
  });

  it('body: 15pt 400, lineHeight 23', () => {
    assert.equal(TYPE_RAMP.body.fontSize, 15);
    assert.equal(TYPE_RAMP.body.lineHeight, 23);
  });

  it('caption: 11.5pt, uppercase, letterSpacing 0.9', () => {
    assert.equal(TYPE_RAMP.caption.fontSize, 11.5);
    assert.equal(TYPE_RAMP.caption.textTransform, 'uppercase');
    assert.equal(TYPE_RAMP.caption.letterSpacing, 0.9);
  });

  it('headliner: 22pt Georgia', () => {
    assert.equal(TYPE_RAMP.headliner.fontSize, 22);
    assert.equal(TYPE_RAMP.headliner.fontFamily, 'Georgia');
  });

  it('stat: 28pt Geist Sans, lineHeight 31', () => {
    assert.equal(TYPE_RAMP.stat.fontSize, 28);
    assert.equal(TYPE_RAMP.stat.lineHeight, 31);
  });
});

// ---------------------------------------------------------------------------
// 6. Spacing + radii
// ---------------------------------------------------------------------------

describe('spacing scale', () => {
  it('has 13 entries', () => {
    assert.equal(SPACING.length, 13);
  });

  it('starts at 0 and ends at 64', () => {
    assert.equal(SPACING[0], 0);
    assert.equal(SPACING[12], 64);
  });

  it('includes standard 8pt baseline', () => {
    assert.ok(SPACING.includes(8));
  });
});

describe('radii', () => {
  it('pill = 999', () => {
    assert.equal(RADII.pill, 999);
  });

  it('none = 0', () => {
    assert.equal(RADII.none, 0);
  });

  it('md = 8', () => {
    assert.equal(RADII.md, 8);
  });
});
