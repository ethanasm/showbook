import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureFlag, isFeatureOn } from '../feature-flags';

describe('FeatureFlag registry', () => {
  it('every entry has a description and a state of ON or OFF', () => {
    for (const [key, value] of Object.entries(FeatureFlag)) {
      // state is a literal ('OFF') in the registry today, so widen to string
      // for these runtime-shape assertions (TS would otherwise flag the
      // === 'ON' comparison as having no overlap).
      const state: string = value.state;
      assert.ok(value.description.length > 0, `${key} missing description`);
      assert.ok(
        state === 'ON' || state === 'OFF',
        `${key} state must be 'ON' | 'OFF'`,
      );
    }
  });

  it('isFeatureOn matches the registered state', () => {
    for (const key of Object.keys(FeatureFlag) as (keyof typeof FeatureFlag)[]) {
      const state: string = FeatureFlag[key].state;
      assert.equal(isFeatureOn(key), state === 'ON');
    }
  });
});
