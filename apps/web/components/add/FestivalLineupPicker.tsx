"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import type {
  FestivalArtistTier,
  FestivalLineupFlow,
  FestivalLineupRow,
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
  const trimmed = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!trimmed) return flow.rows;
    return flow.rows.filter((r) => r.name.toLowerCase().includes(trimmed));
  }, [flow.rows, trimmed]);

  const isSubmitting = flow.phase === "submitting";

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
          <button
            type="button"
            onClick={flow.toggleAll}
            style={selectAllStyle}
          >
            {flow.selected.size === flow.rows.length
              ? "Deselect all"
              : "Select all"}
          </button>
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
            key={row.name}
            row={row}
            checked={flow.selected.has(row.name)}
            tier={flow.tierFor(row)}
            onToggle={() => flow.toggle(row.name)}
            onSetTier={(t) => flow.setTier(row.name, t)}
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
}: {
  row: FestivalLineupRow;
  checked: boolean;
  tier: FestivalArtistTier;
  onToggle: () => void;
  onSetTier: (tier: FestivalArtistTier) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 20px",
        borderBottom: "1px solid var(--rule)",
        cursor: "pointer",
        opacity: checked ? 1 : 0.55,
        transition: "background 0.12s",
      }}
      onClick={onToggle}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
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
      <TierToggle
        tier={tier}
        disabled={!checked}
        onChange={(t) => {
          // Don't propagate to the row's onToggle.
          onSetTier(t);
        }}
      />
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
  transition: "opacity 0.12s",
  whiteSpace: "nowrap",
};
