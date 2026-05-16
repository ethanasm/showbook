import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureFlag, isFeatureOn, isFeatureOnFor } from '../feature-flags';

describe('FeatureFlag registry', () => {
  it('every entry has a description and a state of ON, OFF, or DEV_ONLY', () => {
    for (const [key, value] of Object.entries(FeatureFlag)) {
      assert.ok(value.description.length > 0, `${key} missing description`);
      assert.ok(
        value.state === 'ON' || value.state === 'OFF' || value.state === 'DEV_ONLY',
        `${key} state must be 'ON' | 'OFF' | 'DEV_ONLY'`,
      );
    }
  });

  it('isFeatureOn returns true only for ON (DEV_ONLY is gated, OFF is closed)', () => {
    for (const key of Object.keys(FeatureFlag) as (keyof typeof FeatureFlag)[]) {
      assert.equal(isFeatureOn(key), FeatureFlag[key].state === 'ON');
    }
  });

  it('isFeatureOnFor resolves DEV_ONLY via the isDev predicate', () => {
    for (const key of Object.keys(FeatureFlag) as (keyof typeof FeatureFlag)[]) {
      const state = FeatureFlag[key].state;
      if (state === 'ON') {
        assert.equal(isFeatureOnFor(key, false), true, `${key} ON must be true for everyone`);
        assert.equal(isFeatureOnFor(key, true), true);
      } else if (state === 'OFF') {
        assert.equal(isFeatureOnFor(key, false), false, `${key} OFF must be false for everyone`);
        assert.equal(isFeatureOnFor(key, true), false);
      } else {
        // DEV_ONLY — true only when the caller is a developer.
        assert.equal(isFeatureOnFor(key, false), false, `${key} DEV_ONLY must be false for non-dev`);
        assert.equal(isFeatureOnFor(key, true), true, `${key} DEV_ONLY must be true for dev`);
      }
    }
  });
});
