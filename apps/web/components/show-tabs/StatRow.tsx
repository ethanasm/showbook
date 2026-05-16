"use client";

import "./show-tabs.css";

export interface StatCell {
  label: string;
  value: string;
  sub?: string;
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
          <div className="show-stat-cell__value">{cell.value}</div>
          {cell.sub && <div className="show-stat-cell__sub">{cell.sub}</div>}
        </div>
      ))}
    </div>
  );
}
