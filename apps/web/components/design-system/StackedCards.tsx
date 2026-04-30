import "./design-system.css";
import type { ShowKind } from "./KindBadge";

export type StackedCardItem = {
  kind: ShowKind;
  day: string;
  month: string;
  title: string;
  venue: string;
  state: "ticketed" | "watching" | "seen";
};

const DEFAULT_ITEMS: StackedCardItem[] = [
  {
    kind: "concert",
    day: "14",
    month: "MAY",
    title: "Phoebe Bridgers",
    venue: "Forest Hills Stadium · Queens",
    state: "ticketed",
  },
  {
    kind: "theatre",
    day: "02",
    month: "JUN",
    title: "Hamlet",
    venue: "Royal Shakespeare · Stratford",
    state: "watching",
  },
  {
    kind: "comedy",
    day: "21",
    month: "MAR",
    title: "John Mulaney · From Scratch",
    venue: "Beacon Theatre · NYC",
    state: "seen",
  },
  {
    kind: "festival",
    day: "11",
    month: "JUL",
    title: "Pitchfork Music Festival",
    venue: "Union Park · Chicago",
    state: "watching",
  },
];

const STATE_LABELS: Record<StackedCardItem["state"], string> = {
  ticketed: "Ticketed",
  watching: "Watching",
  seen: "Seen",
};

export function StackedCards({ items = DEFAULT_ITEMS }: { items?: StackedCardItem[] }) {
  return (
    <div className="stacked-cards" aria-hidden="true">
      {items.slice(0, 4).map((item) => (
        <div key={`${item.kind}-${item.title}-${item.day}`} className="stacked-card">
          <span className={`stacked-card__bar stacked-card__bar--${item.kind}`} />
          <div className="stacked-card__date">
            <strong>{item.day}</strong>
            {item.month}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="stacked-card__title">{item.title}</div>
            <div className="stacked-card__venue">{item.venue}</div>
          </div>
          <span className={`stacked-card__chip stacked-card__chip--${item.state}`}>
            {STATE_LABELS[item.state]}
          </span>
        </div>
      ))}
    </div>
  );
}
