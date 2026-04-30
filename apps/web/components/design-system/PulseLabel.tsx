import type { ReactNode } from "react";
import "./design-system.css";

export function PulseLabel({ children }: { children: ReactNode }) {
  return (
    <span className="pulse-label">
      <span className="pulse-dot" />
      <span>{children}</span>
    </span>
  );
}
