"use client";

import type { ShowKind } from "@/components/design-system";
import {
  StagedMediaPreview,
  type StagedMediaItem,
} from "@/components/media";
import type { PerformerSetlist } from "@showbook/shared";
import { setlistTotalSongs } from "@showbook/shared";

/**
 * Live preview panel rendered on the right of the Add Show screen.
 * Pure read-only render of the current form state — no setters,
 * no mutations. Lifted out of `app/(app)/add/page.tsx` so the
 * parent's monolithic body shrinks by ~285 lines.
 *
 * The kind / date / venue / headliner / performers / pricing /
 * setlists / media inputs all come in as props. Provenance status
 * is computed in the parent (depends on tRPC query state) and
 * passed in as an already-resolved array.
 */

const mono = "var(--font-geist-mono), monospace";
const sans = "var(--font-geist-sans), sans-serif";

const KIND_CONFIG: { kind: ShowKind; label: string; icon: string }[] = [
  { kind: "concert", label: "Concert", icon: "♫" },
  { kind: "theatre", label: "Theatre", icon: "🎭" },
  { kind: "comedy", label: "Comedy", icon: "🎙" },
  { kind: "festival", label: "Festival", icon: "★" },
];

const kindColor = (k: ShowKind) => `var(--kind-${k})`;

export interface ProvenanceRow {
  source: string;
  what: string;
  status: string;
}

export interface LivePreviewProps {
  kind: ShowKind | null;
  date: string;
  venue: { name: string; city: string };
  headliner: { name: string };
  productionName: string;
  performers: { name: string }[];
  seat: string;
  pricePaid: string;
  ticketCount: string;
  tourName: string;
  setlistsByPerformer: Record<string, PerformerSetlist>;
  stagedMedia: StagedMediaItem[];
  provenanceStatuses: ProvenanceRow[];
  isEditMode: boolean;
}

