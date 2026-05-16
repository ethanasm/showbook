"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  formatDateRangeLong,
  daysUntil,
  isDatePast,
  normalizePerformerSetlistsMap,
  setlistTotalSongs,
  type PerformerSetlistsMap,
} from "@showbook/shared";
import {
  getHeadliner,
  getHeadlinerId,
  isProductionShow,
  type ShowLike,
} from "@showbook/shared";
import { MediaSection } from "@/components/media";
import { ShowTabs } from "./ShowTabs";
import { OverviewTab, type OverviewLineupEntry } from "./OverviewTab";
import { SetlistTab, SetlistTabComingSoon, type ActualSong } from "./SetlistTab";
import { MediaTab } from "./MediaTab";
import { NotesTab } from "./NotesTab";
import { MusicLayerEmpty } from "./MusicLayerEmpty";
import { useTrackTabView } from "./use-track-tab-view";
import { computeShowTabBadges } from "./types";
import type { StatCell } from "./StatRow";

interface ShowDetailTabsViewProps {
  // The show payload is whatever `shows.detail` returns — typed loosely
  // because the page-level component pulls it via tRPC and we'd otherwise
  // duplicate the type chain. The `ShowLike` shape from
  // `@showbook/shared/show-accessors` covers the field set we read.
  show: ShowLike & {
    id: string;
    kind: "concert" | "theatre" | "comedy" | "festival" | "sports" | "film" | "unknown";
    state: "past" | "ticketed" | "watching";
    date: string | null;
    endDate: string | null;
    seat: string | null;
    pricePaid: string | null;
    ticketCount: number;
    tourName: string | null;
    productionName: string | null;
    setlist: string[] | null;
    setlists: unknown;
    coverImageUrl: string | null;
    notes: string | null;
    venue: { id: string; name: string; city: string };
    showPerformers: Array<{
      role: "headliner" | "support" | "cast";
      sortOrder: number;
      characterName?: string | null;
      performer: { id: string; name: string; imageUrl?: string | null };
    }>;
  };
}

/**
 * New 4-tab show detail (2026-05-16 redesign). Gated behind the
 * `SetlistIntelShowTabs` feature flag. Reads the same `shows.detail`
 * payload as the legacy page; deltas only in the inside-the-tabs
 * layout.
 */
