/**
 * Run grouping: collapse multi-date events at the same venue under a single
 * headliner into one logical "run" — a theatre production or a concert
 * residency. Single-night events pass through unchanged.
 *
 * Used both by the TM ingestion path and (later) the LLM scraping path,
 * after each path normalizes its events into NormalizedEvent.
 */

export type Kind = 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports';

export interface NormalizedEvent {
  /** Stable per-source event id, used for dedup. */
  sourceEventId: string;
  /**
   * Other source-event-ids that were collapsed into this one by tier-variant
   * dedup (see dedupeTierVariants). Empty for events that came in clean.
   * Persisted on the announcement row so re-ingest stays idempotent.
   */
  extraSourceEventIds: string[];
  /** ISO YYYY-MM-DD. */
  date: string;
  /** HH:MM:SS or null. Used by tier-variant dedup to keep early/late shows apart. */
  localTime: string | null;
  /** Lower-cased venue city, used as a tier-variant dedup key. */
  city: string;
  kind: Kind;
  headliner: string;
  /** Resolved performer id once matchOrCreatePerformer has run. */
  headlinerPerformerId: string | null;
  venueId: string;
  support: string[] | null;
  /** Resolved performer ids for support acts, parallel to `support`. */
  supportPerformerIds: string[] | null;
  onSaleDate: Date | null;
  onSaleStatus: 'announced' | 'on_sale' | 'sold_out';
  source: 'ticketmaster' | 'manual' | 'scraped';
  ticketUrl: string | null;
}

export interface EventRun {
  /** First date (ISO). */
  runStartDate: string;
  /** Last date (ISO). */
  runEndDate: string;
  /** All dates in this run, sorted ascending, deduplicated. */
  performanceDates: string[];
  /** Source event IDs for every performance in this run. */
  sourceEventIds: string[];
  /**
   * Tier-variant source IDs collapsed into the run's events. Tracked so
   * re-ingest skips them via existingSourceIds.
   */
  extraSourceEventIds: string[];
  productionName: string;
  kind: Kind;
  headliner: string;
  headlinerPerformerId: string | null;
  venueId: string;
  support: string[] | null;
  supportPerformerIds: string[] | null;
  /** Earliest on-sale date across the run (most relevant for "tickets coming"). */
  onSaleDate: Date | null;
  onSaleStatus: 'announced' | 'on_sale' | 'sold_out';
  source: 'ticketmaster' | 'manual' | 'scraped';
  ticketUrl: string | null;
}

/**
 * Decide whether to collapse a cluster of multi-date events at the same
 * (headliner, venue, kind) into one run.
 *
 * - theatre: always group.
 * - concert: group only when 3+ dates within 30 days (residency heuristic).
 *            Otherwise emit individual events (touring concerts at the same
 *            venue weeks/months apart should stay separate).
 * - comedy: never group.
 * - festival: group duplicate pass/day/tier listings into one festival row.
 */
export function shouldGroup(kind: Kind, dates: string[]): boolean {
  if (kind === 'theatre') return dates.length >= 2;
  if (kind === 'festival') return dates.length >= 2;
  if (kind === 'concert') {
    if (dates.length < 3) return false;
    const sorted = [...dates].sort();
    const first = new Date(sorted[0]!);
    const last = new Date(sorted[sorted.length - 1]!);
    const days = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24);
    return days <= 30;
  }
  return false;
}

/**
 * Collapse same-night ticket-tier variants into a single canonical event.
 *
 * Ticketmaster hands out a separate event (with its own event id and often
 * its own venue id — e.g. "Ziggo Dome", "Ziggo Dome Club", "Vinyl Room -
 * Ziggo Dome") for every tier, VIP package, presale wave, or sub-room of
 * the same physical concert. None of those have a shared parent id in the
 * Discovery API, so we cluster on the strongest signal we do have:
 * (headlinerPerformerId or headliner) + date + city. When localTime is set
 * on both sides and the gap exceeds 2h we keep the rows apart so early/late
 * comedy shows aren't merged.
 *
 * Festivals are deliberately exempt — same-day pass listings are handled by
 * the festival path in groupEventsIntoRuns and pruneDuplicateFestivalSinglesForRun.
 *
 * The canonical event is the cluster member with the most support acts
 * (richest payload), then the earliest onSaleDate, then a status preference
 * of on_sale > sold_out > announced, with sourceEventId as a deterministic
 * tiebreak. Dropped source IDs are collected into extraSourceEventIds so
 * the next ingest knows to skip them.
 */
