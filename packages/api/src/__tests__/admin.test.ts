import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminEmail, parseAdminEmails } from '../admin';

describe('parseAdminEmails', () => {
  it('returns [] for undefined / empty / whitespace', () => {
    assert.deepEqual(parseAdminEmails(undefined), []);
    assert.deepEqual(parseAdminEmails(''), []);
    assert.deepEqual(parseAdminEmails('   '), []);
    assert.deepEqual(parseAdminEmails(',,,'), []);
  });

  it('lowercases, trims, and drops empty entries', () => {
    assert.deepEqual(
      parseAdminEmails(' Foo@Example.com ,,bar@x.io ,'),
      ['foo@example.com', 'bar@x.io'],
    );
  });
});

describe('isAdminEmail', () => {
  it('returns false when the list is empty (closed by default)', () => {
    assert.equal(isAdminEmail('ethan7ce@gmail.com', []), false);
  });

  it('returns false for null/undefined/empty email', () => {
    const list = ['ethan7ce@gmail.com'];
    assert.equal(isAdminEmail(null, list), false);
    assert.equal(isAdminEmail(undefined, list), false);
    assert.equal(isAdminEmail('', list), false);
  });

  it('matches case-insensitively', () => {
    const list = ['ethan7ce@gmail.com'];
    assert.equal(isAdminEmail('ethan7ce@gmail.com', list), true);
    assert.equal(isAdminEmail('ETHAN7CE@gmail.com', list), true);
    assert.equal(isAdminEmail('Ethan7CE@Gmail.com', list), true);
  });

  it('returns false for non-matching email', () => {
    const list = ['ethan7ce@gmail.com'];
    assert.equal(isAdminEmail('attacker@gmail.com', list), false);
    // Defensive: must not match on a suffix.
    assert.equal(isAdminEmail('xethan7ce@gmail.com', list), false);
  });

  it('reads from process.env.ADMIN_EMAILS by default', () => {
    const prev = process.env.ADMIN_EMAILS;
    try {
      process.env.ADMIN_EMAILS = 'me@example.com';
      assert.equal(isAdminEmail('me@example.com'), true);
      assert.equal(isAdminEmail('other@example.com'), false);
      process.env.ADMIN_EMAILS = '';
      assert.equal(isAdminEmail('me@example.com'), false);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prev;
    }
  });
});
