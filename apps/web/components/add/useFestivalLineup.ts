"use client";

import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

export type FestivalArtistTier = "headliner" | "support";

export interface FestivalLineupTmMatch {
  tmAttractionId: string;
  name: string;
  imageUrl: string | null;
  musicbrainzId: string | null;
}

export interface FestivalLineupRow {
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
  | "idle"
  | "extracting"
  | "picking"
  | "submitting"
  | "done"
  | "error";

export interface UseFestivalLineupOptions {
  onSubmit: (
    artists: SelectedFestivalArtist[],
    meta: FestivalLineupMeta,
  ) => Promise<void> | void;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      if (!base64) reject(new Error("Empty file"));
      else resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read error"));
    reader.readAsDataURL(file);
  });

export function useFestivalLineup(opts: UseFestivalLineupOptions) {
  const [phase, setPhase] = useState<FestivalLineupPhase>("idle");
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
    setPhase("idle");
    setError(null);
    setMeta(null);
    setRows([]);
    setSelected(new Set());
    setTierOverrides(new Map());
    setIsMatching(false);
  }, []);

  const runTmMatching = useCallback(
    async (names: string[]) => {
      if (names.length === 0) return;
      setIsMatching(true);
      try {
        // Cap at 50 names per call (server enforces; this just stays under).
        const capped = names.slice(0, 50);
        const result = await matchArtists.mutateAsync({ names: capped });
        const byName = new Map(result.matches.map((m) => [m.name, m]));
        setRows((prev) =>
          prev.map((row) => {
            const match = byName.get(row.name);
            if (!match || !match.tmAttractionId) return row;
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

  const extractFromFile = useCallback(
    async (file: File) => {
      setPhase("extracting");
      setError(null);
      try {
        const base64 = await fileToBase64(file);
        const isPdf =
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf");
        const lineup = await extract.mutateAsync(
          isPdf ? { pdfBase64: base64 } : { imageBase64: base64 },
        );

        const initialRows: FestivalLineupRow[] = lineup.artists.map((a) => ({
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
        // Default to all selected — the user will be unchecking the ones they
        // didn't see, which is faster on a 30-artist poster than checking the
        // 10 they did.
        setSelected(new Set(initialRows.map((r) => r.name)));
        setTierOverrides(new Map());
        setPhase("picking");

        // Kick off TM matching in the background — picker renders immediately
        // with names only and images stream in when matches resolve.
        void runTmMatching(initialRows.map((r) => r.name));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Extraction failed");
        setPhase("error");
      }
    },
    [extract, runTmMatching],
  );

  const toggle = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setTier = useCallback(
    (name: string, tier: FestivalArtistTier) => {
      setTierOverrides((prev) => {
        const next = new Map(prev);
        next.set(name, tier);
        return next;
      });
    },
    [],
  );

  const toggleAll = useCallback(() => {
    setSelected((prev) =>
      prev.size === rows.length
        ? new Set()
        : new Set(rows.map((r) => r.name)),
    );
  }, [rows]);

  const selectAll = useCallback(() => {
    setSelected(new Set(rows.map((r) => r.name)));
  }, [rows]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  const tierFor = useCallback(
    (row: FestivalLineupRow): FestivalArtistTier =>
      tierOverrides.get(row.name) ?? row.tier,
    [tierOverrides],
  );

  const counts = useMemo(() => {
    let headliners = 0;
    let support = 0;
    for (const row of rows) {
      if (!selected.has(row.name)) continue;
      const t = tierOverrides.get(row.name) ?? row.tier;
      if (t === "headliner") headliners += 1;
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
      .filter((r) => selected.has(r.name))
      .map<SelectedFestivalArtist>((r, i) => {
        const tier = tierOverrides.get(r.name) ?? r.tier;
        return {
          name: r.tmMatch?.name ?? r.name,
          role: tier,
          sortOrder: i,
          tmAttractionId: r.tmMatch?.tmAttractionId,
          imageUrl: r.tmMatch?.imageUrl ?? undefined,
          musicbrainzId: r.tmMatch?.musicbrainzId ?? undefined,
        };
      });
    setPhase("submitting");
    setError(null);
    try {
      await opts.onSubmit(ordered, meta);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setPhase("picking");
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
    extractFromFile,
    toggle,
    setTier,
    tierFor,
    toggleAll,
    selectAll,
    deselectAll,
    submit,
    reset,
  };
}

export type FestivalLineupFlow = ReturnType<typeof useFestivalLineup>;
