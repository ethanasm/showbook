import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCurrency, formatSeatDisplay } from '../utils/format';

describe('formatCurrency', () => {
  it('formats integer dollars', () => {
    assert.equal(formatCurrency(50), '$50.00');
  });

  it('formats decimal dollars', () => {
    assert.equal(formatCurrency(123.45), '$123.45');
  });

  it('parses string input', () => {
    assert.equal(formatCurrency('99.95'), '$99.95');
  });

  it('handles zero', () => {
    assert.equal(formatCurrency(0), '$0.00');
  });

  it('rounds to two decimals', () => {
    assert.equal(formatCurrency(10.999), '$11.00');
  });

  it('formats thousands with commas', () => {
    assert.equal(formatCurrency(1234.5), '$1,234.50');
  });
});

describe('formatSeatDisplay', () => {
  it('uppercases the seat label', () => {
    assert.equal(formatSeatDisplay('row b seat 3'), 'ROW B SEAT 3');
  });

  it('passes through already-upper input', () => {
    assert.equal(formatSeatDisplay('GA'), 'GA');
  });

  it('handles empty string', () => {
    assert.equal(formatSeatDisplay(''), '');
  });
});