export function dedupeTierVariants(
  events: NormalizedEvent[],
): NormalizedEvent[] {
  const clusters = new Map<string, NormalizedEvent[]>();
  const passthrough: NormalizedEvent[] = [];

  for (const event of events) {
    if (event.kind === 'festival') {
      passthrough.push(event);
      continue;
    }
    const headlinerKey = event.headlinerPerformerId ?? event.headliner;
    const key = `${headlinerKey}::${event.date}::${event.city}`;
    const existing = clusters.get(key);
    if (existing) existing.push(event);
    else clusters.set(key, [event]);
  }

  const result: NormalizedEvent[] = [...passthrough];
  for (const cluster of clusters.values()) {
    if (cluster.length === 1) {
      result.push(cluster[0]!);
      continue;
    }
    // Split clusters on >=2h time gap. This keeps early/late comedy shows
    // separate while still merging tier variants that all share a start
    // time (or where TM only populated localTime on some listings).
    const subClusters = splitByLocalTime(cluster);
    for (const sub of subClusters) {
      if (sub.length === 1) {
        result.push(sub[0]!);
      } else {
        result.push(mergeCluster(sub));
      }
    }
  }
  return result;
}

function splitByLocalTime(cluster: NormalizedEvent[]): NormalizedEvent[][] {
  const withTime = cluster.filter((e) => e.localTime);
  if (withTime.length < 2) return [cluster];

  const buckets: { rep: number; events: NormalizedEvent[] }[] = [];
  for (const event of cluster) {
    if (!event.localTime) {
      // No time info — drop into the first bucket; better to over-merge
      // than to spawn a phantom row.
      if (buckets[0]) buckets[0].events.push(event);
      else buckets.push({ rep: -1, events: [event] });
      continue;
    }
    const minutes = parseTimeToMinutes(event.localTime);
    const bucket = buckets.find((b) => Math.abs(b.rep - minutes) < 120);
    if (bucket) bucket.events.push(event);
    else buckets.push({ rep: minutes, events: [event] });
  }
  return buckets.map((b) => b.events);
}

function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map((n) => parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

const STATUS_RANK: Record<NormalizedEvent['onSaleStatus'], number> = {
  on_sale: 0,
  sold_out: 1,
  announced: 2,
};

function mergeCluster(cluster: NormalizedEvent[]): NormalizedEvent {
  const sorted = [...cluster].sort((a, b) => {
    const supportDiff =
      (b.support?.length ?? 0) - (a.support?.length ?? 0);
    if (supportDiff !== 0) return supportDiff;

    const aOnSale = a.onSaleDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const bOnSale = b.onSaleDate?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aOnSale !== bOnSale) return aOnSale - bOnSale;

    const statusDiff =
      STATUS_RANK[a.onSaleStatus] - STATUS_RANK[b.onSaleStatus];
    if (statusDiff !== 0) return statusDiff;

    return a.sourceEventId.localeCompare(b.sourceEventId);
  });

  const canonical = sorted[0]!;
  const dropped = sorted.slice(1);
  const extras = [
    ...canonical.extraSourceEventIds,
    ...dropped.flatMap((e) => [e.sourceEventId, ...e.extraSourceEventIds]),
  ];
  return { ...canonical, extraSourceEventIds: extras };
}

/**
 * Group a flat list of NormalizedEvents into a mix of EventRuns (multi-date
 * collapses) and single events (one-night cases). The caller then routes
 * each into the appropriate insert/extend path.
 */
