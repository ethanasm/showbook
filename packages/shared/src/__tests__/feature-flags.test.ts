import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureFlag, isFeatureOn } from '../feature-flags';

describe('FeatureFlag registry', () => {
  it('every entry has a description and a state of ON or OFF', () => {
    for (const [key, value] of Object.entries(FeatureFlag)) {
      assert.ok(value.description.length > 0, `${key} missing description`);
      assert.ok(
        value.state === 'ON' || value.state === 'OFF',
        `${key} state must be 'ON' | 'OFF'`,
      );
    }
  });

  it('isFeatureOn matches the registered state', () => {
    for (const key of Object.keys(FeatureFlag) as (keyof typeof FeatureFlag)[]) {
      assert.equal(isFeatureOn(key), FeatureFlag[key].state === 'ON');
    }
  });
});
