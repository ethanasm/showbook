import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Toggle } from '../design-system/Toggle';

describe('Toggle', () => {
  it('reflects checked state via aria-checked', () => {
    const { getByRole, rerender } = render(
      <Toggle checked={false} onChange={() => {}} />,
    );
    assert.equal(getByRole('switch').getAttribute('aria-checked'), 'false');
    rerender(<Toggle checked={true} onChange={() => {}} />);
    assert.equal(getByRole('switch').getAttribute('aria-checked'), 'true');
    cleanup();
  });

  it('toggles the value via onChange when clicked', () => {
    const seen: boolean[] = [];
    const { getByRole } = render(
      <Toggle checked={false} onChange={(v) => seen.push(v)} />,
    );
    fireEvent.click(getByRole('switch'));
    assert.deepEqual(seen, [true]);
    cleanup();
  });

  it('passes the inverse on each click given updated checked', () => {
    const seen: boolean[] = [];
    const { getByRole, rerender } = render(
      <Toggle checked={false} onChange={(v) => seen.push(v)} />,
    );
    fireEvent.click(getByRole('switch'));
    rerender(<Toggle checked={true} onChange={(v) => seen.push(v)} />);
    fireEvent.click(getByRole('switch'));
    assert.deepEqual(seen, [true, false]);
    cleanup();
  });

  it('respects disabled state', () => {
    const seen: boolean[] = [];
    const { getByRole } = render(
      <Toggle checked={false} onChange={(v) => seen.push(v)} disabled />,
    );
    const sw = getByRole('switch') as HTMLButtonElement;
    assert.equal(sw.disabled, true);
    fireEvent.click(sw);
    assert.deepEqual(seen, []); // disabled buttons do not fire onClick
    cleanup();
  });
});
