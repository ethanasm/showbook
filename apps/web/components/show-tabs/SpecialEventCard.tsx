"use client";

import "./show-tabs.css";

interface PastEvent {
  date: string;
  performanceDate: string;
  venueName: string | null;
  songCount: number;
}

interface SpecialEventCardProps {
  /** Operator-curated explainer copy from `special_event_rules.effect.copy`.
   *  Rendered verbatim — no Markdown or HTML allowed (would defeat the
   *  spoiler-blur invariants). */
  copy: string;
  /** Prior matching events (date, venue, song count). Empty for non-
   *  date_match rule kinds in v1. */
  pastEvents: ReadonlyArray<PastEvent>;
}

/**
 * Phase 11 §15g — empty-state card for shows that match a
 * `special_event_rules` entry. The prediction algorithm is
 * intentionally suppressed for these (Phish Halloween: full album in
 * costume; Springsteen NYE marathons; Sphere residencies with themed
 * nights). The user gets context instead of a misleading prediction.
 */
export function SpecialEventCard({ copy, pastEvents }: SpecialEventCardProps) {
  return (
    <section
      className="special-event-card"
      data-testid="special-event-card"
      aria-label="Special event"
    >
      <h3 className="special-event-card__title">Tonight is a special one</h3>
      <p className="special-event-card__copy">{copy}</p>
      {pastEvents.length > 0 ? (
        <>
          <p className="special-event-card__past-title">From the archive</p>
          <ul className="special-event-card__past-list">
            {pastEvents.map((e) => (
              <li
                key={e.performanceDate}
                className="special-event-card__past-row"
              >
                <span>{e.date}</span>
                <span>
                  {e.venueName ? `${e.venueName} · ` : ""}
                  {e.songCount} songs
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
