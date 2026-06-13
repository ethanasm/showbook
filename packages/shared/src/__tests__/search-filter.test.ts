import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearchQuery, searchQueryTokens } from '../utils/search-filter';

test('empty / whitespace query matches everything (no filter)', () => {
  assert.equal(matchesSearchQuery('', ['Bob Dylan', 'Greek Theatre']), true);
  assert.equal(matchesSearchQuery('   ', ['Bob Dylan']), true);
  // Even with no fields, an empty query is the no-filter case.
  assert.equal(matchesSearchQuery('', []), true);
});

test('matches a substring within any single field', () => {
  const fields = ['Bob Dylan', 'Greek Theatre', 'Berkeley'];
  assert.equal(matchesSearchQuery('dylan', fields), true);
  assert.equal(matchesSearchQuery('greek', fields), true);
  assert.equal(matchesSearchQuery('berk', fields), true);
  assert.equal(matchesSearchQuery('phish', fields), false);
});

test('is case-insensitive', () => {
  assert.equal(matchesSearchQuery('DYLAN', ['Bob Dylan']), true);
  assert.equal(matchesSearchQuery('dYlAn', ['Bob Dylan']), true);
});

test('folds diacritics on both query and fields', () => {
  assert.equal(matchesSearchQuery('michael', ['Michaël Brun']), true);
  assert.equal(matchesSearchQuery('michaël', ['Michael Brun']), true);
  assert.equal(matchesSearchQuery('beyonce', ['Beyoncé']), true);
});

test('multi-token query requires every token (AND across tokens, OR across fields)', () => {
  const fields = ['Bob Dylan', 'Greek Theatre', 'Berkeley'];
  // Tokens span two different fields — still a match.
  assert.equal(matchesSearchQuery('dylan berkeley', fields), true);
  assert.equal(matchesSearchQuery('bob theatre', fields), true);
  // One token has no home → no match.
  assert.equal(matchesSearchQuery('dylan oakland', fields), false);
});

test('ignores null / undefined / empty fields', () => {
  assert.equal(matchesSearchQuery('dylan', [null, undefined, '', 'Bob Dylan']), true);
  // A non-empty query against only empty fields cannot match.
  assert.equal(matchesSearchQuery('dylan', [null, undefined, '']), false);
});

test('searchQueryTokens splits, folds, and drops empties', () => {
  assert.deepEqual(searchQueryTokens('  Bob   Dylan '), ['bob', 'dylan']);
  assert.deepEqual(searchQueryTokens('Michaël'), ['michael']);
  assert.deepEqual(searchQueryTokens('   '), []);
});
