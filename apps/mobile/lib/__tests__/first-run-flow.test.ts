/**
 * Unit tests for the first-run step-sequencing helpers.
 *
 * These are pure (no react-native / tRPC) so they run under tsx/node. They
 * pin the skip rules — region dropped when the user has regions, gmail
 * dropped when the user has shows — and the position/next-route resolution
 * that drives the progress dots and navigation in each step screen.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIRST_RUN_ROUTES,
  computeFirstRunSteps,
  stepPosition,
  type FirstRunStepKey,
} from '../first-run-flow';

describe('computeFirstRunSteps', () => {
  it('shows the full four-step flow for a brand-new user', () => {
    const steps = computeFirstRunSteps({ hasRegions: false, hasShows: false });
    assert.deepEqual(steps, ['notifications', 'location', 'region', 'gmail']);
  });

  it('always keeps notifications and location', () => {
    const steps = computeFirstRunSteps({ hasRegions: true, hasShows: true });
    assert.deepEqual(steps, ['notifications', 'location']);
  });

  it('drops the region step when the user already has regions', () => {
    const steps = computeFirstRunSteps({ hasRegions: true, hasShows: false });
    assert.deepEqual(steps, ['notifications', 'location', 'gmail']);
    assert.ok(!steps.includes('region'));
  });

  it('drops the gmail step when the user already has shows', () => {
    const steps = computeFirstRunSteps({ hasRegions: false, hasShows: true });
    assert.deepEqual(steps, ['notifications', 'location', 'region']);
    assert.ok(!steps.includes('gmail'));
  });
});

describe('stepPosition', () => {
  const fullFlow = computeFirstRunSteps({ hasRegions: false, hasShows: false });

  it('reports 1-based step and total within the full flow', () => {
    assert.deepEqual(stepPosition(fullFlow, 'notifications'), {
      step: 1,
      total: 4,
      nextRoute: FIRST_RUN_ROUTES.location,
      inFlow: true,
    });
    assert.deepEqual(stepPosition(fullFlow, 'region'), {
      step: 3,
      total: 4,
      nextRoute: FIRST_RUN_ROUTES.gmail,
      inFlow: true,
    });
  });

  it('returns a null nextRoute for the last step (→ finish)', () => {
    const pos = stepPosition(fullFlow, 'gmail');
    assert.equal(pos.step, 4);
    assert.equal(pos.nextRoute, null);
    assert.equal(pos.inFlow, true);
  });

  it('points location straight past a dropped region step', () => {
    const flow = computeFirstRunSteps({ hasRegions: true, hasShows: false });
    const pos = stepPosition(flow, 'location');
    assert.equal(pos.step, 2);
    assert.equal(pos.total, 3);
    assert.equal(pos.nextRoute, FIRST_RUN_ROUTES.gmail);
  });

  it('makes location the finishing step when both extras are dropped', () => {
    const flow = computeFirstRunSteps({ hasRegions: true, hasShows: true });
    const pos = stepPosition(flow, 'location');
    assert.equal(pos.step, 2);
    assert.equal(pos.total, 2);
    assert.equal(pos.nextRoute, null);
  });

  it('flags a step that is not in the flow', () => {
    const flow = computeFirstRunSteps({ hasRegions: true, hasShows: true });
    const region = stepPosition(flow, 'region');
    assert.deepEqual(region, { step: 0, total: 2, nextRoute: null, inFlow: false });
    const gmail: ReturnType<typeof stepPosition> = stepPosition(flow, 'gmail');
    assert.equal(gmail.inFlow, false);
  });

  it('keeps FIRST_RUN_ROUTES aligned with every step key', () => {
    const keys: FirstRunStepKey[] = ['notifications', 'location', 'region', 'gmail'];
    for (const key of keys) {
      assert.equal(typeof FIRST_RUN_ROUTES[key], 'string');
      assert.ok(FIRST_RUN_ROUTES[key].startsWith('/(auth)/first-run/'));
    }
  });
});
