"use client";

import { useParams, useRouter, } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  MapPin,
  MoreHorizontal,
  Trash2,
  Ticket,
  ChevronLeft,
  CalendarPlus,
  Pencil,
  Plus,
  X,
  Check,
} from "lucide-react";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import {
  CenteredMessage,
  SectionHeader,
  StateChip,
  type ShowKind,
} from "@/components/design-system";
import { MediaSection } from "@/components/media";
import {
  daysUntil,
  formatDateRangeLong,
  isDatePast,
  normalizePerformerSetlistsMap,
  setlistTotalSongs,
  singleMainSet,
  type PerformerSetlist,
  type PerformerSetlistsMap,
} from "@showbook/shared";
import { STATE_TRANSITIONS } from "@/lib/show-state";
import { SetlistSectionsEditor } from "@/components/SetlistSectionsEditor";


const ROLE_LABEL: Record<string, string> = {
  headliner: "Headliner",
  support: "Support",
  cast: "Cast",
};

const ROLE_OPTIONS: Array<{ value: "headliner" | "support" | "cast"; label: string }> = [
  { value: "support", label: "Support" },
  { value: "headliner", label: "Headliner" },
  { value: "cast", label: "Cast" },
];

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
      // After delete, route to the bucket the show used to live in so
      // the user lands somewhere sensible. Past → /logbook; everything
      // else → /upcoming.
      const fallback = detailQuery.data?.state === "past" ? "/logbook" : "/upcoming";
      router.push(fallback);
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
          onClick={() => router.push("/logbook")}
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
  const lastDay = show.endDate ?? show.date;
  const showIsPast = Boolean(lastDay && isDatePast(lastDay));
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

  // Build effective setlists: prefer the new per-performer map; fall back to
  // the legacy `setlist text[]` placed under the headliner key for old rows.
  // `normalizePerformerSetlistsMap` handles both new (sections) and legacy
  // (string[]) per-performer values, so reads tolerate un-migrated rows.
  const setlistsMap: PerformerSetlistsMap = (() => {
    const raw = show.setlists;
    const fromMap = normalizePerformerSetlistsMap(raw);
    if (Object.keys(fromMap).length > 0) return fromMap;
    if (show.setlist && show.setlist.length > 0 && headlinerSP) {
      return { [headlinerSP.performer.id]: singleMainSet(show.setlist) };
    }
    return {};
  })();

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
          href={show.state === "past" ? "/logbook" : "/upcoming"}
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
              fontFamily: "var(--font-display)",
              fontSize: 44,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
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
          canUpload={showIsPast}
        />

        {/* Lineup — editable */}
        <LineupSection showId={show.id} lineup={lineup} />

        {/* Setlist — per-performer, editable */}
        {lineup.length > 0 && (
          <SetlistSection
            showId={show.id}
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
              data-testid="action-edit-show"
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
              <MoreHorizontal size={14} /> Edit show
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


// ── Editable section header ──────────────────────────────────────────────

function EditableSectionHeader({
  label,
  isEditing,
  onToggle,
  editLabel = "Edit",
  testId,
}: {
  label: string;
  isEditing: boolean;
  onToggle: () => void;
  editLabel?: string;
  testId?: string;
}) {
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
      <button
        type="button"
        onClick={onToggle}
        data-testid={testId}
        style={{
          padding: "4px 10px",
          background: "transparent",
          border: "1px solid var(--rule-strong)",
          color: "var(--muted)",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10,
          letterSpacing: ".06em",
          textTransform: "uppercase",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        {isEditing ? (
          <>
            <Check size={11} /> Done
          </>
        ) : (
          <>
            <Pencil size={11} /> {editLabel}
          </>
        )}
      </button>
    </div>
  );
}

// ── Lineup section (with inline editing) ─────────────────────────────────

type ShowPerformerEntry = {
  performer: { id: string; name: string };
  role: string;
  sortOrder: number;
  characterName?: string | null;
};

function LineupSection({
  showId,
  lineup,
}: {
  showId: string;
  lineup: ShowPerformerEntry[];
}) {
  const [editing, setEditing] = useState(false);
  const utils = trpc.useUtils();

  const removePerformer = trpc.shows.removePerformer.useMutation({
    onSuccess: () => {
      utils.shows.detail.invalidate({ showId });
      utils.shows.invalidate();
    },
  });

  async function handleRemove(performerId: string, role: string) {
    await removePerformer.mutateAsync({
      showId,
      performerId,
      role: role as "headliner" | "support" | "cast",
    });
  }

  if (lineup.length === 0 && !editing) {
    return (
      <section data-testid="lineup-section">
        <EditableSectionHeader
          label="Lineup · 0"
          isEditing={editing}
          onToggle={() => setEditing(true)}
          editLabel="Add"
          testId="lineup-edit-toggle"
        />
      </section>
    );
  }

  return (
    <section data-testid="lineup-section">
      <EditableSectionHeader
        label={`Lineup · ${lineup.length}`}
        isEditing={editing}
        onToggle={() => setEditing((v) => !v)}
        testId="lineup-edit-toggle"
      />
      <div style={{ background: "var(--surface)" }}>
        {lineup.map((sp) => (
          <div
            key={`${sp.performer.id}-${sp.role}`}
            style={{
              display: "grid",
              gridTemplateColumns: editing
                ? "100px 1fr 1fr 32px"
                : "100px 1fr 1fr",
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
            {editing && (
              <button
                type="button"
                aria-label={`Remove ${sp.performer.name}`}
                data-testid={`lineup-remove-${sp.performer.id}`}
                onClick={() => handleRemove(sp.performer.id, sp.role)}
                disabled={removePerformer.isPending}
                style={{
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  color: "#E63946",
                  width: 28,
                  height: 28,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: removePerformer.isPending ? "default" : "pointer",
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
      {editing && <LineupAddForm showId={showId} />}
    </section>
  );
}

function LineupAddForm({ showId }: { showId: string }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [role, setRole] = useState<"headliner" | "support" | "cast">("support");
  const [characterName, setCharacterName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedName(name.trim()), 250);
    return () => clearTimeout(handle);
  }, [name]);

  const search = trpc.performers.search.useQuery(
    { query: debouncedName },
    { enabled: debouncedName.length >= 1 },
  );

  const addPerformer = trpc.shows.addPerformer.useMutation({
    onSuccess: () => {
      utils.shows.detail.invalidate({ showId });
      utils.shows.invalidate();
      setName("");
      setDebouncedName("");
      setCharacterName("");
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  async function submit(opts?: { name?: string }) {
    const finalName = (opts?.name ?? name).trim();
    if (!finalName) {
      setError("Name is required");
      return;
    }
    setError(null);
    await addPerformer.mutateAsync({
      showId,
      name: finalName,
      role,
      characterName: characterName.trim() || undefined,
    });
  }

  return (
    <div
      data-testid="lineup-add-form"
      style={{
        marginTop: 12,
        padding: "12px 16px",
        background: "var(--surface)",
        border: "1px dashed var(--rule-strong)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr 1fr auto",
          gap: 8,
          alignItems: "center",
        }}
      >
        <select
          value={role}
          onChange={(e) =>
            setRole(e.target.value as "headliner" | "support" | "cast")
          }
          data-testid="lineup-add-role"
          style={{
            padding: "6px 8px",
            background: "var(--bg)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            letterSpacing: ".04em",
          }}
        >
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Performer name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          data-testid="lineup-add-name"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          style={{
            padding: "6px 10px",
            background: "var(--bg)",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 13,
          }}
        />
        <input
          type="text"
          placeholder={role === "cast" ? "Character (optional)" : ""}
          value={characterName}
          onChange={(e) => setCharacterName(e.target.value)}
          data-testid="lineup-add-character"
          disabled={role !== "cast"}
          style={{
            padding: "6px 10px",
            background: role === "cast" ? "var(--bg)" : "transparent",
            border: "1px solid var(--rule)",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 13,
            opacity: role === "cast" ? 1 : 0.4,
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={addPerformer.isPending || !name.trim()}
          data-testid="lineup-add-submit"
          style={{
            padding: "7px 14px",
            background: "var(--accent)",
            color: "var(--accent-text)",
            border: "none",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12,
            fontWeight: 500,
            cursor:
              addPerformer.isPending || !name.trim() ? "default" : "pointer",
            opacity: addPerformer.isPending || !name.trim() ? 0.5 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Plus size={12} /> Add
        </button>
      </div>
      {/* Existing-performer suggestions: clicking commits the row using
          the matched performer's name (matchOrCreatePerformer dedupes by
          case-insensitive name, so passing the canonical name here keeps
          us from creating a near-duplicate). */}
      {debouncedName.length > 0 &&
        search.data &&
        search.data.length > 0 && (
          <div
            data-testid="lineup-add-suggestions"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                color: "var(--faint)",
                letterSpacing: ".06em",
                textTransform: "uppercase",
              }}
            >
              Existing:
            </span>
            {search.data.slice(0, 8).map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => {
                  setName(row.name);
                  setDebouncedName(row.name);
                  void submit({ name: row.name });
                }}
                style={{
                  padding: "3px 8px",
                  background: "var(--surface2)",
                  border: "1px solid var(--rule)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {row.name}
              </button>
            ))}
          </div>
        )}
      {error && (
        <div
          style={{
            color: "#E63946",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ── Per-performer setlist section ────────────────────────────────────────

function SetlistSection({
  showId,
  setlistsMap,
  lineup,
  headlinerPerformerId,
}: {
  showId: string;
  setlistsMap: PerformerSetlistsMap;
  lineup: ShowPerformerEntry[];
  headlinerPerformerId: string | null;
}) {
  const [editing, setEditing] = useState(false);

  // In view mode, only show tabs for performers who have a setlist. In
  // edit mode, expand to the full lineup so the user can add a setlist
  // for any artist on the show.
  const lineupIds = lineup.map((sp) => sp.performer.id);
  const populatedIds = Object.keys(setlistsMap).filter((id) =>
    lineupIds.includes(id),
  );
  const visibleIds = editing ? lineupIds : populatedIds;

  const defaultId =
    (headlinerPerformerId && visibleIds.includes(headlinerPerformerId)
      ? headlinerPerformerId
      : null) ?? visibleIds[0] ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(defaultId);

  // Keep the selected tab pointing at something that's actually in
  // `visibleIds` — when toggling edit mode the available tabs change,
  // and in view mode a selected-but-empty performer disappears.
  useEffect(() => {
    if (selectedId && visibleIds.includes(selectedId)) return;
    setSelectedId(visibleIds[0] ?? null);
  }, [selectedId, visibleIds]);

  if (!editing && populatedIds.length === 0) {
    return (
      <section data-testid="setlist-section">
        <EditableSectionHeader
          label="Setlist"
          isEditing={false}
          onToggle={() => setEditing(true)}
          editLabel="Add"
          testId="setlist-edit-toggle"
        />
      </section>
    );
  }

  const activeSetlist: PerformerSetlist =
    (selectedId && setlistsMap[selectedId]) || { sections: [] };
  const totalSongs = setlistTotalSongs(activeSetlist);

  const labelFor = (id: string) => {
    const sp = lineup.find((p) => p.performer.id === id);
    return sp?.performer.name ?? id;
  };

  return (
    <section data-testid="setlist-section">
      <EditableSectionHeader
        label={`Setlist · ${totalSongs} song${totalSongs !== 1 ? "s" : ""}`}
        isEditing={editing}
        onToggle={() => setEditing((v) => !v)}
        testId="setlist-edit-toggle"
      />
      {/* Artist picker */}
      {visibleIds.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 0,
            marginBottom: 12,
            border: "1px solid var(--rule-strong)",
            width: "fit-content",
            flexWrap: "wrap",
          }}
        >
          {visibleIds.map((id, i) => (
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
      {editing && selectedId ? (
        <SetlistSectionsEditor
          key={selectedId}
          showId={showId}
          performerId={selectedId}
          performerName={labelFor(selectedId)}
          initialSetlist={activeSetlist}
        />
      ) : (
        <SetlistView setlist={activeSetlist} />
      )}
    </section>
  );
}

// Read-only sections renderer. Mirrors the mockup: numbered rows with
// optional dim subtitle for `note`, and an "ENCORE" pill divider above
// the encore section. Numbering runs continuously across sections.
function SetlistView({ setlist }: { setlist: PerformerSetlist }) {
  if (setlist.sections.length === 0) return null;
  let counter = 0;
  return (
    <div
      style={{
        background: "var(--surface)",
        margin: 0,
        padding: 0,
      }}
    >
      {setlist.sections.map((section, sIdx) => {
        const isEncore = section.kind === "encore";
        return (
          <div
            key={`${section.kind}-${sIdx}`}
            data-testid={
              isEncore ? "setlist-section-encore" : "setlist-section-main"
            }
          >
            {isEncore && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "10px 0",
                }}
                data-testid="setlist-encore-marker"
              >
                <span
                  style={{
                    background: "var(--surface2)",
                    color: "var(--accent)",
                    padding: "3px 12px",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10,
                    letterSpacing: ".1em",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    borderRadius: 999,
                    border: "1px solid var(--accent)",
                  }}
                >
                  Encore
                </span>
              </div>
            )}
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {section.songs.map((song, i) => {
                counter += 1;
                return (
                  <li
                    key={`${sIdx}-${i}-${song.title}`}
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
                      {String(counter).padStart(2, "0")}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span
                        style={{
                          fontFamily: "var(--font-geist-sans), sans-serif",
                          fontSize: 14,
                          color: "var(--ink)",
                          letterSpacing: -0.1,
                          fontWeight: 500,
                        }}
                      >
                        {song.title}
                      </span>
                      {song.note && (
                        <span
                          style={{
                            fontFamily: "var(--font-geist-sans), sans-serif",
                            fontSize: 12,
                            color: "var(--muted)",
                          }}
                        >
                          {song.note}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
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
