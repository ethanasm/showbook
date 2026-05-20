/**
 * Gmail-import flow hook. Owns the state machine: idle → scanning →
 * picking → importing → done. Mirror of the web Logbook modal in
 * `apps/web/components/shows-list/ShowsListView.tsx` minus the OAuth
 * orchestration (that lives in `lib/gmail-connection.ts`).
 *
 * The actual scan call is delegated to `runGmailScan` so the wire
 * parsing can be unit-tested independently of React.
 */

import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '../auth';
import { API_URL } from '../env';
import { trpc, type RouterOutput } from '../trpc';
import { isDuplicateTicket, type DedupShow } from './dedup';
import { runGmailScan } from './scan';
import type { GmailScanProgress, GmailTicket } from './types';

export type GmailImportPhase =
  | 'idle'
  | 'scanning'
  | 'picking'
  | 'importing'
  | 'done';

export interface ImportedSummary {
  added: number;
  failed: number;
}

export interface UseGmailImportOptions {
  onImported?: (summary: ImportedSummary) => void;
}

interface UseGmailImportInternals {
  /** Override the fetch implementation. Tests only. */
  fetchImpl?: typeof fetch;
}

export function useGmailImport(
  opts: UseGmailImportOptions = {},
  internals: UseGmailImportInternals = {},
) {
  const { token } = useAuth();
  const utils = trpc.useUtils();
  const showsListQuery = trpc.shows.list.useQuery({}, { staleTime: 60_000 });

  const [phase, setPhase] = useState<GmailImportPhase>('idle');
  const [progress, setProgress] = useState<GmailScanProgress | null>(null);
  const [tickets, setTickets] = useState<GmailTicket[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedSummary, setImportedSummary] = useState<ImportedSummary | null>(null);

  const existingShows = useMemo<DedupShow[]>(() => {
    const data = showsListQuery.data as
      | RouterOutput<typeof utils.client.shows.list.query>
      | undefined;
    if (!data) return [];
    return data.map((s) => ({
      date: s.date ?? null,
      showPerformers: s.showPerformers.map((sp) => ({
        role: sp.role,
        performer: { name: sp.performer.name },
      })),
    }));
  }, [showsListQuery.data, utils.client]);

  const ticketKey = useCallback(
    (t: GmailTicket, i: number) => t.gmailMessageId || `${t.headliner}-${t.date ?? 'tbd'}-${i}`,
    [],
  );

  const runScan = useCallback(
    async (accessToken: string) => {
      if (!token) {
        setError('Sign in again before scanning Gmail.');
        return;
      }
      setPhase('scanning');
      setProgress(null);
      setError(null);
      setTruncated(false);
      try {
        const result = await runGmailScan({
          apiUrl: API_URL,
          accessToken,
          sessionToken: token,
          onProgress: setProgress,
          fetchImpl: internals.fetchImpl,
        });
        setTickets(result.tickets);
        setTruncated(result.truncated);
        const initialSelected = new Set<string>();
        result.tickets.forEach((t, i) => {
          if (!isDuplicateTicket(t, existingShows)) initialSelected.add(ticketKey(t, i));
        });
        setSelected(initialSelected);
        setPhase('picking');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gmail scan failed.');
        setPhase('idle');
      } finally {
        setProgress(null);
      }
    },
    [token, existingShows, ticketKey, internals.fetchImpl],
  );

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(() => {
      const next = new Set<string>();
      tickets.forEach((t, i) => {
        if (!isDuplicateTicket(t, existingShows)) next.add(ticketKey(t, i));
      });
      return next;
    });
  }, [tickets, existingShows, ticketKey]);

  const deselectAll = useCallback(() => setSelected(new Set()), []);

  const importSelected = useCallback(async () => {
    setPhase('importing');
    setError(null);
    setImportedSummary(null);

    let added = 0;
    let failed = 0;
    const chosen = tickets
      .map((t, i) => ({ t, key: ticketKey(t, i) }))
      .filter(({ key }) => selected.has(key));

    for (const { t } of chosen) {
      try {
        await utils.client.shows.create.mutate({
          kind: t.kind_hint ?? 'concert',
          headliner: { name: t.headliner },
          venue: {
            name: t.venue_name ?? 'Unknown Venue',
            city: t.venue_city ?? 'Unknown',
            stateRegion: t.venue_state ?? undefined,
          },
          date: t.date ?? new Date().toISOString().split('T')[0],
          seat: t.seat ?? undefined,
          pricePaid: t.price ?? undefined,
          ticketCount: t.ticket_count ?? 1,
          productionName: t.production_name ?? undefined,
          sourceRefs: {
            gmail: true,
            gmailMessageId: t.gmailMessageId,
            scanAt: new Date().toISOString(),
          },
        });
        added += 1;
      } catch {
        failed += 1;
      }
    }

    const summary: ImportedSummary = { added, failed };
    setImportedSummary(summary);
    setPhase('done');
    void utils.shows.list.invalidate();
    void utils.performers.list.invalidate();
    void utils.performers.count.invalidate();
    opts.onImported?.(summary);
  }, [tickets, selected, ticketKey, utils, opts]);

  const reset = useCallback(() => {
    setPhase('idle');
    setProgress(null);
    setTickets([]);
    setSelected(new Set());
    setTruncated(false);
    setError(null);
    setImportedSummary(null);
  }, []);

  const counts = useMemo(() => {
    let duplicates = 0;
    let selectable = 0;
    tickets.forEach((t) => {
      if (isDuplicateTicket(t, existingShows)) duplicates += 1;
      else selectable += 1;
    });
    return {
      total: tickets.length,
      duplicates,
      selectable,
      selected: selected.size,
    };
  }, [tickets, existingShows, selected]);

  return {
    phase,
    progress,
    tickets,
    selected,
    truncated,
    error,
    counts,
    importedSummary,
    ticketKey,
    isDuplicate: useCallback(
      (t: GmailTicket) => isDuplicateTicket(t, existingShows),
      [existingShows],
    ),
    runScan,
    toggle,
    selectAll,
    deselectAll,
    importSelected,
    reset,
  };
}

export type GmailImportFlow = ReturnType<typeof useGmailImport>;
