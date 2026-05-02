import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Sidebar } from '../design-system/Sidebar';

describe('Sidebar admin gate', () => {
  it('does not render the Admin item when isAdmin is false (default)', () => {
    const { queryByText } = render(<Sidebar />);
    assert.equal(queryByText('Admin'), null);
    cleanup();
  });

  it('does not render the Admin item when isAdmin is explicitly false', () => {
    const { queryByText } = render(<Sidebar isAdmin={false} />);
    assert.equal(queryByText('Admin'), null);
    cleanup();
  });

  it('renders the Admin item when isAdmin is true', () => {
    const { getByText } = render(<Sidebar isAdmin />);
    assert.ok(getByText('Admin'));
    cleanup();
  });

  it('routes the Admin click through onNavigate("admin")', () => {
    const seen: string[] = [];
    const { getByText } = render(
      <Sidebar isAdmin onNavigate={(id) => seen.push(id)} />,
    );
    fireEvent.click(getByText('Admin'));
    assert.deepEqual(seen, ['admin']);
    cleanup();
  });
});
