"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search as SearchIcon,
  X,
  Music,
  MapPin,
  User,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { KIND_ICONS } from "@/lib/kind-icons";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import "./GlobalSearch.css";

type FlatItem = { href: string };

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return "Date TBD";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}


export function GlobalSearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="global-search__trigger"
      aria-label="Search"
      data-testid="global-search-trigger"
    >
      <SearchIcon size={13} />
      <span className="global-search__trigger-label">Search</span>
      <span className="global-search__trigger-kbd">⌘K</span>
    </button>
  );
}

let openGlobalSearchFn: (() => void) | null = null;
export function openGlobalSearch() { openGlobalSearchFn?.(); }

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    openGlobalSearchFn = () => setOpen(true);
    return () => { openGlobalSearchFn = null; };
  }, []);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebouncedValue(query.trim(), 200);

  const { data, isFetching } = trpc.search.global.useQuery(
    { query: debouncedQuery },
    { enabled: open && debouncedQuery.length >= 2 },
  );

  const flatItems = useMemo<FlatItem[]>(() => {
    if (!data) return [];
    return [
      ...data.shows.map((s) => ({ href: `/shows/${s.id}` })),
      ...data.performers.map((p) => ({ href: `/artists/${p.id}` })),
      ...data.venues.map((v) => ({ href: `/venues/${v.id}` })),
    ];
  }, [data]);

  const closeAndReset = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      router.push(href);
      closeAndReset();
    },
    [router, closeAndReset],
  );

  // Global keyboard shortcut: ⌘K / Ctrl-K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setActiveIndex(0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input on open
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Reset highlight when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [flatItems.length]);

  // Modal-level keyboard nav
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAndReset();
        return;
      }
      if (flatItems.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % flatItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
      } else if (e.key === "Enter") {
        const item = flatItems[activeIndex];
        if (item) {
          e.preventDefault();
          navigate(item.href);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, flatItems, activeIndex, navigate, closeAndReset]);

  if (!open) {
    return <GlobalSearchTrigger onClick={() => setOpen(true)} />;
  }

  const showsList = data?.shows ?? [];
  const performersList = data?.performers ?? [];
  const venuesList = data?.venues ?? [];

  let runningIndex = 0;
  const showsStart = runningIndex;
  runningIndex += showsList.length;
  const performersStart = runningIndex;
  runningIndex += performersList.length;
  const venuesStart = runningIndex;

  return (
    <>
      <GlobalSearchTrigger onClick={() => setOpen(true)} />
      <div
        className="global-search__overlay"
        role="dialog"
        aria-modal="true"
        onClick={closeAndReset}
      >
        <div
          className="global-search__panel"
          onClick={(e) => e.stopPropagation()}
          data-testid="global-search-panel"
        >
          <div className="global-search__input-row">
            <SearchIcon size={14} className="global-search__input-icon" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shows, artists, venues…"
              className="global-search__input"
              data-testid="global-search-input"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={closeAndReset}
              className="global-search__close"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <div className="global-search__body">
            {debouncedQuery.length < 2 ? (
              <div className="global-search__empty">
                Type at least 2 characters to search
              </div>
            ) : isFetching && !data ? (
              <div className="global-search__empty">Searching…</div>
            ) : flatItems.length === 0 ? (
              <div className="global-search__empty">No matches</div>
            ) : (
              <div className="global-search__results">
                {showsList.length > 0 && (
                  <Section title="Shows">
                    {showsList.map((s, i) => {
                      const idx = showsStart + i;
                      const Kind = KIND_ICONS[s.kind as keyof typeof KIND_ICONS] ?? Music;
                      return (
                        <Row
                          key={s.id}
                          active={idx === activeIndex}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => navigate(`/shows/${s.id}`)}
                          icon={<Kind size={13} />}
                          primary={s.title}
                          secondary={`${s.venueName}${s.venueCity ? ` · ${s.venueCity}` : ""}`}
                          meta={formatShortDate(s.date)}
                          dataTestId="global-search-result-show"
                        />
                      );
                    })}
                  </Section>
                )}
                {performersList.length > 0 && (
                  <Section title="Artists">
                    {performersList.map((p, i) => {
                      const idx = performersStart + i;
                      return (
                        <Row
                          key={p.id}
                          active={idx === activeIndex}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => navigate(`/artists/${p.id}`)}
                          icon={<User size={13} />}
                          primary={p.name}
                          secondary={`${p.showCount} show${p.showCount !== 1 ? "s" : ""}`}
                          dataTestId="global-search-result-performer"
                        />
                      );
                    })}
                  </Section>
                )}
                {venuesList.length > 0 && (
                  <Section title="Venues">
                    {venuesList.map((v, i) => {
                      const idx = venuesStart + i;
                      return (
                        <Row
                          key={v.id}
                          active={idx === activeIndex}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => navigate(`/venues/${v.id}`)}
                          icon={<MapPin size={13} />}
                          primary={v.name}
                          secondary={`${v.city ?? ""}${v.showCount > 0 ? ` · ${v.showCount} show${v.showCount !== 1 ? "s" : ""}` : ""}`}
                          dataTestId="global-search-result-venue"
                        />
                      );
                    })}
                  </Section>
                )}
              </div>
            )}
          </div>

          <div className="global-search__footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="global-search__section">
      <div className="global-search__section-title">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  active,
  onClick,
  onMouseEnter,
  icon,
  primary,
  secondary,
  meta,
  dataTestId,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  icon: React.ReactNode;
  primary: string;
  secondary: string;
  meta?: string;
  dataTestId?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active && ref.current) {
      ref.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`global-search__row ${active ? "global-search__row--active" : ""}`}
      data-testid={dataTestId}
    >
      <span className="global-search__row-icon">{icon}</span>
      <span className="global-search__row-text">
        <span className="global-search__row-primary">{primary}</span>
        <span className="global-search__row-secondary">{secondary}</span>
      </span>
      {meta && <span className="global-search__row-meta">{meta}</span>}
    </button>
  );
}
