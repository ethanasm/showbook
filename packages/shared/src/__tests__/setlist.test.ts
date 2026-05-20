import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSetlistNote } from '../types/setlist';

describe('formatSetlistNote', () => {
  it('wraps a plain note in parens', () => {
    assert.equal(formatSetlistNote('Tour Debut'), '(Tour Debut)');
  });

  // setlist.fm's API returns multi-annotation `info` as the inner content
  // between the outer parens. e.g. "I'm Into You" displays as
  // `(without band) (>)`, with the API returning `info: "without band) (>"`.
  it('wraps a multi-annotation setlist.fm note so the parens balance', () => {
    assert.equal(formatSetlistNote('without band) (>'), '(without band) (>)');
  });

  it('wraps a bare segue marker', () => {
    assert.equal(formatSetlistNote('>'), '(>)');
  });

  it('returns empty string for empty/null/undefined input', () => {
    assert.equal(formatSetlistNote(''), '');
    assert.equal(formatSetlistNote(null), '');
    assert.equal(formatSetlistNote(undefined), '');
  });

  it('returns empty string for whitespace-only input', () => {
    assert.equal(formatSetlistNote('   '), '');
  });

  it('trims surrounding whitespace before wrapping', () => {
    assert.equal(formatSetlistNote('  Acoustic  '), '(Acoustic)');
  });
});
