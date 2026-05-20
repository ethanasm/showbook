/**
 * useFestivalLineup — drives the festival-poster ingestion flow on mobile.
 * Mirrors `apps/web/components/add/useFestivalLineup.ts`; the only mobile-
 * specific bit is the base64 payload, which the caller obtains via
 * `expo-image-picker` / `expo-document-picker` and passes in directly
 * (the hook doesn't reach for File / FileReader so it works on RN).
 *
 * Rows are keyed by a stable client id (not name), so the user can
 * rename a row or reorder rows without losing selection or tier
 * overrides.
 *
 * Phases:
 *   idle → extracting → picking → submitting → done
 *                                          ↘ error (recoverable: phase reverts
 *                                                    to "picking" so the user
 *                                                    can retry submit)
 */

import { useCallback, useMemo, useState } from 'react';
import { trpc } from '../trpc';

export type FestivalArtistTier = 'headliner' | 'support';

export interface FestivalLineupTmMatch {
  tmAttractionId: string;
  name: string;
  imageUrl: string | null;
  musicbrainzId: string | null;
}

export interface FestivalLineupRow {
  /** Stable client-generated id used as React key + drag target. */
  id: string;
  name: string;
  tier: FestivalArtistTier;
  tmMatch: FestivalLineupTmMatch | null;
}

export interface FestivalLineupMeta {
  festivalName: string | null;
  startDate: string | null;
  endDate: string | null;
  venueHint: string | null;
}

export interface SelectedFestivalArtist {
  name: string;
  role: FestivalArtistTier;
  sortOrder: number;
  tmAttractionId?: string;
  imageUrl?: string;
  musicbrainzId?: string;
}

export type FestivalLineupPhase =
  | 'idle'
  | 'extracting'
  | 'picking'
  | 'submitting'
  | 'done'
  | 'error';

export interface UseFestivalLineupOptions {
  onSubmit: (
    artists: SelectedFestivalArtist[],
    meta: FestivalLineupMeta,
  ) => Promise<void> | void;
}

export interface FestivalSource {
  base64: string;
  kind: 'image' | 'pdf';
}

let _rowIdCounter = 0;
function newRowId(): string {
  _rowIdCounter += 1;
  return `flr-${Date.now().toString(36)}-${_rowIdCounter}`;
}

