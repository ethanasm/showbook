"use client";

import "./design-system.css";
import type { ShowKind } from "./KindBadge";

interface HeroShow {
  headliner: string;
  venue: string;
  date: string;
  seat?: string;
  kind: ShowKind;
}

interface HeroCardProps {
  show: HeroShow;
}

const KIND_GRADIENTS: Record<ShowKind, string> = {
  concert:
    "linear-gradient(135deg, var(--kind-concert) 0%, color-mix(in srgb, var(--kind-concert) 60%, #0C0C0C) 100%)",
  theatre:
    "linear-gradient(135deg, var(--kind-theatre) 0%, color-mix(in srgb, var(--kind-theatre) 60%, #0C0C0C) 100%)",
  comedy:
    "linear-gradient(135deg, var(--kind-comedy) 0%, color-mix(in srgb, var(--kind-comedy) 60%, #0C0C0C) 100%)",
  festival:
    "linear-gradient(135deg, var(--kind-festival) 0%, color-mix(in srgb, var(--kind-festival) 60%, #0C0C0C) 100%)",
};

function daysUntil(dateStr: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function countdownText(dateStr: string): string {
  const days = daysUntil(dateStr);
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

export function HeroCard({ show }: HeroCardProps) {
  return (
    <div className="hero-card">
      <div
        className="hero-card__bg"
        style={{ background: KIND_GRADIENTS[show.kind] }}
      />
      <div className="hero-card__body">
        <div className="hero-card__countdown">
          Next up · {countdownText(show.date)}
        </div>
        <div className="hero-card__headliner">{show.headliner}</div>
        <div className="hero-card__detail">
          {show.venue}
          <br />
          {show.date}
          {show.seat && (
            <>
              <br />
              Seat {show.seat}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
