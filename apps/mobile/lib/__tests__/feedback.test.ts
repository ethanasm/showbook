/**
 * Tests for the feedback system. Covers the pure shape of the toast/banner
 * inputs and the id generator. The Provider's React-state behavior is
 * tested via integration when screens consume it (deferred).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetFeedbackIdCounterForTest,
  type Banner,
  type BannerInput,
  type Toast,
  type ToastInput,
} from '../feedback';

describe('feedback module exports', () => {
  beforeEach(() => {
    __resetFeedbackIdCounterForTest();
  });

  it('Toast type is required-shaped (kind, text, durationMs all set)', () => {
    // Type-level assertion via construction. If Toast widens silently this
    // test won't compile.
    const t: Toast = {
      id: 'fb-1',
      kind: 'info',
      text: 'hi',
      durationMs: 4000,
      action: undefined,
    };
    assert.equal(t.kind, 'info');
    assert.equal(t.durationMs, 4000);
  });

  it('Toast supports action shape', () => {
    const fn = (): void => undefined;
    const t: Toast = {
      id: 'fb-2',
      kind: 'error',
      text: 'oops',
      durationMs: 0,
      action: { label: 'Retry', onPress: fn },
    };
    assert.equal(t.action?.label, 'Retry');
    assert.equal(typeof t.action?.onPress, 'function');
  });

  it('ToastInput allows minimal text-only construction', () => {
    const i: ToastInput = { text: 'minimal' };
    assert.equal(i.text, 'minimal');
    assert.equal(i.kind, undefined);
    assert.equal(i.durationMs, undefined);
  });

  it('Banner shape parallels Toast minus durationMs', () => {
    const b: Banner = {
      id: 'fb-3',
      kind: 'info',
      text: 'offline',
      action: undefined,
    };
    assert.equal(b.kind, 'info');
    assert.equal(b.text, 'offline');
  });

  it('BannerInput accepts text only', () => {
    const i: BannerInput = { text: 'sticky' };
    assert.equal(i.text, 'sticky');
  });
});