export function LivePreview({
  kind,
  date,
  venue,
  headliner,
  productionName,
  performers,
  seat,
  pricePaid,
  ticketCount,
  tourName,
  setlistsByPerformer,
  stagedMedia,
  provenanceStatuses,
  isEditMode,
}: LivePreviewProps) {
  const kindLabel = KIND_CONFIG.find((k) => k.kind === kind)?.label ?? "Show";
  const kColor = kind ? kindColor(kind) : "var(--muted)";

  // Format date for display
  let dateDisplay = "";
  let dateSub = "";
  let dateYear = "";
  if (date) {
    const d = new Date(date + "T12:00:00");
    const day = String(d.getDate()).padStart(2, "0");
    const monthNames = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const month = monthNames[d.getMonth()] ?? "";
    const dayOfWeek = dayNames[d.getDay()] ?? "";
    dateDisplay = `${day}`;
    dateSub = `${month} · ${dayOfWeek}`;
    dateYear = String(d.getFullYear());
  }

  // Time ago
  let timeAgo = "";
  if (date) {
    const now = new Date();
    const showDate = new Date(date + "T12:00:00");
    const diff = Math.floor(
      (now.getTime() - showDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diff > 0) timeAgo = `PAST · ${diff} DAYS AGO`;
    else if (diff === 0) timeAgo = "TODAY";
    else timeAgo = `IN ${Math.abs(diff)} DAYS`;
  }

  // Build detail rows
  const detailRows: [string, string][] = [];
  if (venue.name) detailRows.push(["Venue", venue.name]);
  if (venue.city) detailRows.push(["City", venue.city]);
  if (seat && kind !== "festival") detailRows.push(["Seat", seat]);
  if (pricePaid) {
    const count = parseInt(ticketCount) || 1;
    const perTicket = (parseFloat(pricePaid) / count).toFixed(2);
    detailRows.push([
      "Paid",
      `$${pricePaid}${count > 1 ? ` ($${perTicket}/ea × ${count})` : ""}`,
    ]);
  }
  if (tourName && kind !== "festival") detailRows.push(["Tour", tourName]);
  const totalSongs = Object.values(setlistsByPerformer).reduce(
    (sum, sl) => sum + setlistTotalSongs(sl),
    0,
  );
  if (totalSongs > 0) detailRows.push(["Setlist", `${totalSongs} songs`]);

  return (
    <div
      style={{
        padding: "28px 28px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      {/* Section header */}
      <div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          {isEditMode ? "Preview" : "Live preview"}
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 10,
            color: "var(--faint)",
            letterSpacing: ".02em",
            marginTop: 3,
          }}
        >
          {isEditMode
            ? "updated record preview"
            : "what the archive row will look like"}
        </div>
      </div>

      {/* Preview card */}
      <div
        style={{
          padding: "22px 22px",
          background: "var(--surface)",
          borderLeft: `3px solid ${kColor}`,
        }}
      >
        {/* Kind + time badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: mono,
              fontSize: 10.5,
              color: kColor,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            {kind ? KIND_CONFIG.find((k) => k.kind === kind)?.icon : "·"}{" "}
            {kindLabel}
          </span>
          {timeAgo && (
            <span
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                color: "var(--muted)",
                letterSpacing: ".04em",
              }}
            >
              {timeAgo}
            </span>
          )}
        </div>

        {/* Headliner / Title */}
        <div
          style={{
            fontFamily: sans,
            fontSize: 30,
            fontWeight: 600,
            color:
              productionName || headliner.name ? "var(--ink)" : "var(--faint)",
            letterSpacing: -1.1,
            lineHeight: 1,
          }}
        >
          {kind === "theatre" || kind === "festival"
            ? productionName || "Title"
            : headliner.name || "Headliner"}
        </div>
        {(kind === "theatre" || kind === "festival") && headliner.name && (
          <div
            style={{
              fontFamily: sans,
              fontSize: 14,
              color: "var(--muted)",
              marginTop: 6,
              letterSpacing: -0.15,
            }}
          >
            {headliner.name}
          </div>
        )}

        {/* Support */}
        {performers.length > 0 && (
          <div
            style={{
              fontFamily: sans,
              fontSize: 14,
              color: "var(--muted)",
              marginTop: 6,
              letterSpacing: -0.15,
            }}
          >
            with {performers.map((p) => p.name).join(", ")}
          </div>
        )}

        {/* Date display */}
        {date && (
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginTop: 18,
            }}
          >
            <div
              style={{
                fontFamily: sans,
                fontSize: 48,
                fontWeight: 500,
                color: "var(--ink)",
                letterSpacing: -1.8,
                lineHeight: 0.9,
                fontFeatureSettings: '"tnum"',
              }}
            >
              {dateDisplay}
            </div>
            <div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: kColor,
                  letterSpacing: ".1em",
                  fontWeight: 500,
                }}
              >
                {dateSub}
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: "var(--muted)",
                  letterSpacing: ".04em",
                  marginTop: 3,
                }}
              >
                {dateYear}
              </div>
            </div>
          </div>
        )}

        {/* Detail rows */}
        {detailRows.length > 0 && (
          <div
            style={{
              marginTop: 18,
              fontFamily: mono,
              fontSize: 11,
              display: "grid",
              gridTemplateColumns: "1fr",
              rowGap: 0,
            }}
          >
            {detailRows.map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "grid",
                  gridTemplateColumns: "82px 1fr",
                  columnGap: 10,
                  padding: "6px 0",
                  borderTop: `1px solid var(--rule)`,
                  alignItems: "baseline",
                }}
              >
                <div
                  style={{
                    color: "var(--faint)",
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    fontSize: 10,
                  }}
                >
                  {k}
                </div>
                <div style={{ color: "var(--ink)", letterSpacing: ".02em" }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Photo strip — staged thumbs if any, else placeholders */}
        <div style={{ marginTop: 16 }}>
          {stagedMedia.length > 0 ? (
            <StagedMediaPreview staged={stagedMedia} />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 6,
              }}
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    aspectRatio: "4/3",
                    background: `repeating-linear-gradient(135deg, var(--surface2) 0 6px, var(--bg) 6px 12px)`,
                    border: `1px solid var(--rule)`,
                    display: "flex",
                    alignItems: "flex-end",
                    padding: 5,
                  }}
                >
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 9,
                      color: "var(--faint)",
                      letterSpacing: ".06em",
                    }}
                  >
                    IMG_{String(i).padStart(2, "0")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Provenance Log (hidden in edit mode) ── */}
      {!isEditMode && (
        <div>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Provenance · auto-fetched
          </div>
          <div style={{ border: `1px solid var(--rule-strong)` }}>
            {provenanceStatuses.map((row, i) => {
              const isOk = row.status === "ok";
              const isSkipped = row.status === "skipped";
              return (
                <div
                  key={row.source}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr auto",
                    columnGap: 12,
                    padding: "10px 14px",
                    borderTop: i === 0 ? "none" : `1px solid var(--rule)`,
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10.5,
                      color: "var(--ink)",
                      letterSpacing: ".06em",
                      textTransform: "uppercase",
                      fontWeight: 500,
                    }}
                  >
                    {row.source}
                  </div>
                  <div
                    style={{
                      fontFamily: sans,
                      fontSize: 12.5,
                      color: "var(--muted)",
                      letterSpacing: -0.1,
                    }}
                  >
                    {row.what}
                  </div>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      color: isOk
                        ? "var(--kind-festival)"
                        : isSkipped
                          ? "var(--muted)"
                          : "var(--faint)",
                      letterSpacing: ".04em",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {isOk ? "✓" : isSkipped ? "–" : "···"} {row.status}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={{
              marginTop: 10,
              fontFamily: mono,
              fontSize: 10,
              color: "var(--faint)",
              letterSpacing: ".04em",
              lineHeight: 1.5,
            }}
          >
            we never ask you to type cast, setlists, or tour names — these are
            fetched from sources when you pick an artist + date.
          </div>
        </div>
      )}
    </div>
  );
}
