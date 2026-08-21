import { KIND_LABELS, type DiscoverKindKey } from "@/lib/kind-icons";

interface KindSwatchProps {
  kind: DiscoverKindKey;
  /**
   * Size of the label. 12.5px is the default (list rows, hero); 11.5px is
   * the compact variant used in tight table cells.
   */
  fontSize?: number;
  /** Extra text appended after the kind label, e.g. `· Ticketed`. */
  suffix?: string;
}

/**
 * Kind marker — a 5px square in the kind colour followed by the kind name
 * set in `--muted`.
 *
 * The kind used to be a coloured lucide icon plus the kind name set in the
 * same colour, which put four saturated hues into the text layer of every
 * list. The redesign keeps the colours as identity but demotes them to a
 * swatch, so the only coloured thing in a row is 5px square and the text
 * stays on the neutral ramp. Rows that need more emphasis (the hero card,
 * Discover rows) keep a 2–3px kind-coloured left border instead.
 */
export function KindSwatch({ kind, fontSize = 12.5, suffix }: KindSwatchProps) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontFamily: "var(--font-geist-sans), sans-serif",
        fontSize,
        color: "var(--muted)",
        minWidth: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 5,
          height: 5,
          flexShrink: 0,
          background: `var(--kind-${kind})`,
        }}
      />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {KIND_LABELS[kind]}
        {suffix ? ` ${suffix}` : ""}
      </span>
    </span>
  );
}