export function useFestivalLineup(opts: UseFestivalLineupOptions) {
  const [phase, setPhase] = useState<FestivalLineupPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<FestivalLineupMeta | null>(null);
  const [rows, setRows] = useState<FestivalLineupRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tierOverrides, setTierOverrides] = useState<
    Map<string, FestivalArtistTier>
  >(new Map());
  const [isMatching, setIsMatching] = useState(false);

  const extract = trpc.enrichment.extractFestivalLineup.useMutation();
  const matchArtists = trpc.enrichment.matchFestivalArtists.useMutation();

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setMeta(null);
    setRows([]);
    setSelected(new Set());
    setTierOverrides(new Map());
    setIsMatching(false);
  }, []);

  const runTmMatching = useCallback(
    async (entries: Array<{ id: string; name: string }>) => {
      if (entries.length === 0) return;
      setIsMatching(true);
      try {
        // Server caps at 50 per call.
        const capped = entries.slice(0, 50);
        const result = await matchArtists.mutateAsync({
          names: capped.map((e) => e.name),
        });
        const byName = new Map(result.matches.map((m) => [m.name, m]));
        const idByName = new Map<string, string>();
        for (const e of capped) idByName.set(e.name, e.id);
        setRows((prev) =>
          prev.map((row) => {
            const match = byName.get(row.name);
            if (!match || !match.tmAttractionId) return row;
            // Only update rows whose id we matched against — if the user
            // edited the name mid-match, the matched name no longer
            // belongs to that id.
            if (idByName.get(row.name) !== row.id) return row;
            return {
              ...row,
              tmMatch: {
                tmAttractionId: match.tmAttractionId,
                name: match.tmName ?? row.name,
                imageUrl: match.imageUrl,
                musicbrainzId: match.musicbrainzId,
              },
            };
          }),
        );
      } catch {
        // TM matching is best-effort. Names without matches simply have no
        // image — the show can still be created.
      } finally {
        setIsMatching(false);
      }
    },
    [matchArtists],
  );

  const extractFromSource = useCallback(
    async (source: FestivalSource) => {
      setPhase('extracting');
      setError(null);
      try {
        const lineup = await extract.mutateAsync(
          source.kind === 'pdf'
            ? { pdfBase64: source.base64 }
            : { imageBase64: source.base64 },
        );

        const initialRows: FestivalLineupRow[] = lineup.artists.map((a) => ({
          id: newRowId(),
          name: a.name,
          tier: a.tier,
          tmMatch: null,
        }));
        setMeta({
          festivalName: lineup.festivalName,
          startDate: lineup.startDate,
          endDate: lineup.endDate,
          venueHint: lineup.venueHint,
        });
        setRows(initialRows);
        // Default to all selected — on a 30-artist poster, the user usually
        // unchecks the ~few they didn't see rather than checking the ones
        // they did.
        setSelected(new Set(initialRows.map((r) => r.id)));
        setTierOverrides(new Map());
        setPhase('picking');

        // Fire-and-forget TM matching in the background; images stream in
        // when matches resolve, picker renders immediately with names.
        void runTmMatching(
          initialRows.map((r) => ({ id: r.id, name: r.name })),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Extraction failed');
        setPhase('error');
      }
    },
    [extract, runTmMatching],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setTier = useCallback(
    (id: string, tier: FestivalArtistTier) => {
      setTierOverrides((prev) => {
        const next = new Map(prev);
        next.set(id, tier);
        return next;
      });
    },
    [],
  );

  const setRowName = useCallback(
    (
      id: string,
      name: string,
      tmMatch?: FestivalLineupTmMatch | null,
    ) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          // When tmMatch is explicitly passed (including null to clear),
          // honor it. Otherwise dropping a previously-matched id is the
          // right call: an edited name no longer matches that attraction.
          const nextMatch =
            tmMatch === undefined ? null : tmMatch;
          return { ...row, name, tmMatch: nextMatch };
        }),
      );
    },
    [],
  );

  const reorder = useCallback((next: FestivalLineupRow[]) => {
    setRows(next);
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  }, [rows]);

  const selectAll = useCallback(() => {
    setSelected(new Set(rows.map((r) => r.id)));
  }, [rows]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const tierFor = useCallback(
    (row: FestivalLineupRow): FestivalArtistTier =>
      tierOverrides.get(row.id) ?? row.tier,
    [tierOverrides],
  );

  const counts = useMemo(() => {
    let headliners = 0;
    let support = 0;
    for (const row of rows) {
      if (!selected.has(row.id)) continue;
      const t = tierOverrides.get(row.id) ?? row.tier;
      if (t === 'headliner') headliners += 1;
      else support += 1;
    }
    return {
      headliners,
      support,
      unselected: rows.length - selected.size,
      total: rows.length,
    };
  }, [rows, selected, tierOverrides]);

  const submit = useCallback(async () => {
    if (selected.size === 0 || !meta) return;
    const ordered = rows
      .filter((r) => selected.has(r.id))
      .map<SelectedFestivalArtist>((r, i) => {
        const tier = tierOverrides.get(r.id) ?? r.tier;
        return {
          name: r.tmMatch?.name ?? r.name,
          role: tier,
          sortOrder: i,
          tmAttractionId: r.tmMatch?.tmAttractionId,
          imageUrl: r.tmMatch?.imageUrl ?? undefined,
          musicbrainzId: r.tmMatch?.musicbrainzId ?? undefined,
        };
      });
    setPhase('submitting');
    setError(null);
    try {
      await opts.onSubmit(ordered, meta);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setPhase('picking');
    }
  }, [rows, selected, tierOverrides, meta, opts]);

  return {
    phase,
    error,
    meta,
    rows,
    selected,
    counts,
    isMatching,
    extractFromSource,
    toggle,
    setTier,
    setRowName,
    reorder,
    tierFor,
    toggleAll,
    selectAll,
    deselectAll,
    submit,
    reset,
  };
}

export type FestivalLineupFlow = ReturnType<typeof useFestivalLineup>;
