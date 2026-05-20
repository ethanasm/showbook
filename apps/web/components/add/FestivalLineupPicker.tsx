"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, GripVertical, Pencil, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type {
  FestivalArtistTier,
  FestivalLineupFlow,
  FestivalLineupRow,
  FestivalLineupTmMatch,
} from "./useFestivalLineup";

const mono = "var(--font-geist-mono)";

interface FestivalLineupPickerProps {
  flow: FestivalLineupFlow;
  /** Footer button label. Form mode says "Add to show"; chat mode says "Save festival". */
  submitLabel: string;
  /** Compact mode shrinks the list height — used inside the modal. */
  compact?: boolean;
}

export function FestivalLineupPicker({
  flow,
  submitLabel,
  compact,
}: FestivalLineupPickerProps) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!trimmed) return flow.rows;
    return flow.rows.filter((r) => r.name.toLowerCase().includes(trimmed));
  }, [flow.rows, trimmed]);

  const isSubmitting = flow.phase === "submitting";
  const filtering = trimmed.length > 0;

  // Native HTML5 drag-and-drop state. We only enable drag when no filter
  // is active — reordering a filtered list to a hidden position would
  // confuse users.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const fromIdx = flow.rows.findIndex((r) => r.id === dragId);
    const toIdx = flow.rows.findIndex((r) => r.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null);
      setDragOverId(null);
      return;
    }
    const next = flow.rows.slice();
    const [moved] = next.splice(fromIdx, 1);
    if (moved) next.splice(toIdx, 0, moved);
    flow.reorder(next);
    setDragId(null);
    setDragOverId(null);
  };

  return (
    <>
      {/* Search */}
      <div style={searchRowStyle}>
        <Search size={13} color="var(--muted)" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter artists..."
          style={searchInputStyle}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            style={clearSearchStyle}
            aria-label="Clear filter"
          >
            Clear
          </button>
        )}
      </div>

      {/* Stats bar */}
      <div style={statsBarStyle}>
        <div style={statsInnerStyle}>
          <Stat value={flow.counts.headliners} label="headliners" emphasize />
          <Sep />
          <Stat value={flow.counts.support} label="support" />
          <Sep />
          <Stat
            value={flow.counts.unselected}
            label="not selected"
            color="var(--faint)"
          />
          {flow.isMatching && (
            <>
              <Sep />
              <span style={{ color: "var(--faint)" }}>matching…</span>
            </>
          )}
        </div>
        {flow.rows.length > 0 && (
          <div style={bulkActionsStyle}>
            {flow.selected.size < flow.rows.length && (
              <button
                type="button"
                onClick={flow.selectAll}
                style={selectAllStyle}
                aria-label="Select all artists"
              >
                Select all
              </button>
            )}
            {flow.selected.size > 0 &&
              flow.selected.size < flow.rows.length && (
                <span style={{ color: "var(--faint)" }}>·</span>
              )}
            {flow.selected.size > 0 && (
              <button
                type="button"
                onClick={flow.deselectAll}
                style={selectAllStyle}
                aria-label="Deselect all artists"
              >
                Deselect all
              </button>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          maxHeight: compact ? 360 : 440,
          overflow: "auto",
          minHeight: 0,
        }}
      >
        {filtered.length === 0 && (
          <div style={emptyStyle}>
            {trimmed
              ? "No artists match your filter."
              : "Couldn't read a lineup. Try another file or add artists manually."}
          </div>
        )}
        {filtered.map((row) => (
          <LineupRow
            key={row.id}
            row={row}
            checked={flow.selected.has(row.id)}
            tier={flow.tierFor(row)}
            onToggle={() => flow.toggle(row.id)}
            onSetTier={(t) => flow.setTier(row.id, t)}
            editing={editingId === row.id}
            onStartEdit={() => setEditingId(row.id)}
            onCancelEdit={() => setEditingId(null)}
            onPickArtist={(name, tmMatch) => {
              flow.setRowName(row.id, name, tmMatch ?? null);
              setEditingId(null);
            }}
            draggable={!filtering}
            isDragging={dragId === row.id}
            isDragTarget={dragOverId === row.id && dragId !== row.id}
            onDragStart={() => setDragId(row.id)}
            onDragEnd={() => {
              setDragId(null);
              setDragOverId(null);
            }}
            onDragOver={() => setDragOverId(row.id)}
            onDrop={() => handleDrop(row.id)}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={footerStyle}>
        <div
          style={{
            fontFamily: mono,
            fontSize: 11,
            color: flow.selected.size > 0 ? "var(--ink)" : "var(--muted)",
            letterSpacing: ".04em",
            fontWeight: flow.selected.size > 0 ? 500 : 400,
          }}
        >
          {flow.selected.size > 0 ? (
            <>
              <span style={{ color: "var(--accent)" }}>{flow.selected.size}</span>{" "}
              selected
            </>
          ) : (
            "None selected"
          )}
        </div>
        {flow.error && (
          <div style={errorTextStyle}>{flow.error}</div>
        )}
        <button
          type="button"
          onClick={flow.submit}
          disabled={flow.selected.size === 0 || isSubmitting}
          style={{
            ...submitButtonStyle,
            opacity: flow.selected.size === 0 || isSubmitting ? 0.4 : 1,
            cursor:
              flow.selected.size === 0 || isSubmitting
                ? "not-allowed"
                : "pointer",
          }}
        >
          {isSubmitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </>
  );
}

function LineupRow({
  row,
  checked,
  tier,
  onToggle,
  onSetTier,
  editing,
  onStartEdit,
  onCancelEdit,
  onPickArtist,
  draggable,
  isDragging,
  isDragTarget,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  row: FestivalLineupRow;
  checked: boolean;
  tier: FestivalArtistTier;
  onToggle: () => void;
  onSetTier: (tier: FestivalArtistTier) => void;
  editing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onPickArtist: (name: string, tmMatch: FestivalLineupTmMatch | null) => void;
  draggable: boolean;
  isDragging: boolean;
  isDragTarget: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      draggable={draggable && !editing}
      onDragStart={(e) => {
        // Required for Firefox to actually start the drag.
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (!draggable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDrop={(e) => {
        if (!draggable) return;
        e.preventDefault();
        onDrop();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "11px 20px",
        borderBottom: "1px solid var(--rule)",
        opacity: isDragging ? 0.4 : checked ? 1 : 0.55,
        background: isDragTarget ? "var(--surface2)" : "transparent",
        transition: "background 0.12s",
        cursor: editing ? "default" : "pointer",
      }}
      onClick={(e) => {
        // Don't toggle when interacting with the edit panel.
        if (editing) return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-no-toggle="1"]')) return;
        onToggle();
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {draggable ? (
          <span
            data-no-toggle="1"
            style={{
              display: "inline-flex",
              alignItems: "center",
              color: "var(--faint)",
              cursor: "grab",
              userSelect: "none",
            }}
            aria-label="Drag to reorder"
            title="Drag to reorder"
          >
            <GripVertical size={14} />
          </span>
        ) : (
          <span style={{ width: 14 }} />
        )}
        <Checkbox checked={checked} />
        {row.tmMatch?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.tmMatch.imageUrl}
            alt=""
            width={36}
            height={36}
            style={artistThumbStyle}
          />
        ) : (
          <div style={artistThumbPlaceholderStyle} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={artistNameStyle}>{row.name}</div>
          {row.tmMatch === null && (
            <div style={artistSubStyle}>no tm match</div>
          )}
        </div>
        <button
          type="button"
          data-no-toggle="1"
          onClick={(e) => {
            e.stopPropagation();
            if (editing) onCancelEdit();
            else onStartEdit();
          }}
          style={{
            background: "transparent",
            border: "1px solid var(--rule)",
            borderRadius: 4,
            color: "var(--muted)",
            cursor: "pointer",
            padding: "4px 6px",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            fontFamily: mono,
            fontSize: 9.5,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
          aria-label={editing ? "Cancel edit" : `Edit ${row.name}`}
          title={editing ? "Cancel edit" : "Edit name"}
        >
          <Pencil size={10} />
          {editing ? "Close" : "Edit"}
        </button>
        <TierToggle
          tier={tier}
          disabled={!checked}
          onChange={(t) => {
            // Don't propagate to the row's onToggle.
            onSetTier(t);
          }}
        />
      </div>
      {editing && (
        <div data-no-toggle="1" onClick={(e) => e.stopPropagation()}>
          <ArtistSearchInline
            initialQuery={row.name}
            onPick={onPickArtist}
            onCancel={onCancelEdit}
          />
        </div>
      )}
    </div>
  );
}

function ArtistSearchInline({
  initialQuery,
  onPick,
  onCancel,
}: {
  initialQuery: string;
  onPick: (name: string, tmMatch: FestivalLineupTmMatch | null) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const enabled = debounced.trim().length >= 2;
  const localQuery = trpc.performers.search.useQuery(
    { query: debounced },
    { enabled, staleTime: 60_000 },
  );
  const tmQuery = trpc.performers.searchExternal.useQuery(
    { query: debounced },
    { enabled, staleTime: 60_000 },
  );

  type Suggestion = {
    key: string;
    name: string;
    imageUrl: string | null;
    tmAttractionId: string | null;
    musicbrainzId: string | null;
    source: "local" | "tm";
  };
  const suggestions: Suggestion[] = useMemo(() => {
    if (!enabled) return [];
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const dedupKey = (name: string, tmId?: string | null) =>
      `${(tmId ?? "").toLowerCase()}|${name.toLowerCase()}`;
    for (const l of localQuery.data ?? []) {
      const key = dedupKey(l.name, l.ticketmasterAttractionId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `local:${l.id}`,
        name: l.name,
        imageUrl: l.imageUrl ?? null,
        tmAttractionId: l.ticketmasterAttractionId ?? null,
        musicbrainzId: l.musicbrainzId ?? null,
        source: "local",
      });
    }
    for (const t of tmQuery.data ?? []) {
      const key = dedupKey(t.name, t.tmAttractionId);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key: `tm:${t.tmAttractionId}`,
        name: t.name,
        imageUrl: t.imageUrl ?? null,
        tmAttractionId: t.tmAttractionId,
        musicbrainzId: t.musicbrainzId,
        source: "tm",
      });
    }
    return out.slice(0, 8);
  }, [enabled, localQuery.data, tmQuery.data]);

  const loading = localQuery.isFetching || tmQuery.isFetching;

  const pick = (s: Suggestion) => {
    const tmMatch: FestivalLineupTmMatch | null = s.tmAttractionId
      ? {
          tmAttractionId: s.tmAttractionId,
          name: s.name,
          imageUrl: s.imageUrl,
          musicbrainzId: s.musicbrainzId,
        }
      : null;
    onPick(s.name, tmMatch);
  };

  return (
    <div style={searchPanelStyle}>
      <div style={searchPanelInputRow}>
        <Search size={12} color="var(--muted)" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") {
              const first = suggestions[0];
              if (first) pick(first);
              else if (query.trim()) onPick(query.trim(), null);
            }
          }}
          placeholder="Search artist name…"
          style={searchPanelInput}
        />
        {query.trim().length > 0 && (
          <button
            type="button"
            onClick={() => onPick(query.trim(), null)}
            style={useTypedNameStyle}
            aria-label="Use typed name as-is"
            title="Use typed name as-is"
          >
            Use “{query.trim().length > 22 ? query.trim().slice(0, 22) + "…" : query.trim()}”
          </button>
        )}
      </div>
      <div style={searchResultsStyle}>
        {!enabled && (
          <div style={searchHintStyle}>Type at least 2 characters…</div>
        )}
        {enabled && loading && suggestions.length === 0 && (
          <div style={searchHintStyle}>Searching…</div>
        )}
        {enabled && !loading && suggestions.length === 0 && (
          <div style={searchHintStyle}>
            No matches. Press Enter to keep the typed name.
          </div>
        )}
        {suggestions.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => pick(s)}
            style={searchResultRow}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            {s.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.imageUrl}
                alt=""
                width={26}
                height={26}
                style={searchResultThumb}
              />
            ) : (
              <div style={searchResultThumbPlaceholder} />
            )}
            <span style={searchResultName}>{s.name}</span>
            <span style={searchResultSource}>
              {s.source === "tm" ? "TM" : "LIBRARY"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TierToggle({
  tier,
  disabled,
  onChange,
}: {
  tier: FestivalArtistTier;
  disabled?: boolean;
  onChange: (tier: FestivalArtistTier) => void;
}) {
  const opacity = disabled ? 0.4 : 1;
  return (
    <div
      data-no-toggle="1"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "inline-flex",
        border: "1px solid var(--rule-strong)",
        borderRadius: 4,
        overflow: "hidden",
        flexShrink: 0,
        opacity,
      }}
    >
      <TierButton
        active={tier === "headliner"}
        disabled={disabled}
        onClick={() => onChange("headliner")}
        label="Headliner"
      />
      <TierButton
        active={tier === "support"}
        disabled={disabled}
        onClick={() => onChange("support")}
        label="Support"
      />
    </div>
  );
}

function TierButton({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: mono,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: ".08em",
        textTransform: "uppercase",
        padding: "5px 8px",
        border: "none",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--accent-text)" : "var(--muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s, color 0.12s",
      }}
    >
      {label}
    </button>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 18,
        height: 18,
        border: "1.5px solid",
        borderColor: checked ? "var(--accent)" : "var(--rule-strong)",
        background: checked ? "var(--accent)" : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        borderRadius: 3,
        transition: "all 0.12s",
      }}
    >
      {checked && <Check size={12} color="var(--accent-text)" strokeWidth={3} />}
    </div>
  );
}

