"use client";

import type { ReactNode } from "react";
import "./show-tabs.css";

interface SectionFrameProps {
  title: string;
  count?: number;
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}

/**
 * Section wrapper used inside every tab body. Renders the tracked-
 * uppercase title + optional `· N` count + optional right-aligned
 * action button.
 */
export function SectionFrame({
  title,
  count,
  action,
  children,
}: SectionFrameProps) {
  return (
    <section
      className="show-section"
      data-testid={`show-section-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <header className="show-section__header">
        <div style={{ display: "flex", alignItems: "baseline" }}>
          <span className="show-section__title">{title}</span>
          {count !== undefined && (
            <span className="show-section__count">· {count}</span>
          )}
        </div>
        {action && (
          <button
            type="button"
            className="show-section__action"
            onClick={action.onClick}
          >
            {action.label.toLowerCase()}
          </button>
        )}
      </header>
      {children}
    </section>
  );
}
