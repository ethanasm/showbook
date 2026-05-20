/**
 * Unit tests for the deterministic confirmation fallback used by the
 * mobile chat surface when Groq isn't available.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildShowSavedFallback } from '../routers/enrichment';

describe('buildShowSavedFallback', () => {
  it('formats a concert confirmation with the date', () => {
    const msg = buildShowSavedFallback({
      kind: 'concert',
      title: 'Bon Iver',
      venueName: 'Hollywood Bowl',
      date: '2018-08-05',
    });
    assert.match(msg, /Bon Iver/);
    assert.match(msg, /Hollywood Bowl/);
    assert.match(msg, /Aug 5, 2018/);
    assert.match(msg, /shows/);
    assert.match(msg, /Anything else\?/);
  });

  it('uses the festival noun for festival kind', () => {
    const msg = buildShowSavedFallback({
      kind: 'festival',
      title: 'Coachella',
      venueName: 'Empire Polo Club',
      date: '2026-04-12',
    });
    assert.match(msg, /Coachella/);
    assert.match(msg, /festivals/);
    assert.match(msg, /Apr 12, 2026/);
  });

  it('uses the production noun for theatre kind', () => {
    const msg = buildShowSavedFallback({
      kind: 'theatre',
      title: 'Hadestown',
      venueName: 'Walter Kerr Theatre',
      date: '2024-03-15',
    });
    assert.match(msg, /Hadestown/);
    assert.match(msg, /productions/);
  });

  it('omits the date fragment when no date is provided', () => {
    const msg = buildShowSavedFallback({
      kind: 'concert',
      title: 'Watching for Phoebe Bridgers',
      venueName: 'TBD',
      date: null,
    });
    assert.equal(
      msg,
      'Added Watching for Phoebe Bridgers at TBD to your shows. Anything else?',
    );
  });

  it('uses local-midnight parsing to avoid timezone day-shift', () => {
    // bare `new Date('2024-01-01')` is UTC midnight; in zones west of
    // UTC that renders as "Dec 31, 2023". The helper must use local
    // midnight so the displayed day matches the calendar date the
    // user picked.
    const msg = buildShowSavedFallback({
      kind: 'concert',
      title: 'Test Show',
      venueName: 'Test Venue',
      date: '2024-01-01',
    });
    assert.match(msg, /Jan 1, 2024/);
  });
});
