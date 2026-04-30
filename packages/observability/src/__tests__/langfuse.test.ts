import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getLangfuse, flushLangfuse, __test } from '../langfuse';

const ORIG_KEYS = {
  pub: process.env.LANGFUSE_PUBLIC_KEY,
  sec: process.env.LANGFUSE_SECRET_KEY,
};

beforeEach(() => {
  __test.reset();
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
});

afterEach(() => {
  __test.reset();
  if (ORIG_KEYS.pub) process.env.LANGFUSE_PUBLIC_KEY = ORIG_KEYS.pub;
  if (ORIG_KEYS.sec) process.env.LANGFUSE_SECRET_KEY = ORIG_KEYS.sec;
});

describe('getLangfuse', () => {
  it('returns null when public key is missing', () => {
    process.env.LANGFUSE_SECRET_KEY = 'sec';
    assert.equal(getLangfuse(), null);
  });

  it('returns null when secret key is missing', () => {
    process.env.LANGFUSE_PUBLIC_KEY = 'pub';
    assert.equal(getLangfuse(), null);
  });

  it('caches null after first miss (does not retry env)', () => {
    assert.equal(getLangfuse(), null);
    process.env.LANGFUSE_PUBLIC_KEY = 'pub';
    process.env.LANGFUSE_SECRET_KEY = 'sec';
    // First call cached _disabled=true, so we still get null without reset.
    assert.equal(getLangfuse(), null);
    __test.reset();
    // After reset we'd build a real client; we just check the gate is honoured.
    assert.notEqual(typeof getLangfuse(), 'undefined');
  });

  it('returns the test-injected client', () => {
    const fake = { tag: 'fake' };
    __test.set(fake);
    assert.equal(getLangfuse() as unknown, fake);
  });
});

describe('flushLangfuse', () => {
  it('resolves when no client is set', async () => {
    await flushLangfuse();
  });

  it('calls flushAsync on the active client', async () => {
    let flushCalls = 0;
    __test.set({
      flushAsync: async () => {
        flushCalls += 1;
      },
    });
    await flushLangfuse();
    assert.equal(flushCalls, 1);
  });

  it('swallows errors from flushAsync', async () => {
    __test.set({
      flushAsync: async () => {
        throw new Error('flush failed');
      },
    });
    // Must not throw.
    await flushLangfuse();
  });
});
