import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { StateChip } from '../design-system/StateChip';

describe('StateChip', () => {
  it('renders TIX for ticketed', () => {
    const { getByText } = render(<StateChip state="ticketed" />);
    const el = getByText('TIX');
    assert.match(el.className, /state-chip--ticketed/);
    cleanup();
  });

  it('renders WATCHING for watching', () => {
    const { getByText } = render(<StateChip state="watching" />);
    const el = getByText('WATCHING');
    assert.match(el.className, /state-chip--watching/);
    cleanup();
  });
});
