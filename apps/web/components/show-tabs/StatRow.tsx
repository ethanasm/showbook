"use client";

import Link from "next/link";
import "./show-tabs.css";

export interface StatCell {
  label: string;
  value: string;
  sub?: string;
  /**
   * Optional href — when present the cell's `value` renders as a Next.js
   * `<Link>` so screen readers + Playwright `getByRole('link')` selectors
   * still find it. Used for the venue cell so the legacy navigation
   * contract (click venue → /venues/<id>) is preserved.
   */
  href?: string;
}

interface StatRowProps {
  cells: StatCell[];
}

/**
 * 4-column stat row used at the top of the Overview tab. Collapses to
 * a 2×2 grid below 480px (handled by the CSS class `.show-stat-row`).
 */
export function StatRow({ cells }: StatRowProps) {
  return (
    <div className="show-stat-row" data-testid="show-stat-row">
      {cells.map((cell) => (
        <div key={cell.label} className="show-stat-cell">
          <div className="show-stat-cell__label">{cell.label}</div>
          <div className="show-stat-cell__value">
            {cell.href ? (
              <Link href={cell.href} style={{ color: "inherit", textDecoration: "none" }}>
                {cell.value}
              </Link>
            ) : (
              cell.value
            )}
          </div>
          {cell.sub && <div className="show-stat-cell__sub">{cell.sub}</div>}
        </div>
      ))}
    </div>
  );
}
