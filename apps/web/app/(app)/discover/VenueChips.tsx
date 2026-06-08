"use client";

/**
 * Mobile filter rail for the Discover feed — "All" plus one chip per
 * followed venue / artist / region with a per-group announcement count.
 *
 * Reworked from a horizontally-scrolling pill row into a "priority+"
 * rail: the chips that fit on one line render inline and the remainder
 * collapse behind a trailing "+N" dropdown that opens a popover picker.
 * Nothing scrolls off the right edge, and the active selection is
 * pinned to the front so it's always visible. Mirrors the mobile
 * `FilterChipsRow` component.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown } from "lucide-react";

export interface ChipOption {
  id: string;
  name: string;
  sublabel?: string;
  count: number;
  badgeText?: string;
}

/** Horizontal gap between inline chips — keep in sync with the
 *  `.discover-chips__row` gap so the fit math matches the layout. */
const CHIP_GAP = 6;

export function VenueChips({
  venues,
  selected,
  onSelect,
  totalCount,
  allLabel = "All",
  pickerTitle = "All filters",
  hideCounts = false,
}: {
  venues: ChipOption[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  totalCount: number;
  allLabel?: string;
  pickerTitle?: string;
  /** Suppress the numeric count / badge on every chip (and in the
   *  overflow picker). Mirrors the mobile `FilterChipsRow` prop so the
   *  Discover rail stays short and more followed-entity chips fit on one
   *  line. The `count` is still used for ordering and the fit math. */
  hideCounts?: boolean;
}) {
  // Pin the active selection to the front so it stays inline (and so a
  // pick from the dropdown surfaces without a horizontal hunt).
  const ordered = useMemo(() => {
    if (selected === null) return venues;
    const idx = venues.findIndex((v) => v.id === selected);
    if (idx <= 0) return venues;
    const copy = venues.slice();
    const [picked] = copy.splice(idx, 1);
    copy.unshift(picked);
    return copy;
  }, [venues, selected]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(ordered.length);
  const [menuOpen, setMenuOpen] = useState(false);

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;

    const cs = getComputedStyle(wrap);
    const avail =
      wrap.clientWidth -
      parseFloat(cs.paddingLeft || "0") -
      parseFloat(cs.paddingRight || "0");

    // Measured children order: [all, ...ordered, more].
    const kids = Array.from(measure.children) as HTMLElement[];
    const allW = kids[0]?.offsetWidth ?? 0;
    const optionW = ordered.map((_, i) => kids[i + 1]?.offsetWidth ?? 0);
    const moreW = kids[ordered.length + 1]?.offsetWidth ?? 0;

    const fixed = allW + CHIP_GAP;

    // Everything fits without a dropdown?
    const full =
      fixed + optionW.reduce((s, w) => s + w + CHIP_GAP, 0) - CHIP_GAP;
    if (full <= avail) {
      setVisibleCount(ordered.length);
      return;
    }

    let used = fixed + moreW + CHIP_GAP;
    let n = 0;
    for (let i = 0; i < ordered.length; i++) {
      const w = optionW[i] + CHIP_GAP;
      if (used + w - CHIP_GAP <= avail) {
        used += w;
        n++;
      } else {
        break;
      }
    }
    setVisibleCount(n);
  }, [ordered]);

  useLayoutEffect(() => {
    recompute();
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [recompute]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const inline = ordered.slice(0, visibleCount);
  const overflowCount = ordered.length - visibleCount;

  const renderChipBody = (label: string, sub: string | undefined, badge: string) => (
    <>
      <span>
        {label}
        {sub ? <span className="discover-chip__sub"> · {sub}</span> : null}
      </span>
      {!hideCounts && badge.length > 0 ? (
        <span className="discover-chip__count">{badge}</span>
      ) : null}
    </>
  );

  return (
    <div className="discover-chips" ref={wrapRef}>
      <div className="discover-chips__row">
        <button
          type="button"
          className={`discover-chip ${selected === null ? "discover-chip--active" : ""}`}
          onClick={() => onSelect(null)}
        >
          {renderChipBody(allLabel, undefined, String(totalCount))}
        </button>
        {inline.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`discover-chip ${selected === v.id ? "discover-chip--active" : ""}`}
            onClick={() => onSelect(selected === v.id ? null : v.id)}
          >
            {renderChipBody(
              v.name,
              v.sublabel,
              v.badgeText ?? String(v.count),
            )}
          </button>
        ))}
        {overflowCount > 0 ? (
          <button
            type="button"
            className="discover-chip discover-chip--more"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Show ${overflowCount} more ${overflowCount === 1 ? "filter" : "filters"}`}
            onClick={() => setMenuOpen((o) => !o)}
          >
            +{overflowCount}
            <ChevronDown size={13} strokeWidth={2.25} />
          </button>
        ) : null}
      </div>

      {/* Off-screen measuring row — one node per possible chip so we can
          decide what fits before painting the visible row. */}
      <div className="discover-chips__measure" ref={measureRef} aria-hidden>
        <span className="discover-chip">
          {renderChipBody(allLabel, undefined, String(totalCount))}
        </span>
        {ordered.map((v) => (
          <span key={v.id} className="discover-chip">
            {renderChipBody(v.name, v.sublabel, v.badgeText ?? String(v.count))}
          </span>
        ))}
        <span className="discover-chip discover-chip--more">
          +{ordered.length}
          <ChevronDown size={13} strokeWidth={2.25} />
        </span>
      </div>

      {menuOpen ? (
        <div className="discover-chips__menu" role="menu">
          <div className="discover-chips__menu-title">{pickerTitle}</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={selected === null}
            className={`discover-chips__menu-row ${selected === null ? "discover-chips__menu-row--active" : ""}`}
            onClick={() => {
              onSelect(null);
              setMenuOpen(false);
            }}
          >
            <span className="discover-chips__menu-check">
              {selected === null ? <Check size={15} strokeWidth={2.5} /> : null}
            </span>
            <span className="discover-chips__menu-label">{allLabel}</span>
            {hideCounts ? null : (
              <span className="discover-chips__menu-count">{totalCount}</span>
            )}
          </button>
          {venues.map((v) => (
            <button
              key={v.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected === v.id}
              className={`discover-chips__menu-row ${selected === v.id ? "discover-chips__menu-row--active" : ""}`}
              onClick={() => {
                onSelect(selected === v.id ? null : v.id);
                setMenuOpen(false);
              }}
            >
              <span className="discover-chips__menu-check">
                {selected === v.id ? <Check size={15} strokeWidth={2.5} /> : null}
              </span>
              <span className="discover-chips__menu-label">
                {v.name}
                {v.sublabel ? (
                  <span className="discover-chip__sub"> · {v.sublabel}</span>
                ) : null}
              </span>
              {hideCounts ? null : (
                <span className="discover-chips__menu-count">
                  {v.badgeText ?? v.count}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
