import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { SegmentedControl } from '../design-system/SegmentedControl';

describe('SegmentedControl', () => {
  it('renders one button per option', () => {
    const { getAllByRole } = render(
      <SegmentedControl options={['A', 'B', 'C']} selected="A" onChange={() => {}} />,
    );
    const buttons = getAllByRole('button');
    assert.equal(buttons.length, 3);
    assert.equal(buttons[0]?.textContent, 'A');
    cleanup();
  });

  it('marks the selected option active', () => {
    const { getByText } = render(
      <SegmentedControl options={['A', 'B']} selected="B" onChange={() => {}} />,
    );
    assert.match(getByText('B').className, /segmented-control__option--active/);
    assert.match(getByText('A').className, /segmented-control__option--inactive/);
    cleanup();
  });

  it('calls onChange with the option value when clicked', () => {
    const seen: string[] = [];
    const { getByText } = render(
      <SegmentedControl
        options={['A', 'B', 'C']}
        selected="A"
        onChange={(v) => seen.push(v)}
      />,
    );
    fireEvent.click(getByText('B'));
    fireEvent.click(getByText('C'));
    assert.deepEqual(seen, ['B', 'C']);
    cleanup();
  });

  it('handles empty options without crashing', () => {
    const { container } = render(
      <SegmentedControl options={[]} selected="" onChange={() => {}} />,
    );
    assert.equal(container.querySelectorAll('button').length, 0);
    cleanup();
  });
});
