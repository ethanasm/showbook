import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSetlistfmOpenPlan } from '../setlistfm-deep-link';

describe('buildSetlistfmOpenPlan', () => {
  it('builds a name-search URL', () => {
    const plan = buildSetlistfmOpenPlan('Taylor Swift');
    assert.ok(plan);
    assert.equal(plan.url, 'https://www.setlist.fm/search?query=Taylor+Swift');
  });

  it('percent-encodes characters that need it', () => {
    const plan = buildSetlistfmOpenPlan('Sigur Rós');
    assert.ok(plan);
    assert.equal(plan.url, 'https://www.setlist.fm/search?query=Sigur+R%C3%B3s');
  });

  it('handles ampersands and other URL-significant characters', () => {
    const plan = buildSetlistfmOpenPlan('Tyler, the Creator & Friends');
    assert.ok(plan);
    assert.equal(
      plan.url,
      'https://www.setlist.fm/search?query=Tyler%2C+the+Creator+%26+Friends',
    );
  });

  it('trims leading and trailing whitespace', () => {
    const plan = buildSetlistfmOpenPlan('   Madonna   ');
    assert.ok(plan);
    assert.equal(plan.url, 'https://www.setlist.fm/search?query=Madonna');
  });

  it('returns null for empty / whitespace / null / undefined names', () => {
    assert.equal(buildSetlistfmOpenPlan(''), null);
    assert.equal(buildSetlistfmOpenPlan('   '), null);
    assert.equal(buildSetlistfmOpenPlan(null), null);
    assert.equal(buildSetlistfmOpenPlan(undefined), null);
  });
});