function Stat({
  value,
  label,
  emphasize,
  color,
}: {
  value: number;
  label: string;
  emphasize?: boolean;
  color?: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 5,
        color: color ?? "var(--ink)",
      }}
    >
      <span
        style={{
          fontWeight: emphasize ? 600 : 500,
          color: emphasize ? "var(--accent)" : (color ?? "var(--ink)"),
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </span>
      <span style={{ color: "var(--faint)" }}>{label}</span>
    </span>
  );
}

function Sep() {
  return <span style={{ color: "var(--faint)" }}>·</span>;
}

const searchRowStyle: React.CSSProperties = {
  padding: "10px 16px",
  display: "flex",
  alignItems: "center",
  gap: 8,
  borderBottom: "1px solid var(--rule)",
};
const searchInputStyle: React.CSSProperties = {
  flex: 1,
  border: "none",
  background: "transparent",
  color: "var(--ink)",
  fontFamily: "var(--font-geist-sans), sans-serif",
  fontSize: 13,
  outline: "none",
  letterSpacing: -0.1,
};
const clearSearchStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 500,
  color: "var(--muted)",
  background: "transparent",
  border: "none",
  padding: "2px 6px",
  cursor: "pointer",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  flexShrink: 0,
};
const statsBarStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderBottom: "1px solid var(--rule)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  background: "var(--surface2)",
};
const statsInnerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  fontFamily: mono,
  fontSize: 10.5,
  letterSpacing: ".04em",
  flexWrap: "wrap",
};
const bulkActionsStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  fontFamily: mono,
  fontSize: 10,
  letterSpacing: ".08em",
  flexShrink: 0,
};
const selectAllStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  fontWeight: 500,
  color: "var(--muted)",
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  flexShrink: 0,
  textDecoration: "underline",
  textDecorationColor: "var(--rule-strong)",
  textUnderlineOffset: 3,
};
const emptyStyle: React.CSSProperties = {
  padding: "32px 20px",
  textAlign: "center",
  fontFamily: mono,
  fontSize: 11,
  color: "var(--muted)",
  letterSpacing: ".04em",
};
const artistThumbStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  objectFit: "cover",
  flexShrink: 0,
  borderRadius: 4,
  border: "1px solid var(--rule)",
};
const artistThumbPlaceholderStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  background: "var(--surface2)",
  border: "1px solid var(--rule)",
  flexShrink: 0,
  borderRadius: 4,
};
const artistNameStyle: React.CSSProperties = {
  fontFamily: "var(--font-geist-sans)",
  fontSize: 14,
  fontWeight: 500,
  color: "var(--ink)",
  letterSpacing: -0.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const artistSubStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10,
  color: "var(--faint)",
  marginTop: 3,
  letterSpacing: ".04em",
  textTransform: "uppercase",
};
const footerStyle: React.CSSProperties = {
  padding: "14px 20px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  borderTop: "1px solid var(--rule)",
  background: "var(--surface)",
  flexShrink: 0,
};
const errorTextStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10.5,
  color: "#E63946",
  letterSpacing: ".04em",
  flex: 1,
  textAlign: "center",
};
const submitButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent-text)",
  background: "var(--accent)",
  border: "none",
  borderRadius: 0,
  padding: "9px 16px",
  letterSpacing: ".08em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const searchPanelStyle: React.CSSProperties = {
  marginLeft: 56,
  border: "1px solid var(--rule)",
  borderRadius: 6,
  background: "var(--surface)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};
const searchPanelInputRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  borderBottom: "1px solid var(--rule)",
};
const searchPanelInput: React.CSSProperties = {
  flex: 1,
  border: "none",
  background: "transparent",
  color: "var(--ink)",
  fontFamily: "var(--font-geist-sans)",
  fontSize: 13,
  outline: "none",
};
const useTypedNameStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 9.5,
  color: "var(--muted)",
  background: "transparent",
  border: "1px solid var(--rule)",
  borderRadius: 4,
  padding: "3px 6px",
  cursor: "pointer",
  letterSpacing: ".06em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};
const searchResultsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxHeight: 240,
  overflow: "auto",
};
const searchHintStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10.5,
  color: "var(--muted)",
  padding: "10px 12px",
  letterSpacing: ".04em",
};
const searchResultRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  border: "none",
  borderTop: "1px solid var(--rule)",
  background: "transparent",
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
};
const searchResultThumb: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 3,
  objectFit: "cover",
  border: "1px solid var(--rule)",
  flexShrink: 0,
};
const searchResultThumbPlaceholder: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 3,
  background: "var(--surface2)",
  border: "1px solid var(--rule)",
  flexShrink: 0,
};
const searchResultName: React.CSSProperties = {
  flex: 1,
  fontFamily: "var(--font-geist-sans)",
  fontSize: 13,
  color: "var(--ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const searchResultSource: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 9,
  color: "var(--faint)",
  letterSpacing: ".08em",
  flexShrink: 0,
};
