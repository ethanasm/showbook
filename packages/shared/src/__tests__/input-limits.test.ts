import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InputMaxLength } from '../input-limits';

describe('InputMaxLength registry', () => {
  it('declares the documented per-field caps', () => {
    assert.equal(InputMaxLength.venueName, 200);
    assert.equal(InputMaxLength.venueCity, 200);
    assert.equal(InputMaxLength.venueRegion, 200);
    assert.equal(InputMaxLength.venueCountry, 120);
    assert.equal(InputMaxLength.performerName, 200);
    assert.equal(InputMaxLength.characterName, 200);
    assert.equal(InputMaxLength.tourName, 300);
    assert.equal(InputMaxLength.productionName, 300);
    assert.equal(InputMaxLength.seat, 100);
    assert.equal(InputMaxLength.notes, 5000);
    assert.equal(InputMaxLength.regionCity, 200);
    assert.equal(InputMaxLength.setlistSongTitle, 300);
    assert.equal(InputMaxLength.setlistSongNote, 200);
  });

  it('keeps every cap a positive integer', () => {
    for (const key of Object.keys(InputMaxLength) as (keyof typeof InputMaxLength)[]) {
      const value = InputMaxLength[key];
      assert.ok(
        Number.isInteger(value) && value > 0,
        `${key} should be a positive integer, got ${value}`,
      );
    }
  });
});
