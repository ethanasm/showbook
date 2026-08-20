import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { StateChip } from '../design-system/StateChip';

describe('StateChip', () => {
  it('renders Ticketed for ticketed', () => {
    const { getByText } = render(<StateChip state="ticketed" />);
    const el = getByText('Ticketed');
    assert.match(el.className, /state-chip--ticketed/);
    cleanup();
  });

  it('renders Watching for watching', () => {
    const { getByText } = render(<StateChip state="watching" />);
    const el = getByText('Watching');
    assert.match(el.className, /state-chip--watching/);
    cleanup();
  });
});
