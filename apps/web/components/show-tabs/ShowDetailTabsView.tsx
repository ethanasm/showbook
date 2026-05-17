"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  PreviewPlayerProvider,
  usePreviewPlayer,
} from "@/lib/preview-player";
import { initFullTrackDriver } from "@/lib/spotify-playback";
import {
  formatDateRangeLong,
  daysUntil,
  normalizePerformerSetlistsMap,
  type PerformerSetlistsMap,
} from "@showbook/shared";
import {
  getHeadliner,
  getHeadlinerId,
  isProductionShow,
  type ShowLike,
} from "@showbook/shared";
import { isFeatureOn } from "@showbook/shared";
import { MediaSection } from "@/components/media";
import { ShowTabs } from "./ShowTabs";
import { OverviewTab, type OverviewLineupEntry } from "./OverviewTab";
import { SetlistTab, SetlistTabComingSoon, type ActualSong } from "./SetlistTab";
import { MediaTab } from "./MediaTab";
import { NotesTab } from "./NotesTab";
import { FanLoyaltyRing } from "./FanLoyaltyRing";
import { PrimingStat } from "./PrimingStat";
import { useTrackTabView } from "./use-track-tab-view";
import { computeShowTabBadges, isHypePlaylistVisible, type ShowTabKey } from "./types";
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
export function ShowDetailTabsView(props: ShowDetailTabsViewProps) {
  // Wrap in the PreviewPlayerProvider so every PredictedSetlistRow's
  // TrackPreview button shares the single audio element. Phase 9.
  return (
    <PreviewPlayerProvider>
      <ShowDetailTabsViewInner {...props} />
    </PreviewPlayerProvider>
  );
}

