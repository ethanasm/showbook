import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ListSearchBar } from '../ListSearchBar';

describe('ListSearchBar', () => {
  it('renders a controlled input with the placeholder as its label', () => {
    const { getByTestId } = render(
      <ListSearchBar
        value="dylan"
        onChange={() => {}}
        placeholder="Search shows…"
        testId="x-search"
      />,
    );
    const input = getByTestId('x-search') as HTMLInputElement;
    assert.equal(input.value, 'dylan');
    assert.equal(input.getAttribute('aria-label'), 'Search shows…');
    cleanup();
  });

  it('calls onChange as the user types', () => {
    let last = '';
    const { getByTestId } = render(
      <ListSearchBar
        value=""
        onChange={(v) => {
          last = v;
        }}
        placeholder="Search…"
        testId="x-search"
      />,
    );
    fireEvent.change(getByTestId('x-search'), { target: { value: 'bob' } });
    assert.equal(last, 'bob');
    cleanup();
  });

  it('hides the clear button when empty and clears on click when filled', () => {
    let last = 'seed';
    const { queryByTestId, rerender } = render(
      <ListSearchBar value="" onChange={(v) => (last = v)} placeholder="S" testId="x" />,
    );
    assert.equal(queryByTestId('x-clear'), null, 'no clear button while empty');

    rerender(<ListSearchBar value="bob" onChange={(v) => (last = v)} placeholder="S" testId="x" />);
    const clear = queryByTestId('x-clear');
    assert.ok(clear, 'clear button appears once there is a query');
    fireEvent.click(clear!);
    assert.equal(last, '', 'clicking clear resets the query to empty');
    cleanup();
  });
});
