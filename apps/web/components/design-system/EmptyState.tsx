import type { ReactNode } from "react";
import "./design-system.css";
import { StackedCards } from "./StackedCards";

type EmptyKind = "shows" | "venues" | "artists" | "discover" | "map";

const EYEBROWS: Record<EmptyKind, string> = {
  shows: "Your live-show log",
  venues: "Venues from your shows",
  artists: "Artists from your shows and follows",
  discover: "Discovery queue",
  map: "Geographic view",
};

function titleWithGradient(title: ReactNode) {
  if (typeof title !== "string") return title;
  const words = title.trim().split(/\s+/);
  if (words.length <= 1) {
    return <span className="gradient-emphasis">{title}</span>;
  }
  const tail = words.pop();
  return (
    <>
      {words.join(" ")} <span className="gradient-emphasis">{tail}</span>
    </>
  );
}

export function EmptyState({
  kind,
  title,
  body,
  action,
}: {
  kind: EmptyKind;
  title: ReactNode;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`empty-state empty-state--${kind}`}>
      <div className="glow-backdrop" />
      <div className="empty-state__content">
        <div className="eyebrow">{EYEBROWS[kind]}</div>
        <h2 className="empty-state__title">{titleWithGradient(title)}</h2>
        <p className="empty-state__body">{body}</p>
        <div className="empty-state__chips">
          <span className="kind-chip kind-chip--concert">
            <span className="kind-chip__dot" />
            Concerts
          </span>
          <span className="kind-chip kind-chip--theatre">
            <span className="kind-chip__dot" />
            Theatre
          </span>
          <span className="kind-chip kind-chip--comedy">
            <span className="kind-chip__dot" />
            Comedy
          </span>
          <span className="kind-chip kind-chip--festival">
            <span className="kind-chip__dot" />
            Festivals
          </span>
        </div>
        {action && <div className="empty-state__action">{action}</div>}
      </div>
      <div className="empty-state__visual">
        <StackedCards />
      </div>
    </div>
  );
}