function ShowDetailTabsViewInner({ show }: ShowDetailTabsViewProps) {
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

  // Phase 5 — rotating-display flag. Single-user prod: we render the
  // rotating UI whenever the dev flag is ON, regardless of the
  // server-side calibration gate verdict. The gate still emits
  // setlist.release_gate.{passed,failed} from the server when other
  // callers hit setlistIntel.releaseGate, so the audit trail stays;
  // the client just doesn't hard-block on it. Re-introduce the
  // gate-blocked branch (rotatingGateBlocked) once we have a
  // multi-user audience and want safety-rails.
  const rotatingFlagOn = isFeatureOn("SetlistIntelRotatingDisplay");
  const rotatingDisplayEnabled = rotatingFlagOn;
  const rotatingGateBlocked = false;

  // Phase 6 — theatrical + improvised display flags. Default OFF.
  // When OFF, the matching prediction.style routes the panel to the
  // SetlistTabComingSoon fallback rather than the Phase-6 view.
  const theatricalDisplayEnabled = isFeatureOn(
    "SetlistIntelTheatricalDisplay",
  );
  const theatricalGateBlocked = false;
  const improvisedDisplayEnabled = isFeatureOn(
    "SetlistIntelImprovisedDisplay",
  );
  const improvisedGateBlocked = false;

  // Phase 3 — global flag + admin override decides whether the real
  // Spotify-backed HypePlaylistCard renders in place of the P1
  // placeholder. Query is cheap (a single users select) and cached
  // for the session.
  const hypeFeatureQuery = trpc.spotify.hypePlaylistFeature.useQuery(
    undefined,
    { staleTime: 5 * 60_000 },
  );

  // Phase 7 — flag gate for the music-layer-v2 surfaces (fan loyalty
  // ring, discovered-live rail, priming stat). When OFF, we keep the
  // P1 empty placeholders rendering instead of the data-backed atoms.
  const musicLayerV2Query = trpc.setlistIntel.musicLayerV2Feature.useQuery(
    undefined,
    { staleTime: 5 * 60_000 },
  );
  const musicLayerV2Enabled = Boolean(musicLayerV2Query.data?.enabled);

  // Phase 2 — inline song badges. Only fetch for past shows where
  // there's a setlist on record AND the Songs surface is on.
  const songsFlagOn = isFeatureOn("SetlistIntelSongs");
  const badgeQuery = trpc.shows.songBadges.useQuery(
    { showId: show.id },
    {
      enabled: isPast && songsFlagOn,
      staleTime: 1000 * 60 * 5,
    },
  );

  // Phase 9 — cached previews. Cheap (single read of the songs table
  // for the headliner), so we fire it unconditionally when the
  // SetlistIntelPreviews flag is on. The row UI gracefully degrades
  // when the response is missing the title; the resolver mutation
  // backfills on first tap.
  const previewsFlagOn = isFeatureOn("SetlistIntelPreviews");
  const previewsQuery = trpc.setlistIntel.trackPreviewsForShow.useQuery(
    { showId: show.id },
    {
      enabled: previewsFlagOn,
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
        // really mean "no prediction available yet". Phase 6 adds
        // theatrical + improvised — both report confidence as a
        // calibrated number so we surface them too.
        predictionConfidence:
          predictionQuery.data &&
          (predictionQuery.data.style === "stable" ||
            predictionQuery.data.style === "rotating" ||
            predictionQuery.data.style === "theatrical" ||
            predictionQuery.data.style === "improvised")
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

  // Music-layer slot for the Overview tab. Only rendered when the
  // FanLoyaltyRing is going to mount — past show + v2 flag on. The
  // pre-show VibeRadar placeholder is gone (Phase 8 deferred to v2 —
  // Spotify audio-features probe returned 403 on 2026-05-17) and the
  // past-show "Fan loyalty coming in Phase 7" empty card was dead
  // space for the long tail of users not in the v2 allowlist.
  // FanLoyaltyRing owns its own loading/empty/disconnected states.
  const musicLayerPlaceholder =
    isPast && musicLayerV2Enabled ? <FanLoyaltyRing showId={show.id} /> : null;

  const showLikeForGate: ShowLike = show;
  const isUnsupportedKind =
    show.kind !== "concert" && show.kind !== "festival";
  const isProduction = isProductionShow(showLikeForGate);
  const setlistStyle =
    predictionQuery.data && "style" in predictionQuery.data
      ? predictionQuery.data.style
      : "stable";

  // SI-05 — the pre-show hype playlist is hidden when the model can't
  // pick 25 high-confidence songs (rotating + improvised). Post-show
  // "I Heard" card is unaffected: it's deterministic from the actual
  // setlist. Stable + theatrical keep the card pre-show.
  const hypePlaylistEnabled = isHypePlaylistVisible({
    featureEnabled: Boolean(hypeFeatureQuery.data?.enabled),
    isPast,
    setlistStyle,
  });

  // Phase 6 — theatrical + improvised join rotating as styles that
  // can pass through SetlistTab. We still hide the tab for unsupported
  // kinds + production shows. A theatrical/improvised prediction with
  // the matching display flag OFF will render the in-tab "gate
  // blocked" placeholder rather than SetlistTabComingSoon — keeps the
  // page geometry consistent with Phase 5 rotating.
  const setlistStylePassesGate =
    setlistStyle === "stable" ||
    setlistStyle === "cold" ||
    setlistStyle === "rotating" ||
    setlistStyle === "theatrical" ||
    setlistStyle === "improvised";
  const showSetlistTab =
    !isPast && (isUnsupportedKind || isProduction)
      ? false
      : !isPast && !setlistStylePassesGate
        ? false
        : true;
  const setlistPanel =
    !isPast && (isUnsupportedKind || isProduction) ? (
      <SetlistTabComingSoon style={show.kind} />
    ) : !showSetlistTab ? (
      <SetlistTabComingSoon style={setlistStyle} />
    ) : (
      <SetlistTab
        showId={show.id}
        isPast={isPast}
        artistName={headlinerName}
        prediction={predictionQuery.data ?? null}
        predictionLoading={predictionQuery.isLoading}
        actualSongs={actualSongs}
        hypePlaylistEnabled={hypePlaylistEnabled}
        musicLayerV2Enabled={musicLayerV2Enabled}
        badgePayload={badgeQuery.data ?? null}
        trackPreviews={previewsQuery.data?.previews ?? null}
        rotatingDisplayEnabled={rotatingDisplayEnabled}
        rotatingGateBlocked={rotatingGateBlocked}
        theatricalDisplayEnabled={theatricalDisplayEnabled}
        theatricalGateBlocked={theatricalGateBlocked}
        improvisedDisplayEnabled={improvisedDisplayEnabled}
        improvisedGateBlocked={improvisedGateBlocked}
      />
    );

  const overviewPanel = (
    <OverviewTab
      showId={show.id}
      isPast={isPast}
      state={show.state}
      kind={show.kind}
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

  // Theatre + comedy shows have no setlist concept — drop the tab
  // entirely rather than routing every visit to a coming-soon
  // placeholder.
  const hiddenTabs: ShowTabKey[] =
    show.kind === "theatre" || show.kind === "comedy" ? ["setlist"] : [];

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

  // Right-rail slots. Every slot is null on this page: the
  // HypePlaylistCard renders inline inside SetlistTab (its canonical
  // home), and FanLoyaltyRing renders inline inside OverviewTab — the
  // rail-copy of either felt like a stray duplicate next to its inline
  // sibling. The shell stays wired so a future phase can re-populate a
  // slot without re-plumbing the layout; ShowDetailRightRail hides
  // itself when every slot is null.
  const rightRailSlots = {
    hypePlaylistCard: null,
    fanLoyaltyRing: null,
  };

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
      {previewsFlagOn && <FullTrackDriverMount />}
      <ShowHeaderStrip
        show={show}
        showPrimingStat={isPast && musicLayerV2Enabled}
      />
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
          hiddenTabs={hiddenTabs}
          rightRail={rightRailSlots}
          onTabChange={trackTabView}
        />
      </div>
    </div>
  );
}

/**
 * Phase 9 — mount the Web Playback SDK driver when the connected
 * user has Spotify Premium. Lazy: the SDK script tag is only
 * appended for premium accounts, so non-premium pages never pay
 * the load cost. Renders nothing.
 */
function FullTrackDriverMount() {
  const player = usePreviewPlayer();
  const spotifyStatus = trpc.spotify.connectionStatus.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!spotifyStatus.data?.connected) return;
    if (spotifyStatus.data.product !== "premium") return;

    let cancelled = false;
    let driverHandle: { stop: () => Promise<void> } | null = null;

    void initFullTrackDriver({
      // The SDK re-asks for a fresh access token whenever its
      // internal one is near expiry. `spotify.playbackToken` is a
      // server-side wrapper around `ensureFreshUserToken` that
      // re-runs the refresh hop server-side and returns the bearer.
      getAccessToken: async () => {
        const token = await utils.spotify.playbackToken.fetch(undefined);
        if (!token) {
          throw new Error("Spotify playback token unavailable");
        }
        return token.accessToken;
      },
      onFatal: () => {
        player.setFullTrackDriver(null);
      },
    }).then((driver) => {
      if (cancelled) return;
      if (driver) {
        driverHandle = driver;
        player.setFullTrackDriver(driver);
      }
    });

    return () => {
      cancelled = true;
      if (driverHandle) {
        void driverHandle.stop().catch(() => undefined);
      }
      player.setFullTrackDriver(null);
    };
  }, [player, spotifyStatus.data, utils.spotify.playbackToken]);

  return null;
}

function ShowHeaderStrip({
  show,
  showPrimingStat = false,
}: {
  show: ShowDetailTabsViewProps["show"];
  showPrimingStat?: boolean;
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
      {showPrimingStat && <PrimingStat showId={show.id} />}
    </header>
  );
}