export function ShowDetailTabsView({ show }: ShowDetailTabsViewProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const isPast = show.state === "past";

  // Predicted-setlist query. Eligibility gate lives server-side; the
  // procedure returns the cold empty state for non-concert/festival
  // shows automatically.
  const predictionQuery = trpc.setlistIntel.predictedSetlist.useQuery(
    { showId: show.id },
    {
      enabled: !isPast,
      staleTime: 1000 * 60 * 5,
    },
  );

  const setNotes = trpc.shows.setNotes.useMutation({
    onSuccess: () => {
      utils.shows.detail.invalidate({ showId: show.id });
    },
  });
  const updateState = trpc.shows.updateState.useMutation({
    onSuccess: () => {
      utils.shows.detail.invalidate({ showId: show.id });
    },
  });
  const deleteShow = trpc.shows.delete.useMutation({
    onSuccess: () => {
      router.push(isPast ? "/logbook" : "/upcoming");
    },
  });

  const setlistsMap: PerformerSetlistsMap = useMemo(() => {
    const map = normalizePerformerSetlistsMap(show.setlists);
    if (Object.keys(map).length > 0) return map;
    const headlinerId = getHeadlinerId(show);
    if (headlinerId && show.setlist && show.setlist.length > 0) {
      return {
        [headlinerId]: {
          sections: [
            { kind: "set", songs: show.setlist.map((title) => ({ title })) },
          ],
        },
      };
    }
    return {};
  }, [show]);

  const actualSongs: ActualSong[] = useMemo(() => {
    if (!isPast) return [];
    const headlinerId = getHeadlinerId(show);
    if (!headlinerId) return [];
    const headlinerSetlist = setlistsMap[headlinerId];
    if (!headlinerSetlist) return [];
    const out: ActualSong[] = [];
    headlinerSetlist.sections.forEach((section, sIdx) => {
      const isEncore = section.kind === "encore";
      section.songs.forEach((song, songIdx) => {
        out.push({
          title: song.title,
          sectionIndex: sIdx,
          songIndex: songIdx,
          isEncore,
          isOpenerOrCloser:
            (!isEncore && sIdx === 0 && songIdx === 0) ||
            (!isEncore && songIdx === section.songs.length - 1),
          note: song.note ?? null,
        });
      });
    });
    return out;
  }, [isPast, setlistsMap, show]);

  const actualSongCount = actualSongs.length;

  // Stat row cells. Order mirrors the design handoff: VENUE / SEAT /
  // (PAID | ON STAGE) / (DOORS | DROVE).
  const cells: StatCell[] = useMemo(() => {
    const venueLabel = show.venue.name;
    const venueSub = show.venue.city;
    const seatLabel = show.seat ?? "—";
    const seatSub = show.ticketCount > 1 ? `${show.ticketCount} tix` : "1 tix";
    const priceLabel = show.pricePaid
      ? `$${parseFloat(show.pricePaid).toFixed(0)}`
      : "—";
    const priceSub =
      show.pricePaid && show.ticketCount > 1
        ? `$${(parseFloat(show.pricePaid) / show.ticketCount).toFixed(0)}/ea`
        : "";
    const stateLabel = isPast
      ? "Attended"
      : show.state === "ticketed"
        ? "Have tickets"
        : "Watching";
    return [
      { label: "VENUE", value: venueLabel, sub: venueSub, href: `/venues/${show.venue.id}` },
      { label: "SEAT", value: seatLabel, sub: seatSub },
      { label: "PAID", value: priceLabel, sub: priceSub || undefined },
      { label: "STATE", value: stateLabel },
    ];
  }, [isPast, show]);

  const lineupEntries: OverviewLineupEntry[] = useMemo(() => {
    return [...show.showPerformers]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sp) => ({
        performerId: sp.performer.id,
        name: sp.performer.name,
        role: sp.role,
        characterName: sp.characterName ?? null,
        sortOrder: sp.sortOrder,
      }));
  }, [show.showPerformers]);

  const badges = useMemo(
    () =>
      computeShowTabBadges({
        isPast,
        // Only show a confidence badge for hot predictions. Cold state
        // carries `confidence: 0`, which the badge formula would
        // otherwise render as "0%" — a misleading value when we
        // really mean "no prediction available yet".
        predictionConfidence:
          predictionQuery.data && predictionQuery.data.style === "stable"
            ? predictionQuery.data.confidence
            : null,
        actualSongCount,
        mediaCount: 0, // photos query is owned by <MediaSection>; we don't double-fetch
        notesTrimmedLength: (show.notes ?? "").trim().length,
      }),
    [actualSongCount, isPast, predictionQuery.data, show.notes],
  );

  const headlinerName = getHeadliner(show);
  const trackTabView = useTrackTabView({ showId: show.id, isPast });

  const handleMarkAttended = useCallback(() => {
    void updateState.mutateAsync({ showId: show.id, newState: "past" });
  }, [show.id, updateState]);
  const handleEdit = useCallback(() => {
    router.push(`/add?editId=${show.id}`);
  }, [router, show.id]);
  const handleDelete = useCallback(() => {
    if (!window.confirm("Delete this show? This cannot be undone.")) return;
    void deleteShow.mutateAsync({ showId: show.id });
  }, [deleteShow, show.id]);
  const handleSaveNotes = useCallback(
    async (next: string) => {
      await setNotes.mutateAsync({ showId: show.id, notes: next });
    },
    [show.id, setNotes],
  );

  const mediaLineup = lineupEntries.map((entry) => ({
    id: entry.performerId,
    name: entry.name,
  }));

  // Music-layer slot for the Overview tab — pre-show shows vibe radar
  // empty state; post-show shows fan loyalty empty state. Phases 7+8
  // replace these placeholders with real atoms.
  const musicLayerPlaceholder = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 10,
      }}
    >
      <MusicLayerEmpty variant="vibe-radar" spotifyConnected={false} />
      {isPast && (
        <MusicLayerEmpty variant="fan-loyalty" spotifyConnected={false} />
      )}
    </div>
  );

  const showLikeForGate: ShowLike = show;
  const isUnsupportedKind =
    show.kind !== "concert" && show.kind !== "festival";
  const isProduction = isProductionShow(showLikeForGate);
  const setlistStyle =
    predictionQuery.data && "style" in predictionQuery.data
      ? predictionQuery.data.style
      : "stable";

  const setlistPanel =
    !isPast && (isUnsupportedKind || isProduction) ? (
      <SetlistTabComingSoon style={show.kind} />
    ) : !isPast && setlistStyle !== "stable" && setlistStyle !== "cold" ? (
      <SetlistTabComingSoon style={setlistStyle} />
    ) : (
      <SetlistTab
        showId={show.id}
        isPast={isPast}
        artistName={headlinerName}
        prediction={predictionQuery.data ?? null}
        predictionLoading={predictionQuery.isLoading}
        actualSongs={actualSongs}
      />
    );

  const overviewPanel = (
    <OverviewTab
      showId={show.id}
      isPast={isPast}
      state={show.state}
      cells={cells}
      lineup={lineupEntries}
      artistHistorySummary={null}
      venueHistorySummary={null}
      onMarkAttended={
        show.state === "ticketed" ? handleMarkAttended : undefined
      }
      onEdit={handleEdit}
      onAddToCalendarHref={`/api/shows/${show.id}/ical`}
      onDelete={handleDelete}
      musicLayerPlaceholder={musicLayerPlaceholder}
    />
  );

  const mediaPanel = (
    <MediaTab
      isPast={isPast}
      mediaCount={0}
      mediaSection={
        <MediaSection
          scope="show"
          showId={show.id}
          lineup={mediaLineup}
          canUpload={isPast}
        />
      }
    />
  );

  const notesPanel = (
    <NotesTab
      isPast={isPast}
      notes={show.notes ?? ""}
      onSave={handleSaveNotes}
    />
  );

  // Header — collapsed hero strip. Tab bar is sticky below.
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      <ShowHeaderStrip show={show} />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <ShowTabs
          showId={show.id}
          isPast={isPast}
          badges={badges}
          panels={{
            overview: overviewPanel,
            setlist: setlistPanel,
            media: mediaPanel,
            notes: notesPanel,
          }}
          onTabChange={trackTabView}
        />
      </div>
    </div>
  );
}

