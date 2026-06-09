import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { TicketStatusBadge } from '../design-system/TicketStatusBadge';

describe('TicketStatusBadge', () => {
  it('renders the sold-out label and modifier class', () => {
    const { getByText } = render(<TicketStatusBadge status="sold_out" />);
    const el = getByText('Sold out');
    assert.match(el.className, /ticket-status-badge--sold_out/);
    cleanup();
  });

  it('renders the cancelled label and modifier class', () => {
    const { getByText } = render(<TicketStatusBadge status="cancelled" />);
    const el = getByText('Cancelled');
    assert.match(el.className, /ticket-status-badge--cancelled/);
    cleanup();
  });
});
