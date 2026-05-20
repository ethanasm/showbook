import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isInternalErrorMessage, toUserMessage } from '../errors';

describe('isInternalErrorMessage', () => {
  it('detects a Drizzle "Failed query" wrapper', () => {
    assert.equal(
      isInternalErrorMessage('Failed query: insert into "show_performers" ...'),
      true,
    );
  });

  it('detects a postgres duplicate-key error', () => {
    assert.equal(
      isInternalErrorMessage(
        'duplicate key value violates unique constraint "show_performers_pkey"',
      ),
      true,
    );
  });

  it('detects a postgres foreign-key violation', () => {
    assert.equal(
      isInternalErrorMessage(
        'insert or update on table "show_performers" violates foreign key constraint',
      ),
      true,
    );
  });

  it('returns false for normal user-facing messages', () => {
    assert.equal(isInternalErrorMessage('Title can’t be empty'), false);
    assert.equal(isInternalErrorMessage('Could not save changes'), false);
    assert.equal(isInternalErrorMessage('Network request failed'), false);
  });

  it('ignores leading whitespace', () => {
    assert.equal(
      isInternalErrorMessage('  Failed query: insert into "x"'),
      true,
    );
  });

  it('detects a Zod schema-validation blob from a Groq-backed procedure', () => {
    // Regression for the chat-mode "Add" screen: an ambiguous prompt
    // ("I also saw him October 23, 2016") caused Groq to return
    // `headliner: null`, the server's z.string() rejected it, and
    // the raw Zod error JSON ended up as the toast body.
    assert.equal(
      isInternalErrorMessage(
        'Groq response failed schema validation: [\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": ["headliner"],\n    "message": "Invalid input"\n  }\n]',
      ),
      true,
    );
    assert.equal(
      isInternalErrorMessage('Failed schema validation: ...'),
      true,
    );
    assert.equal(
      isInternalErrorMessage('No response from Groq'),
      true,
    );
    assert.equal(
      isInternalErrorMessage('Failed to parse Groq response as JSON: {malformed}'),
      true,
    );
  });
});

describe('toUserMessage', () => {
  it('falls back when the error is an internal SQL leak', () => {
    const err = new Error(
      'Failed query: insert into "show_performers" ("show_id", "performer_id", "role", "character_name", "sort_order") values ($1, $2, $3, $4, $5)',
    );
    assert.equal(toUserMessage(err, 'Could not save'), 'Could not save');
  });

  it('passes a normal user message through', () => {
    const err = new Error('Title can’t be empty');
    assert.equal(toUserMessage(err, 'fallback'), 'Title can’t be empty');
  });

  it('falls back when the error is not an Error instance', () => {
    assert.equal(toUserMessage(null, 'Could not save'), 'Could not save');
    assert.equal(toUserMessage('a string', 'Could not save'), 'Could not save');
    assert.equal(toUserMessage(undefined, 'Could not save'), 'Could not save');
  });

  it('truncates very long user-facing messages to keep the toast bounded', () => {
    const longMessage = 'A reasonable looking error '.repeat(50);
    const out = toUserMessage(new Error(longMessage), 'Could not save');
    assert.ok(out.length <= 160, `expected <=160 chars, got ${out.length}`);
    assert.ok(out.endsWith('…'));
  });

  it('falls back when err is an Error with empty message', () => {
    assert.equal(toUserMessage(new Error(''), 'Could not save'), 'Could not save');
  });

  it('hides a Groq schema-validation dump behind the caller-supplied fallback', () => {
    const err = new Error(
      'Groq response failed schema validation: [\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": ["headliner"],\n    "message": "Invalid input"\n  }\n]',
    );
    assert.equal(
      toUserMessage(
        err,
        'Couldn’t make sense of that — open the form to enter it manually.',
      ),
      'Couldn’t make sense of that — open the form to enter it manually.',
    );
  });
});