function ShowHeaderStrip({
  show,
}: {
  show: ShowDetailTabsViewProps["show"];
}) {
  const isPast = show.state === "past";
  const headlinerName = getHeadliner(show);
  const dateLabel = show.date
    ? formatDateRangeLong(show.date, show.endDate)
    : "Date TBD";
  const countdown =
    !isPast && show.date && daysUntil(show.date) > 0
      ? `in ${daysUntil(show.date)} day${daysUntil(show.date) !== 1 ? "s" : ""}`
      : null;
  return (
    <header
      style={{
        padding: "22px var(--page-pad-x) 18px",
        borderBottom: "1px solid var(--rule)",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      data-testid="show-tabs-header"
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--muted)",
          letterSpacing: ".12em",
          textTransform: "uppercase",
        }}
      >
        {show.kind}
      </div>
      <h1
        className="display-title"
        style={{
          margin: 0,
          fontSize: 44,
          letterSpacing: -1.5,
          lineHeight: 0.96,
          fontWeight: 600,
        }}
      >
        {headlinerName}
      </h1>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 14,
              color: "var(--muted)",
            }}
          >
            {dateLabel}
          </span>
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
        {isPast ? (
          <span
            style={{
              padding: "4px 10px",
              border: "1px solid var(--rule-strong)",
              color: "var(--muted)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: ".18em",
              textTransform: "uppercase",
            }}
            data-testid="went-badge"
          >
            went
          </span>
        ) : show.state === "ticketed" ? (
          <span
            style={{
              padding: "4px 10px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: ".18em",
              textTransform: "uppercase",
            }}
          >
            tix
          </span>
        ) : (
          <span
            style={{
              padding: "4px 10px",
              border: "1px solid var(--ink)",
              color: "var(--ink)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              fontWeight: 500,
              letterSpacing: ".18em",
              textTransform: "uppercase",
            }}
          >
            watching
          </span>
        )}
      </div>
    </header>
  );
}
