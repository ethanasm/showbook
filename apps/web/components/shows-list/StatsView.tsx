"use client";

import { Square } from "lucide-react";
import type { ShowKind } from "@/components/design-system";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { getHeadliner } from "@/lib/show-accessors";
import {
  ALL_KINDS,
  MONTHS,
  MONTH_NAMES,
  type ShowData,
  type StatsTimeframe,
  getNeighborhood,
  getYear,
  toDateParts,
} from "./helpers";

/**
 * Stats view for the Shows list page — total / spend / venue and
 * artist counts, monthly rhythm chart, top-N artists and venues,
 * kind mix, and a "this year" superlatives strip.
 *
 * Lifted out of ShowsListView. Only depends on the raw show list,
 * the selected timeframe, and the responsive `isMobile` flag —
 * no other parent state is reached.
 */
export interface StatsViewProps {
  shows: ShowData[];
  timeframe: StatsTimeframe;
  onTimeframeChange: (next: StatsTimeframe) => void;
  isMobile: boolean;
}

export function StatsView({
  shows: rawShows,
  timeframe,
  onTimeframeChange,
  isMobile,
}: StatsViewProps) {
  const currentYear = new Date().getFullYear();
  const allShowsList = rawShows.filter((s) => {
    if (timeframe === "all") return true;
    const y = getYear(s.date);
    if (timeframe === "year") return y === currentYear;
    if (timeframe === "5years") return y >= currentYear - 4;
    return true;
  });
  const total = allShowsList.length;

  // Compute stats
  const totalSpent = allShowsList.reduce(
    (sum, s) => sum + (s.pricePaid ? parseFloat(s.pricePaid) : 0),
    0,
  );
  const avgPerShow = total > 0 ? Math.round(totalSpent / total) : 0;

  const uniqueVenues = new Set(allShowsList.map((s) => s.venue.name)).size;
  const uniqueArtists = new Set(
    allShowsList.flatMap((s) => s.showPerformers.map((sp) => sp.performer.name)),
  ).size;

  const newArtistsThisYear = (() => {
    const thisYearArtists = new Set(
      allShowsList
        .filter((s) => getYear(s.date) === currentYear)
        .flatMap((s) => s.showPerformers.map((sp) => sp.performer.name)),
    );
    const prevArtists = new Set(
      allShowsList
        .filter((s) => getYear(s.date) < currentYear)
        .flatMap((s) => s.showPerformers.map((sp) => sp.performer.name)),
    );
    return Array.from(thisYearArtists).filter((a) => !prevArtists.has(a)).length;
  })();

  // Venues in rotation (appeared in last 2 years)
  const rotationVenues = new Set(
    allShowsList
      .filter((s) => getYear(s.date) >= currentYear - 1)
      .map((s) => s.venue.name),
  ).size;

  // Rhythm chart — shows per month in current year
  const rhythm = MONTHS.map((_, i) => {
    const monthShows = allShowsList.filter((s) => {
      if (!s.date) return false;
      const d = new Date(s.date + "T00:00:00");
      return d.getFullYear() === currentYear && d.getMonth() === i;
    });
    const attended = monthShows.filter((s) => s.state === "past").length;
    const ticketed = monthShows.filter((s) => s.state === "ticketed").length;
    return { a: attended, t: ticketed };
  });

  const ytdShows = allShowsList.filter(
    (s) => getYear(s.date) === currentYear,
  ).length;
  const currentMonth = new Date().getMonth();
  const pace =
    currentMonth > 0
      ? Math.round((ytdShows / (currentMonth + 1)) * 12)
      : ytdShows * 12;

  // Top artists
  const artistCounts = new Map<string, { count: number; kind: ShowKind }>();
  for (const show of allShowsList) {
    const name = getHeadliner(show);
    const prev = artistCounts.get(name);
    artistCounts.set(name, { count: (prev?.count ?? 0) + 1, kind: show.kind });
  }
  const topArtists = Array.from(artistCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);
  const maxArtistCount = Math.max(...topArtists.map(([, v]) => v.count), 1);

  // Top venues
  const venueCounts = new Map<
    string,
    { count: number; neighborhood: string }
  >();
  for (const show of allShowsList) {
    const name = show.venue.name;
    const prev = venueCounts.get(name);
    venueCounts.set(name, {
      count: (prev?.count ?? 0) + 1,
      neighborhood: getNeighborhood(show) ?? "",
    });
  }
  const topVenues = Array.from(venueCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5);
  const maxVenueCount = Math.max(...topVenues.map(([, v]) => v.count), 1);

  // Kind mix
  const kindCounts = new Map<ShowKind, number>();
  for (const show of allShowsList) {
    kindCounts.set(show.kind, (kindCounts.get(show.kind) ?? 0) + 1);
  }
  const kindMix = ALL_KINDS.map((k) => ({
    kind: k,
    count: kindCounts.get(k) ?? 0,
  }))
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count);

  const SPARKLINE_MAX = Math.max(maxArtistCount, maxVenueCount, 8);

  const timeframeLabel =
    timeframe === "year"
      ? String(currentYear)
      : timeframe === "5years"
        ? `${currentYear - 4}–${currentYear}`
        : "All time";

  // Compact dollar formatting for mobile — "$6,754.58" overflows a
  // narrow stat card; "$6.7k" tells the same story without forcing
  // a horizontal scroll.
  const compactSpent = (() => {
    if (totalSpent <= 0) return "$0";
    if (!isMobile) return `$${totalSpent.toLocaleString()}`;
    if (totalSpent >= 10_000) return `$${(totalSpent / 1000).toFixed(1)}k`;
    return `$${Math.round(totalSpent).toLocaleString()}`;
  })();

  return (
    <div
      style={{
        background: "var(--bg)",
        padding: isMobile
          ? "16px 16px 24px"
          : "22px var(--page-pad-x) var(--page-pad-x)",
        ...(isMobile ? {} : { flex: 1, minHeight: 0, overflow: "auto" }),
      }}
    >
      {/* Timeframe selector */}
      <div
        style={{
          display: "flex",
          alignItems: isMobile ? "stretch" : "center",
          justifyContent: "space-between",
          flexDirection: isMobile ? "column" : "row",
          gap: isMobile ? 10 : 0,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: ".06em",
          }}
        >
          {timeframeLabel} &middot; {total} show{total !== 1 ? "s" : ""}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            border: "1px solid var(--rule-strong)",
            ...(isMobile ? { width: "100%" } : {}),
          }}
        >
          {(
            [
              { k: "year" as StatsTimeframe, l: "This year" },
              { k: "5years" as StatsTimeframe, l: "Last 5 yrs" },
              { k: "all" as StatsTimeframe, l: "All time" },
            ]
          ).map(({ k, l }, i, arr) => {
            const active = timeframe === k;
            return (
              <button
                key={k}
                onClick={() => onTimeframeChange(k)}
                data-testid={`stats-timeframe-${k}`}
                style={{
                  padding: isMobile ? "8px 0" : "6px 13px",
                  border: "none",
                  borderRight:
                    i < arr.length - 1 ? "1px solid var(--rule-strong)" : "none",
                  background: active ? "var(--ink)" : "transparent",
                  color: active ? "var(--bg)" : "var(--ink)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                  letterSpacing: ".04em",
                  flex: isMobile ? 1 : "0 0 auto",
                  whiteSpace: "nowrap",
                }}
              >
                {l}
              </button>
            );
          })}
        </div>
      </div>

      {/* Big headline numbers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
          gap: 1,
          background: "var(--rule)",
          border: isMobile ? "1px solid var(--rule)" : undefined,
          marginBottom: isMobile ? 18 : 22,
        }}
      >
        {[
          [String(total), "shows", "all time"],
          [compactSpent, "spent", total > 0 ? `avg $${avgPerShow} / show` : ""],
          [String(uniqueVenues), "venues", `${rotationVenues} in rotation`],
          [
            String(uniqueArtists),
            "artists",
            `+ ${newArtistsThisYear} new in ${currentYear}`,
          ],
        ].map(([v, l, sub]) => (
          <div
            key={l}
            style={{
              background: "var(--surface)",
              padding: isMobile ? "16px 14px 14px" : "22px 22px 20px",
              minWidth: 0,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: isMobile ? 30 : 44,
                fontWeight: 500,
                color: "var(--ink)",
                letterSpacing: isMobile ? -0.9 : -1.6,
                lineHeight: 0.95,
                fontFeatureSettings: '"tnum"',
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {v}
            </div>
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: isMobile ? 10 : 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                marginTop: isMobile ? 6 : 10,
                fontWeight: 500,
              }}
            >
              {l}
            </div>
            {sub && (
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  color: "var(--faint)",
                  marginTop: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Rhythm chart */}
      <div
        style={{
          background: "var(--surface)",
          padding: isMobile ? "16px 14px" : "22px 26px",
          marginBottom: isMobile ? 18 : 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: isMobile ? "flex-start" : "baseline",
            justifyContent: "space-between",
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 10 : 0,
            marginBottom: isMobile ? 14 : 18,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Rhythm &middot; {currentYear}
            </div>
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
                marginTop: 4,
              }}
            >
              {ytdShows} shows year-to-date &middot; pace for ~{pace}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 16,
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
            }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <div
                style={{ width: 9, height: 9, background: "var(--ink)" }}
              />{" "}
              attended
            </span>
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
            >
              <Square size={9} color="var(--ink)" /> ticketed
            </span>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            gap: isMobile ? 3 : 6,
            alignItems: "end",
            height: isMobile ? 72 : 96,
            position: "relative",
          }}
        >
          {rhythm.map((m, i) => {
            const isNow = i === currentMonth;
            const cellH = isMobile ? 12 : 18;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column-reverse",
                  gap: 2,
                  height: "100%",
                  position: "relative",
                }}
              >
                {Array.from({ length: m.a }).map((_, j) => (
                  <div
                    key={"a" + j}
                    style={{ height: cellH, background: "var(--ink)" }}
                  />
                ))}
                {Array.from({ length: m.t }).map((_, j) => (
                  <div
                    key={"t" + j}
                    style={{
                      height: cellH,
                      border: "1.25px solid var(--ink)",
                      background: "transparent",
                    }}
                  />
                ))}
                {isNow && (
                  <div
                    style={{
                      position: "absolute",
                      top: -16,
                      left: "50%",
                      transform: "translateX(-50%)",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 9,
                      color: "var(--kind-concert)",
                      letterSpacing: ".1em",
                      whiteSpace: "nowrap",
                      fontWeight: 500,
                    }}
                  >
                    TODAY
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, 1fr)",
            gap: isMobile ? 3 : 6,
            marginTop: 10,
          }}
        >
          {MONTHS.map((m, i) => (
            <div
              key={i}
              style={{
                textAlign: "center",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: isMobile ? 8.5 : 10,
                color: i === currentMonth ? "var(--ink)" : "var(--faint)",
                letterSpacing: isMobile ? ".02em" : ".06em",
                fontWeight: i === currentMonth ? 500 : 400,
              }}
            >
              {isMobile ? m[0] : m}
            </div>
          ))}
        </div>
      </div>

      {/* Most seen / Most frequented / By kind */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 340px",
          gap: isMobile ? 18 : 22,
        }}
      >
        {/* Most seen artists */}
        <div
          style={{
            background: "var(--surface)",
            padding: isMobile ? "16px 14px 12px" : "22px 22px 18px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: isMobile ? 12 : 16,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Most seen
            </div>
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              artists &middot; {timeframeLabel.toLowerCase()}
            </div>
          </div>
          {topArtists.map(([name, { count, kind }]) => {
            const pct = Math.max(8, Math.round((count / maxArtistCount) * 100));
            if (isMobile) {
              return (
                <div
                  key={name}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid var(--rule)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 6,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: 14,
                        fontWeight: 500,
                        color: "var(--ink)",
                        letterSpacing: -0.1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {name}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11.5,
                        color: "var(--ink)",
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {count}&times;
                    </div>
                  </div>
                  <div style={{ height: 6, background: "var(--surface2)" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: `var(--kind-${kind})`,
                      }}
                    />
                  </div>
                </div>
              );
            }
            return (
              <div
                key={name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 30px",
                  columnGap: 14,
                  alignItems: "center",
                  padding: "11px 0",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 14,
                    color: "var(--ink)",
                    letterSpacing: -0.1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {name}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {Array.from({ length: SPARKLINE_MAX }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        height: 9,
                        flex: 1,
                        background:
                          i < count ? `var(--kind-${kind})` : "transparent",
                        border:
                          i < count ? "none" : "1px solid var(--rule-strong)",
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11.5,
                    color: "var(--ink)",
                    textAlign: "right",
                    fontWeight: 500,
                  }}
                >
                  {count}&times;
                </div>
              </div>
            );
          })}
          {topArtists.length === 0 && (
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              No data
            </div>
          )}
        </div>

        {/* Most frequented venues */}
        <div
          style={{
            background: "var(--surface)",
            padding: isMobile ? "16px 14px 12px" : "22px 22px 18px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: isMobile ? 12 : 16,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Most frequented
            </div>
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              venues &middot; {timeframeLabel.toLowerCase()}
            </div>
          </div>
          {topVenues.map(([name, { count, neighborhood }]) => {
            const pct = Math.max(8, Math.round((count / maxVenueCount) * 100));
            if (isMobile) {
              return (
                <div
                  key={name}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid var(--rule)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-sans), sans-serif",
                          fontSize: 14,
                          fontWeight: 500,
                          color: "var(--ink)",
                          letterSpacing: -0.1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {name}
                      </div>
                      {neighborhood && (
                        <div
                          style={{
                            fontFamily: "var(--font-geist-mono), monospace",
                            fontSize: 10,
                            color: "var(--muted)",
                            marginTop: 1,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {neighborhood.toLowerCase()}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11.5,
                        color: "var(--ink)",
                        fontWeight: 500,
                        flexShrink: 0,
                      }}
                    >
                      {count}
                    </div>
                  </div>
                  <div style={{ height: 6, background: "var(--surface2)" }}>
                    <div
                      style={{
                        width: `${pct}%`,
                        height: "100%",
                        background: "var(--ink)",
                      }}
                    />
                  </div>
                </div>
              );
            }
            return (
              <div
                key={name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 80px 30px",
                  columnGap: 14,
                  alignItems: "center",
                  padding: "11px 0",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 14,
                      color: "var(--ink)",
                      letterSpacing: -0.1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 10,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    {neighborhood.toLowerCase()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {Array.from({ length: SPARKLINE_MAX }).map((_, i) => (
                    <div
                      key={i}
                      style={{
                        height: 9,
                        flex: 1,
                        background: i < count ? "var(--ink)" : "transparent",
                        border:
                          i < count ? "none" : "1px solid var(--rule-strong)",
                      }}
                    />
                  ))}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11.5,
                    color: "var(--ink)",
                    textAlign: "right",
                    fontWeight: 500,
                  }}
                >
                  {count}
                </div>
              </div>
            );
          })}
          {topVenues.length === 0 && (
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              No data
            </div>
          )}
        </div>

        {/* Kind mix */}
        <div
          style={{
            background: "var(--surface)",
            padding: isMobile ? "16px 14px 12px" : "22px 22px 18px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: isMobile ? 12 : 16,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--ink)",
                letterSpacing: ".1em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              By kind
            </div>
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              all {total}
            </div>
          </div>
          {kindMix.map(({ kind, count }) => {
            const KIcon = KIND_ICONS[kind];
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div
                key={kind}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: `var(--kind-${kind})`,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      fontWeight: 500,
                    }}
                  >
                    <KIcon size={13} color={`var(--kind-${kind})`} />
                    {KIND_LABELS[kind]}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: "var(--ink)",
                      fontWeight: 500,
                    }}
                  >
                    {count} &middot; {pct}%
                  </span>
                </div>
                <div style={{ height: 6, background: "var(--surface2)" }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      background: `var(--kind-${kind})`,
                    }}
                  />
                </div>
              </div>
            );
          })}
          {kindMix.length === 0 && (
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--faint)",
              }}
            >
              No data
            </div>
          )}
        </div>
      </div>

      {/* Superlatives strip */}
      <div
        style={{
          marginTop: isMobile ? 18 : 22,
          background: "var(--surface)",
          padding: isMobile ? "16px 14px" : "20px 26px",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--ink)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            fontWeight: 500,
            marginBottom: 14,
          }}
        >
          Superlatives &middot; {currentYear}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)",
            gap: isMobile ? 16 : 24,
          }}
        >
          {(() => {
            const thisYearShows = allShowsList.filter(
              (s) => getYear(s.date) === currentYear,
            );

            const priciest = thisYearShows
              .filter((s) => s.pricePaid)
              .sort(
                (a, b) => parseFloat(b.pricePaid!) - parseFloat(a.pricePaid!),
              )[0];
            const priciestVal = priciest
              ? `$${parseFloat(priciest.pricePaid!).toFixed(0)}`
              : "--";
            const priciestSub = priciest
              ? `${getHeadliner(priciest)} · ${toDateParts(priciest.date).month} ${toDateParts(priciest.date).day}`
              : "";

            const yearSpent = thisYearShows.reduce(
              (s, sh) => s + (sh.pricePaid ? parseFloat(sh.pricePaid) : 0),
              0,
            );

            const cheapest = thisYearShows
              .filter((s) => s.pricePaid && parseFloat(s.pricePaid) > 0)
              .sort(
                (a, b) => parseFloat(a.pricePaid!) - parseFloat(b.pricePaid!),
              )[0];
            const cheapestVal = cheapest
              ? `$${parseFloat(cheapest.pricePaid!).toFixed(0)}`
              : "--";
            const cheapestSub = cheapest
              ? `${getHeadliner(cheapest)} · ${toDateParts(cheapest.date).month} ${toDateParts(cheapest.date).day}`
              : "";

            const monthCounts = new Map<number, number>();
            for (const s of thisYearShows) {
              if (!s.date) continue;
              const m = new Date(s.date + "T00:00:00").getMonth();
              monthCounts.set(m, (monthCounts.get(m) ?? 0) + 1);
            }
            const bestMonth = Array.from(monthCounts.entries()).sort(
              (a, b) => b[1] - a[1],
            )[0];
            const bestMonthVal = bestMonth ? `${bestMonth[1]}` : "--";
            const bestMonthSub = bestMonth ? `${MONTH_NAMES[bestMonth[0]]}` : "";

            return [
              ["Priciest", priciestVal, priciestSub],
              ["Cheapest", cheapestVal, cheapestSub],
              ["Best month", bestMonthVal, bestMonthSub],
              [
                `${currentYear} spent`,
                yearSpent > 0 ? `$${yearSpent.toLocaleString()}` : "--",
                `${thisYearShows.length} shows`,
              ],
            ];
          })().map(([l, v, sub]) => (
            <div key={l} style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  color: "var(--faint)",
                  letterSpacing: ".1em",
                  textTransform: "uppercase",
                }}
              >
                {l}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: isMobile ? 22 : 26,
                  fontWeight: 500,
                  color: "var(--ink)",
                  letterSpacing: -0.7,
                  marginTop: 6,
                  fontFeatureSettings: '"tnum"',
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {v}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10.5,
                  color: "var(--muted)",
                  marginTop: 4,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
