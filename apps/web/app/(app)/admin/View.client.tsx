"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionHead } from "@/components/PreferencesPrimitives";

interface BackfillCardProps {
  title: string;
  description: string;
  buttonLabel: string;
  confirmText: string;
  isPending: boolean;
  errorMessage: string | null;
  resultLine: string | null;
  onRun: () => void;
}

function BackfillCard({
  title,
  description,
  buttonLabel,
  confirmText,
  isPending,
  errorMessage,
  resultLine,
  onRun,
}: BackfillCardProps) {
  function handleClick() {
    if (isPending) return;
    if (typeof window !== "undefined" && !window.confirm(confirmText)) return;
    onRun();
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.cardDescription}>{description}</div>
      <div style={styles.cardActions}>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          style={isPending ? styles.runButtonDisabled : styles.runButton}
          aria-label={buttonLabel}
        >
          {isPending ? "Running…" : buttonLabel}
        </button>
        {resultLine && <span style={styles.resultLine}>{resultLine}</span>}
        {errorMessage && <span style={styles.errorLine}>{errorMessage}</span>}
      </div>
    </div>
  );
}

export default function AdminView() {
  const coordsMutation = trpc.admin.backfillVenueCoordinates.useMutation();
  const tmMutation = trpc.admin.backfillVenueTicketmaster.useMutation();
  const pruneMutation = trpc.admin.enqueuePruneOrphanCatalog.useMutation();
  const setlistMutation = trpc.admin.enqueueSetlistRetry.useMutation();
  const corpusFillMutation = trpc.admin.enqueueSetlistCorpusFill.useMutation();
  const corpusRefreshMutation =
    trpc.admin.enqueueSetlistCorpusFillRefresh.useMutation();
  const performerMbidMutation =
    trpc.admin.enqueueBackfillPerformerMbids.useMutation();
  const performerTmMutation =
    trpc.admin.enqueueBackfillPerformerTicketmasterIds.useMutation();
  const performerSpotifyMutation =
    trpc.admin.enqueueBackfillPerformerSpotifyIds.useMutation();

  const [performerQuery, setPerformerQuery] = useState("");

  const coordsResult = coordsMutation.data
    ? `Last run: ${coordsMutation.data.geocoded} geocoded · ${coordsMutation.data.failed} failed · ${coordsMutation.data.total} total`
    : null;
  const tmResult = tmMutation.data
    ? `Last run: ${tmMutation.data.matched} matched · ${tmMutation.data.failed} failed · ${tmMutation.data.total} total`
    : null;
  const pruneResult = pruneMutation.data
    ? pruneMutation.data.jobId
      ? `Enqueued job ${pruneMutation.data.jobId}`
      : 'Enqueue returned no job id (likely a duplicate already queued)'
    : null;
  const setlistResult = setlistMutation.data
    ? `Last run: ${setlistMutation.data.queued} queued · job ${setlistMutation.data.jobId ?? 'n/a'}`
    : null;
  const corpusFillResult = corpusFillMutation.data
    ? `Enqueued ${corpusFillMutation.data.mode} for ${corpusFillMutation.data.performerName} (${corpusFillMutation.data.performerId})${corpusFillMutation.data.hasMbid ? '' : ' — no MBID, job will short-circuit'} · job ${corpusFillMutation.data.jobId ?? 'n/a'}`
    : null;
  const corpusRefreshResult = corpusRefreshMutation.data
    ? corpusRefreshMutation.data.jobId
      ? `Enqueued job ${corpusRefreshMutation.data.jobId}`
      : 'Enqueue returned no job id (likely a duplicate already queued)'
    : null;
  const performerMbidResult = performerMbidMutation.data
    ? performerMbidMutation.data.jobId
      ? `Enqueued job ${performerMbidMutation.data.jobId}`
      : 'Enqueue returned no job id (likely a duplicate already queued)'
    : null;
  const performerTmResult = performerTmMutation.data
    ? performerTmMutation.data.jobId
      ? `Enqueued job ${performerTmMutation.data.jobId}`
      : 'Enqueue returned no job id (likely a duplicate already queued)'
    : null;
  const performerSpotifyResult = performerSpotifyMutation.data
    ? performerSpotifyMutation.data.jobId
      ? `Enqueued job ${performerSpotifyMutation.data.jobId}`
      : 'Enqueue returned no job id (likely a duplicate already queued)'
    : null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLabel}>Settings</div>
        <h1 style={styles.pageTitle}>
          <ShieldCheck size={20} style={styles.titleIcon} />
          Admin
        </h1>
        <div style={styles.headerSub}>
          Operator-only tools. Each action below mutates global venue rows and
          spends operator API budget — be deliberate.
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.contentInner}>
          <SectionHead
            label="Venue maintenance"
            sub="Fill in missing data on every venue row"
          />

          <div style={styles.grid}>
            <BackfillCard
              title="Backfill venue coordinates"
              description="Geocode every venue with a known city but missing lat/lng or stateRegion. Calls Google Geocoding once per row."
              buttonLabel="Run coordinate backfill"
              confirmText="Run coordinate backfill across all venues? This will call Google Geocoding for every incomplete row."
              isPending={coordsMutation.isPending}
              errorMessage={coordsMutation.error?.message ?? null}
              resultLine={coordsResult}
              onRun={() => coordsMutation.mutate()}
            />

            <BackfillCard
              title="Prune orphaned announcements & venues"
              description="Enqueue the prune-orphan-catalog pg-boss job. Deletes announcements, venues, and performers with no remaining shows, follows, or references. Already runs nightly at 02:30 ET — use this for an on-demand sweep."
              buttonLabel="Enqueue prune job"
              confirmText="Enqueue the prune-orphan-catalog job? It will delete unreferenced announcements, venues, and performers."
              isPending={pruneMutation.isPending}
              errorMessage={pruneMutation.error?.message ?? null}
              resultLine={pruneResult}
              onRun={() => pruneMutation.mutate()}
            />

            <BackfillCard
              title="Backfill Ticketmaster venue IDs"
              description="Look up a Ticketmaster venueId for every venue that doesn't have one. Calls the Ticketmaster Discovery API once per row."
              buttonLabel="Run Ticketmaster backfill"
              confirmText="Run Ticketmaster backfill across all venues? This will call the Ticketmaster Discovery API for every venue without an id."
              isPending={tmMutation.isPending}
              errorMessage={tmMutation.error?.message ?? null}
              resultLine={tmResult}
              onRun={() => tmMutation.mutate()}
            />

            <BackfillCard
              title="Run setlist enrichment"
              description="Queue every past concert that's missing a setlist (skipping ones already queued) and trigger setlist-retry now. Covers Gmail imports and other past shows that bypassed the nightly ticketed→past transition. Calls setlist.fm once per show; respects the 14-attempt give-up marker."
              buttonLabel="Run setlist enrichment"
              confirmText="Queue all past concerts without a setlist and trigger setlist-retry? This will call setlist.fm for each one."
              isPending={setlistMutation.isPending}
              errorMessage={setlistMutation.error?.message ?? null}
              resultLine={setlistResult}
              onRun={() => setlistMutation.mutate()}
            />
          </div>

          <SectionHead
            label="Performer enrichment"
            sub="Backfill external IDs on performers that are missing them"
          />

          <div style={styles.grid}>
            <BackfillCard
              title="Backfill performer MBIDs"
              description="Enqueue the backfill-performer-mbids job. Looks up MusicBrainz IDs via setlist.fm artist search for every performer without one — never overwrites an existing MBID. Already runs daily at 04:30 ET; use this after a bulk import to fill the gap before the next cron. Results land in Axiom (event backfill.performer_mbids.summary)."
              buttonLabel="Enqueue MBID backfill"
              confirmText="Enqueue the performer-MBID backfill? It calls setlist.fm once per performer with no MBID."
              isPending={performerMbidMutation.isPending}
              errorMessage={performerMbidMutation.error?.message ?? null}
              resultLine={performerMbidResult}
              onRun={() => performerMbidMutation.mutate()}
            />

            <BackfillCard
              title="Backfill performer Ticketmaster IDs"
              description="Enqueue the backfill-performer-ticketmaster-ids job. Looks up TM attraction IDs for every performer without one, and fills any missing MBID exposed by TM's external links as a side effect — never overwrites existing IDs. Already runs daily at 06:00 ET. Results land in Axiom (event backfill.performer_ticketmaster_ids.summary)."
              buttonLabel="Enqueue TM-id backfill"
              confirmText="Enqueue the performer-Ticketmaster-id backfill? It calls TM Discovery once per performer with no attraction id."
              isPending={performerTmMutation.isPending}
              errorMessage={performerTmMutation.error?.message ?? null}
              resultLine={performerTmResult}
              onRun={() => performerTmMutation.mutate()}
            />

            <BackfillCard
              title="Backfill performer Spotify IDs"
              description="Enqueue the backfill-performer-spotify-ids job. Looks up Spotify catalog IDs via /v1/search?type=artist for every performer without one — never overwrites an existing ID. Already runs daily at 06:30 ET; use this after a bulk import or to catch up the pre-existing backlog. Results land in Axiom (event backfill.performer_spotify_ids.summary)."
              buttonLabel="Enqueue Spotify-id backfill"
              confirmText="Enqueue the performer-Spotify-id backfill? It calls Spotify search once per performer with no Spotify id."
              isPending={performerSpotifyMutation.isPending}
              errorMessage={performerSpotifyMutation.error?.message ?? null}
              resultLine={performerSpotifyResult}
              onRun={() => performerSpotifyMutation.mutate()}
            />
          </div>

          <SectionHead
            label="Setlist corpus"
            sub="Pre-show setlist.fm fetches that warm up the predicted-setlist tab"
          />

          <div style={styles.grid}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>Refresh setlist corpus for performer</div>
              <div style={styles.cardDescription}>
                Enqueue an enrichment/setlist-corpus-fill job (mode: predict, ~3
                pages / 60 setlists) for a specific performer. Use this when a
                show is approaching and the Setlist tab is stuck on
                &ldquo;We&rsquo;re pulling recent setlists&rdquo;. Accepts a
                performer UUID or a name substring; ambiguous matches return the
                candidate list.
              </div>
              <div style={styles.cardActions}>
                <input
                  type="text"
                  value={performerQuery}
                  onChange={(e) => setPerformerQuery(e.target.value)}
                  placeholder="Performer name or UUID"
                  disabled={corpusFillMutation.isPending}
                  style={styles.input}
                  aria-label="Performer name or UUID"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (corpusFillMutation.isPending) return;
                    const q = performerQuery.trim();
                    if (q.length === 0) return;
                    corpusFillMutation.mutate({ performerQuery: q });
                  }}
                  disabled={
                    corpusFillMutation.isPending ||
                    performerQuery.trim().length === 0
                  }
                  style={
                    corpusFillMutation.isPending ||
                    performerQuery.trim().length === 0
                      ? styles.runButtonDisabled
                      : styles.runButton
                  }
                  aria-label="Enqueue corpus fill"
                >
                  {corpusFillMutation.isPending ? 'Enqueuing…' : 'Enqueue'}
                </button>
                {corpusFillResult && (
                  <span style={styles.resultLine}>{corpusFillResult}</span>
                )}
                {corpusFillMutation.error && (
                  <span style={styles.errorLine}>
                    {corpusFillMutation.error.message}
                  </span>
                )}
              </div>
            </div>

            <BackfillCard
              title="Refresh setlist corpus (all upcoming)"
              description="Trigger the enrichment/setlist-corpus-fill-refresh job — the same one that runs daily at 04:45 ET. Refreshes corpus for the top-500 followed performers plus everyone with a watching / ticketed show in the next 30 days. Use this if the cron missed or you can't wait until tomorrow morning."
              buttonLabel="Enqueue corpus refresh"
              confirmText="Enqueue the setlist-corpus-fill-refresh sweep? It calls setlist.fm once per qualifying performer (~500+ calls)."
              isPending={corpusRefreshMutation.isPending}
              errorMessage={corpusRefreshMutation.error?.message ?? null}
              resultLine={corpusRefreshResult}
              onRun={() => corpusRefreshMutation.mutate()}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  header: {
    padding: "16px var(--page-pad-x)",
    borderBottom: "1px solid var(--rule)",
  },
  headerLabel: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    letterSpacing: ".1em",
    textTransform: "uppercase",
  },
  pageTitle: {
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 26,
    color: "var(--ink)",
    letterSpacing: "-0.01em",
    lineHeight: 1.1,
    marginTop: 4,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  titleIcon: {
    color: "var(--accent)",
  },
  headerSub: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--muted)",
    marginTop: 8,
    maxWidth: 560,
    lineHeight: 1.5,
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "28px var(--page-pad-x) 60px",
  },
  contentInner: {
    maxWidth: 1080,
  },
  // Two-column grid that collapses to a single column on narrow screens.
  // `auto-fit` + `minmax(340px, 1fr)` means cards reflow without a
  // media query: ≥720px → 2 columns, narrower → 1 column. Each section
  // gets its own grid wrapper so SectionHead spans full width.
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
    gap: 16,
    marginBottom: 28,
  },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--rule)",
    padding: "18px 20px",
    // Spacing between cards comes from `styles.grid`'s `gap` so cards in
    // the same row stay flush.
    marginBottom: 0,
  },
  cardTitle: {
    fontFamily: "var(--font-geist-sans)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--ink)",
    letterSpacing: -0.15,
  },
  cardDescription: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--muted)",
    marginTop: 6,
    lineHeight: 1.5,
  },
  cardActions: {
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  runButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--accent)",
    background: "transparent",
    border: "1px solid var(--accent)",
    padding: "8px 16px",
    cursor: "pointer",
  },
  runButtonDisabled: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--faint)",
    background: "transparent",
    border: "1px solid var(--rule-strong)",
    padding: "8px 16px",
    cursor: "not-allowed",
  },
  resultLine: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--muted)",
  },
  errorLine: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "#E63946",
  },
  input: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 12,
    color: "var(--ink)",
    background: "transparent",
    border: "1px solid var(--rule)",
    padding: "8px 10px",
    minWidth: 260,
    flex: "1 1 260px",
    maxWidth: 360,
  },
};
