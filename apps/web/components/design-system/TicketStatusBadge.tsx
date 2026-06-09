"use client";

import "./design-system.css";

export type TicketStatus = "sold_out" | "cancelled";

interface TicketStatusBadgeProps {
  status: TicketStatus;
}

const LABELS: Record<TicketStatus, string> = {
  sold_out: "Sold out",
  cancelled: "Cancelled",
};

/**
 * Per-user manual ticket-status override badge (sold out / cancelled).
 * Rectangular monospace styling to sit alongside the detail header's
 * went / tix / watching state badges.
 */
export function TicketStatusBadge({ status }: TicketStatusBadgeProps) {
  return (
    <span
      className={`ticket-status-badge ticket-status-badge--${status}`}
      data-testid={`ticket-status-${status}`}
    >
      {LABELS[status]}
    </span>
  );
}
