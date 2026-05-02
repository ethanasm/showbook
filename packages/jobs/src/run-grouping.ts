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
  /** ISO YYYY-MM-DD. */
  date: string;
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