export function groupEventsIntoRuns(events: NormalizedEvent[]): {
  runs: EventRun[];
  singles: NormalizedEvent[];
} {
  // Cluster by (headlinerPerformerId or headliner, venueId, kind). Falls back
  // to headliner name when performer hasn't been resolved yet — same string
  // means same artist, good enough for grouping inside one ingestion run.
  const clusters = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const headlinerKey = event.headlinerPerformerId ?? event.headliner;
    const key = `${headlinerKey}::${event.venueId}::${event.kind}`;
    const existing = clusters.get(key);
    if (existing) existing.push(event);
    else clusters.set(key, [event]);
  }

  const runs: EventRun[] = [];
  const singles: NormalizedEvent[] = [];

  for (const cluster of clusters.values()) {
    const dates = cluster.map((e) => e.date);
    const kind = cluster[0]!.kind;
    if (shouldGroup(kind, dates)) {
      runs.push(makeRun(cluster));
    } else {
      singles.push(...cluster);
    }
  }

  return { runs, singles };
}

function makeRun(cluster: NormalizedEvent[]): EventRun {
  const representative = pickRepresentativeEvent(cluster);
  const sortedDates = [...new Set(cluster.map((e) => e.date))].sort();
  const sortedSourceIds = cluster
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => e.sourceEventId);
  const extraSourceEventIds = cluster.flatMap((e) => e.extraSourceEventIds);
  const earliestOnSale = cluster
    .map((e) => e.onSaleDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  // Festivals should reflect the representative pass/listing status. If a
  // 3-day pass is sold out but day/platinum listings remain on sale, the
  // canonical festival row should still show sold out.
  const statuses = new Set(cluster.map((e) => e.onSaleStatus));
  const onSaleStatus: 'announced' | 'on_sale' | 'sold_out' =
    representative.kind === 'festival'
      ? representative.onSaleStatus
      : statuses.has('on_sale')
        ? 'on_sale'
        : statuses.size === 1 && statuses.has('sold_out')
          ? 'sold_out'
          : 'announced';

  return {
    runStartDate: sortedDates[0]!,
    runEndDate: sortedDates[sortedDates.length - 1]!,
    performanceDates: sortedDates,
    sourceEventIds: sortedSourceIds,
    extraSourceEventIds,
    productionName: representative.headliner,
    kind: representative.kind,
    headliner: representative.headliner,
    headlinerPerformerId: representative.headlinerPerformerId,
    venueId: representative.venueId,
    support: representative.support,
    supportPerformerIds: representative.supportPerformerIds,
    onSaleDate:
      representative.kind === 'festival'
        ? representative.onSaleDate
        : earliestOnSale,
    onSaleStatus,
    source: representative.source,
    ticketUrl: representative.ticketUrl,
  };
}

function pickRepresentativeEvent(cluster: NormalizedEvent[]): NormalizedEvent {
  const first = cluster[0]!;
  if (first.kind !== 'festival') return first;

  const datesByTicketUrl = new Map<string, Set<string>>();
  for (const event of cluster) {
    if (!event.ticketUrl) continue;
    const dates = datesByTicketUrl.get(event.ticketUrl) ?? new Set<string>();
    dates.add(event.date);
    datesByTicketUrl.set(event.ticketUrl, dates);
  }

  return cluster
    .slice()
    .sort((a, b) => {
      const bTicketDates = b.ticketUrl
        ? (datesByTicketUrl.get(b.ticketUrl)?.size ?? 0)
        : 0;
      const aTicketDates = a.ticketUrl
        ? (datesByTicketUrl.get(a.ticketUrl)?.size ?? 0)
        : 0;
      if (bTicketDates !== aTicketDates) return bTicketDates - aTicketDates;

      const supportDiff = (b.support?.length ?? 0) - (a.support?.length ?? 0);
      if (supportDiff !== 0) return supportDiff;

      return a.date.localeCompare(b.date);
    })[0]!;
}
