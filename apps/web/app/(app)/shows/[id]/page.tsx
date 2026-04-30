"use client";

import { useParams, useRouter, } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  MapPin,
  MoreHorizontal,
  Trash2,
  Ticket,
  ChevronLeft,
  CalendarPlus,
} from "lucide-react";
import {
  StateChip,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";
import { MediaSection } from "@/components/media";
import {
  daysUntil,
  formatDateLong,
  formatDateRangeLong,
} from "@showbook/shared";

const KIND_ICONS: Record<
  ShowKind,
  React.ComponentType<{ size?: number; color?: string; className?: string }>
> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

const KIND_LABELS: Record<ShowKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
};

const STATE_TRANSITIONS: Record<string, { label: string; target: ShowState }> = {
  watching: { label: "Got tickets", target: "ticketed" },
  ticketed: { label: "Mark as attended", target: "past" },
};

const ROLE_LABEL: Record<string, string> = {
  headliner: "Headliner",
  support: "Support",
  cast: "Cast",
};

export default function ShowDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const showId = params?.id ?? "";

  const utils = trpc.useUtils();
  const detailQuery = trpc.shows.detail.useQuery(
    { showId },
    { enabled: Boolean(showId) },
  );

  const updateState = trpc.shows.updateState.useMutation({
    onSuccess: () => {
      utils.shows.detail.invalidate({ showId });
      utils.shows.invalidate();
    },
  });

  const deleteShow = trpc.shows.delete.useMutation({
    onSuccess: () => {
      utils.shows.invalidate();
      router.push("/shows");
    },
  });

  if (detailQuery.isLoading) {
    return <CenteredMessage>Loading show…</CenteredMessage>;
  }

  if (detailQuery.error || !detailQuery.data) {
    return (
      <CenteredMessage tone="error">
        Couldn&apos;t load show.{" "}
        <button
          type="button"
          onClick={() => router.push("/shows")}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
            padding: 0,
            marginLeft: 8,
          }}
        >
          back to shows →
        </button>
      </CenteredMessage>
    );
  }

  const show = detailQuery.data;
  const KindIcon = KIND_ICONS[show.kind as ShowKind];
  const days = daysUntil(show.date);
  const countdown =
    show.state !== "past" && days > 0
      ? `in ${days} day${days !== 1 ? "s" : ""}`
      : null;
  const transition = STATE_TRANSITIONS[show.state];

  const headlinerSP =
    show.showPerformers.find(
      (sp) => sp.role === "headliner" && sp.sortOrder === 0,
    ) ?? show.showPerformers.find((sp) => sp.role === "headliner");
  const isTheatre = show.kind === "theatre" || show.kind === "festival";
  const titleText = isTheatre && show.productionName
    ? show.productionName
    : (headlinerSP?.performer.name ?? "Unknown");

  const lineup = [...show.showPerformers].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const mediaLineup = lineup.map((sp) => ({
    id: sp.performer.id,
    name: sp.performer.name,
  }));

  async function handleStateTransition() {
    if (!transition) return;
    await updateState.mutateAsync({
      showId: show.id,
      newState: transition.target,
    });
  }

  async function handleDelete() {
    if (!confirm("Delete this show? This cannot be undone.")) return;
    await deleteShow.mutateAsync({ showId: show.id });
  }

  // Build effective setlists: prefer new per-performer map; fall back to
  // legacy setlist array placed under the headliner key for old rows.
  const setlistsMap: Record<string, string[]> = (() => {
    const raw = show.setlists as Record<string, string[]> | null | undefined;
    if (raw && Object.keys(raw).length > 0) return raw;
    if (show.setlist && show.setlist.length > 0 && headlinerSP) {
      return { [headlinerSP.performer.id]: show.setlist };
    }
    return {};
  })();

  const setlistPerformerIds = Object.keys(setlistsMap);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Breadcrumb */}
      <div
        style={{
          padding: "14px 36px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: ".04em",
        }}
      >
        <Link
          href="/shows"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <ChevronLeft size={12} /> shows
        </Link>
        <span style={{ color: "var(--faint)" }}>/</span>
        <span style={{ color: "var(--ink)" }}>
          {titleText.toLowerCase()} @ {show.venue.name.toLowerCase()} · {show.date}
        </span>
      </div>

      {/* Hero */}
      <div
        style={{
          padding: "28px 36px 24px",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          columnGap: 32,
          alignItems: "end",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <KindIcon size={12} /> {KIND_LABELS[show.kind as ShowKind]}
          </div>
          <h1
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 44,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: -1.4,
              lineHeight: 1.0,
              marginTop: 10,
              marginBottom: 0,
            }}
          >
            {!isTheatre && headlinerSP ? (
              <Link
                href={`/artists/${headlinerSP.performer.id}`}
                style={{ color: "inherit", textDecoration: "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
              >
                {titleText}
              </Link>
            ) : (
              titleText
            )}
          </h1>
          <div
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 14,
              color: "var(--muted)",
              marginTop: 10,
              letterSpacing: -0.1,
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>{formatDateRangeLong(show.date, show.endDate)}</span>
            {countdown && (
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--accent)",
                  letterSpacing: ".04em",
                }}
              >
                {countdown}
              </span>
            )}
            {show.tourName && (
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  letterSpacing: ".04em",
                }}
              >
                · {show.tourName}
              </span>
            )}
          </div>
        </div>

        {show.state !== "past" && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StateChip state={show.state as "ticketed" | "watching"} />
          </div>
        )}
      </div>

      {/* Date TBD banner for watching shows from a multi-night run */}
      {show.state === "watching" && !show.date && (
        <PickDateBanner showId={show.id} />
      )}

      {/* Stat strip */}
      <div
        style={{
          padding: "16px 36px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          columnGap: 28,
        }}
      >
        <Stat
          label="Venue"
          value={
            <Link
              href={`/venues/${show.venue.id}`}
              style={{
                color: "inherit",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.textDecoration = "underline")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.textDecoration = "none")
              }
            >
              <MapPin size={12} /> {show.venue.name}
            </Link>
          }
        />
        <Stat label="Seat" value={show.seat ?? "—"} />
        <Stat
          label={show.ticketCount > 1 ? `Paid (×${show.ticketCount})` : "Paid"}
          value={
            show.pricePaid
              ? show.ticketCount > 1
                ? `$${parseFloat(show.pricePaid).toFixed(0)} · $${(
                    parseFloat(show.pricePaid) / show.ticketCount
                  ).toFixed(0)}/ea`
                : `$${parseFloat(show.pricePaid).toFixed(0)}`
              : "—"
          }
        />
        <Stat
          label="State"
          value={
            show.state === "past"
              ? "Attended"
              : show.state === "ticketed"
                ? "Have tickets"
                : "Watching"
          }
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          padding: "24px 36px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <MediaSection
          scope="show"
          showId={show.id}
          lineup={mediaLineup}
        />

        {/* Lineup */}
        {lineup.length > 0 && (
          <section>
            <SectionHeader label={`Lineup · ${lineup.length}`} />
            <div style={{ background: "var(--surface)" }}>
              {lineup.map((sp) => (
                <div
                  key={`${sp.performer.id}-${sp.role}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "100px 1fr 1fr",
                    columnGap: 16,
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--rule)",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 10,
                      color: "var(--faint)",
                      letterSpacing: ".1em",
                      textTransform: "uppercase",
                    }}
                  >
                    {ROLE_LABEL[sp.role] ?? sp.role}
                  </div>
                  <Link
                    href={`/artists/${sp.performer.id}`}
                    style={{
                      fontFamily: "var(--font-geist-sans), sans-serif",
                      fontSize: 15,
                      fontWeight: 500,
                      color: "var(--ink)",
                      letterSpacing: -0.2,
                      textDecoration: "none",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.textDecoration = "underline")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.textDecoration = "none")
                    }
                  >
                    {sp.performer.name}
                  </Link>
                  <div
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: "var(--muted)",
                      letterSpacing: ".02em",
                    }}
                  >
                    {sp.characterName ? `as ${sp.characterName}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Setlist — per-performer */}
        {setlistPerformerIds.length > 0 && (
          <SetlistSection
            setlistsMap={setlistsMap}
            lineup={lineup}
            headlinerPerformerId={headlinerSP?.performer.id ?? null}
          />
        )}

        {/* Notes */}
        {show.notes && show.notes.trim().length > 0 && (
          <section data-testid="notes-section">
            <SectionHeader label="Notes" />
            <div
              data-testid="notes-content"
              style={{
                fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
                fontSize: 14,
                lineHeight: 1.55,
                color: "var(--ink)",
                whiteSpace: "pre-wrap",
                background: "var(--surface)",
                borderLeft: "3px solid var(--rule)",
                padding: "12px 16px",
              }}
            >
              {show.notes}
            </div>
          </section>
        )}

        {/* Actions */}
        <section>
          <SectionHeader label="Actions" />
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            {show.state === "watching" && (
              <button
                onClick={handleStateTransition}
                style={{
                  padding: "9px 16px",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  border: "none",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                <Ticket size={14} /> Buy tickets
              </button>
            )}
            {transition && show.state === "ticketed" && (
              <button
                onClick={handleStateTransition}
                style={{
                  padding: "9px 16px",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  border: "none",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {transition.label}
              </button>
            )}
            <button
              onClick={() => router.push(`/add?editId=${show.id}`)}
              style={{
                padding: "9px 16px",
                background: "transparent",
                border: "1px solid var(--rule-strong)",
                color: "var(--ink)",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <MoreHorizontal size={14} /> Edit
            </button>
            <a
              href={`/api/shows/${show.id}/ical`}
              download
              data-testid="add-to-calendar"
              style={{
                padding: "9px 16px",
                background: "transparent",
                border: "1px solid var(--rule-strong)",
                color: "var(--ink)",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
                textDecoration: "none",
              }}
            >
              <CalendarPlus size={14} /> Add to calendar
            </a>
            <button
              onClick={handleDelete}
              style={{
                padding: "9px 16px",
                background: "transparent",
                border: "1px solid var(--rule-strong)",
                color: "#E63946",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                cursor: "pointer",
              }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 9.5,
          color: "var(--faint)",
          letterSpacing: ".12em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink)",
          letterSpacing: -0.2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function SectionHeader({ label, note }: { label: string; note?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 12,
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
        {label}
      </div>
      {note && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
            letterSpacing: ".04em",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

function CenteredMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 300,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: tone === "error" ? "var(--kind-theatre)" : "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}

// ── Per-performer setlist section ────────────────────────────────────────

type ShowPerformerEntry = {
  performer: { id: string; name: string };
  role: string;
  sortOrder: number;
};

function SetlistSection({
  setlistsMap,
  lineup,
  headlinerPerformerId,
}: {
  setlistsMap: Record<string, string[]>;
  lineup: ShowPerformerEntry[];
  headlinerPerformerId: string | null;
}) {
  const performerIds = Object.keys(setlistsMap);

  const defaultId =
    (headlinerPerformerId && performerIds.includes(headlinerPerformerId)
      ? headlinerPerformerId
      : null) ?? performerIds[0] ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(defaultId);

  const activeSongs = selectedId ? (setlistsMap[selectedId] ?? []) : [];

  const labelFor = (id: string) => {
    const sp = lineup.find((p) => p.performer.id === id);
    return sp?.performer.name ?? id;
  };

  return (
    <section data-testid="setlist-section">
      <SectionHeader label={`Setlist · ${activeSongs.length} song${activeSongs.length !== 1 ? "s" : ""}`} />
      {/* Artist picker — only shown when multiple performers have setlists */}
      {performerIds.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 0,
            marginBottom: 12,
            border: "1px solid var(--rule-strong)",
            width: "fit-content",
          }}
        >
          {performerIds.map((id, i) => (
            <button
              key={id}
              type="button"
              data-testid={`setlist-tab-${labelFor(id).replace(/\s+/g, "-").toLowerCase()}`}
              onClick={() => setSelectedId(id)}
              style={{
                padding: "7px 14px",
                background: selectedId === id ? "var(--ink)" : "transparent",
                color: selectedId === id ? "var(--bg)" : "var(--muted)",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                letterSpacing: ".04em",
                fontWeight: 500,
                border: "none",
                borderLeft: i === 0 ? "none" : "1px solid var(--rule-strong)",
                cursor: "pointer",
              }}
            >
              {labelFor(id)}
            </button>
          ))}
        </div>
      )}
      <ol
        style={{
          background: "var(--surface)",
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
      >
        {activeSongs.map((song, i) => (
          <li
            key={`${i}-${song}`}
            style={{
              display: "grid",
              gridTemplateColumns: "48px 1fr",
              columnGap: 12,
              padding: "10px 16px",
              borderBottom: "1px solid var(--rule)",
              alignItems: "baseline",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--faint)",
                letterSpacing: ".04em",
                fontFeatureSettings: '"tnum"',
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 14,
                color: "var(--ink)",
                letterSpacing: -0.1,
              }}
            >
              {song}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── Pick-a-date banner for watching shows from a multi-night run ─────────

function PickDateBanner({ showId }: { showId: string }) {
  const utils = trpc.useUtils();
  const linkQuery = trpc.shows.announcementLink.useQuery(
    { showId },
    { enabled: Boolean(showId) },
  );
  const pickDate = trpc.discover.pickDate.useMutation({
    onSuccess: () => {
      utils.shows.detail.invalidate({ showId });
      utils.shows.invalidate();
    },
  });

  const dates = linkQuery.data?.performanceDates ?? null;

  return (
    <div
      style={{
        margin: '12px 36px 0',
        padding: '14px 18px',
        background: 'var(--surface)',
        border: '1px solid var(--accent)',
        fontFamily: 'var(--font-geist-sans), sans-serif',
        fontSize: 13,
        color: 'var(--ink)',
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <strong>Date TBD.</strong> You&apos;re watching this run without a specific
        performance picked yet.
      </div>
      {dates && dates.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {dates.map((d) => (
            <button
              key={d}
              type='button'
              onClick={() => pickDate.mutate({ showId, performanceDate: d })}
              disabled={pickDate.isPending}
              style={{
                fontFamily: 'var(--font-geist-mono), monospace',
                fontSize: 11,
                padding: '4px 8px',
                border: '1px solid var(--rule)',
                background: 'var(--surface2)',
                color: 'var(--ink)',
                cursor: pickDate.isPending ? 'default' : 'pointer',
              }}
            >
              {d}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          No specific performance dates available — pick one when you decide.
        </div>
      )}
    </div>
  );
}
