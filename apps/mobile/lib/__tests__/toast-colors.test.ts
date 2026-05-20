/**
 * Unit tests for `lib/toast-colors` — the contrast-fixed feedback
 * variant resolver shared by Toast and Banner. Regression coverage
 * for the user-reported "error toast bleeds through the page" bug.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackVariantColors } from '../toast-colors';
import { DARK_COLORS, LIGHT_COLORS } from '../theme-utils';

describe('feedbackVariantColors', () => {
  for (const [name, palette] of [
    ['light', LIGHT_COLORS],
    ['dark', DARK_COLORS],
  ] as const) {
    describe(`${name} mode`, () => {
      it('error returns solid danger background with white text', () => {
        const out = feedbackVariantColors('error', palette);
        assert.equal(out.background, palette.danger);
        assert.equal(out.text, '#FFFFFF');
        // Regression guard: must NOT use an alpha suffix (would put
        // us back to "13% red over the page" — the bug).
        assert.ok(
          !/[0-9a-fA-F]{2}$/.test(out.background.slice(-2)) ||
            out.background.length === 7,
          `error background looks like it carries an alpha suffix: ${out.background}`,
        );
      });

      it('success returns accent background with accent-on-accent text', () => {
        const out = feedbackVariantColors('success', palette);
        assert.equal(out.background, palette.accent);
        assert.equal(out.text, palette.accentText);
      });

      it('info returns surfaceRaised + ink (solid neutral pair)', () => {
        const out = feedbackVariantColors('info', palette);
        assert.equal(out.background, palette.surfaceRaised);
        assert.equal(out.text, palette.ink);
      });
    });
  }

  it('error background and text are different colors (sanity)', () => {
    const out = feedbackVariantColors('error', LIGHT_COLORS);
    assert.notEqual(
      out.background.toLowerCase(),
      out.text.toLowerCase(),
      'red-on-red was the original bug; bg and text must differ',
    );
  });
});
