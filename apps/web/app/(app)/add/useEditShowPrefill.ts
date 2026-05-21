import { useEffect, useState } from "react";
import { normalizePerformerSetlist, singleMainSet, type PerformerSetlist } from "@showbook/shared";
import type { ShowKind } from "@/components/design-system";
import type { CastMember, HeadlinerData, PerformerData, Timeframe, VenueData } from "./types";

/**
 * Hydrates the Add page's form state from a `shows.detail` payload when
 * the page is opened in edit mode (`?editId=`). Tolerates both the new
 * sections-shaped setlists and the legacy `string[]` / top-level
 * `setlist text[]` shapes so un-migrated rows still hydrate cleanly.
 */
export function useEditShowPrefill(args: {
  data: unknown;
  setKind: (v: ShowKind) => void;
  setDate: (v: string) => void;
  setEndDate: (v: string) => void;
  setSeat: (v: string) => void;
  setPricePaid: (v: string) => void;
  setTicketCount: (v: string) => void;
  setTourName: (v: string) => void;
  setSetlistsByPerformer: (v: Record<string, PerformerSetlist>) => void;
  setProductionName: (v: string) => void;
  setNotes: (v: string) => void;
  setHeadlinerName: (v: string) => void;
  setHeadliner: (v: HeadlinerData) => void;
  setVenue: (v: VenueData) => void;
  setVenueQuery: (v: string) => void;
  setPerformers: (v: PerformerData[]) => void;
  setCastMembers: (v: CastMember[]) => void;
  setTimeframe: (v: Timeframe) => void;
}): { editPrefilled: boolean } {
  const [editPrefilled, setEditPrefilled] = useState(false);

  const {
    data,
    setKind, setDate, setEndDate, setSeat, setPricePaid, setTicketCount, setTourName,
    setSetlistsByPerformer, setProductionName, setNotes,
    setHeadlinerName, setHeadliner, setVenue, setVenueQuery,
    setPerformers, setCastMembers, setTimeframe,
  } = args;

  useEffect(() => {
    if (!data || editPrefilled) return;
    const s = data as {
      kind: ShowKind;
      date: string | null;
      endDate?: string | null;
      seat: string | null;
      pricePaid: string | null;
      ticketCount: number | null;
      tourName: string | null;
      setlists?: unknown;
      setlist?: string[];
      productionName: string | null;
      notes: string | null;
      state: string;
      showPerformers: Array<{
        role: string;
        sortOrder: number;
        characterName: string | null;
        performer: {
          id: string;
          name: string;
          musicbrainzId: string | null;
          imageUrl: string | null;
        };
      }>;
      venue: {
        name: string;
        city: string;
        stateRegion: string | null;
        country: string | null;
        ticketmasterVenueId: string | null;
        googlePlaceId: string | null;
        photoUrl: string | null;
        latitude: number | null;
        longitude: number | null;
      };
    };

    setKind(s.kind);
    setDate(s.date ?? "");
    if (s.endDate) setEndDate(s.endDate);
    if (s.seat) setSeat(s.seat);
    if (s.pricePaid) setPricePaid(s.pricePaid);
    if (s.ticketCount) setTicketCount(String(s.ticketCount));
    if (s.tourName) setTourName(s.tourName);
    // Prefill setlists from an existing show. Tolerate both the new
    // sections shape and the legacy `string[]` per-performer shape via
    // normalizePerformerSetlist; fall back to the very-old top-level
    // `setlist text[]` for un-migrated rows.
    if (s.setlists && typeof s.setlists === 'object') {
      const byName: Record<string, PerformerSetlist> = {};
      const allPerfs = s.showPerformers ?? [];
      for (const [pid, raw] of Object.entries(
        s.setlists as Record<string, unknown>,
      )) {
        const setlist = normalizePerformerSetlist(raw);
        if (!setlist) continue;
        const perf = allPerfs.find((sp) => sp.performer.id === pid);
        if (perf) byName[perf.performer.name] = setlist;
      }
      if (Object.keys(byName).length > 0) setSetlistsByPerformer(byName);
    } else if (s.setlist && s.setlist.length > 0) {
      const headlinerPerf = s.showPerformers.find(
        (sp) => sp.role === 'headliner' && sp.sortOrder === 0,
      );
      if (headlinerPerf) {
        setSetlistsByPerformer({
          [headlinerPerf.performer.name]: singleMainSet(s.setlist),
        });
      }
    }

    if (s.productionName) setProductionName(s.productionName);
    if (s.notes) setNotes(s.notes);

    const headlinerPerf = s.showPerformers.find(
      (sp) => sp.role === "headliner" && sp.sortOrder === 0,
    );
    if (headlinerPerf) {
      setHeadlinerName(headlinerPerf.performer.name);
      setHeadliner({
        name: headlinerPerf.performer.name,
        tmAttractionId: undefined,
        musicbrainzId: headlinerPerf.performer.musicbrainzId ?? undefined,
        imageUrl: headlinerPerf.performer.imageUrl ?? undefined,
      });
    }

    // Venue
    setVenue({
      name: s.venue.name,
      city: s.venue.city,
      stateRegion: s.venue.stateRegion ?? undefined,
      country: s.venue.country ?? undefined,
      tmVenueId: s.venue.ticketmasterVenueId ?? undefined,
      googlePlaceId: s.venue.googlePlaceId ?? undefined,
      photoUrl: s.venue.photoUrl ?? undefined,
      lat: s.venue.latitude ?? undefined,
      lng: s.venue.longitude ?? undefined,
    });
    setVenueQuery(s.venue.name);

    // Other performers
    const otherPerfs = s.showPerformers
      .filter((sp) => !(sp.role === "headliner" && sp.sortOrder === 0))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((sp) => ({
        name: sp.performer.name,
        role: sp.role as "headliner" | "support" | "cast",
        characterName: sp.characterName ?? undefined,
        sortOrder: sp.sortOrder,
        musicbrainzId: sp.performer.musicbrainzId ?? undefined,
        imageUrl: sp.performer.imageUrl ?? undefined,
      }));
    setPerformers(otherPerfs);

    // Cast members for theatre
    if (s.kind === "theatre") {
      const cast = s.showPerformers
        .filter((sp) => sp.role === "cast")
        .map((sp) => ({
          actor: sp.performer.name,
          role: sp.characterName ?? "",
        }));
      if (cast.length > 0) setCastMembers(cast);
    }

    // Timeframe
    if (s.state === "past") setTimeframe("past");
    else if (s.state === "ticketed") setTimeframe("upcoming");
    else setTimeframe("watching");

    setEditPrefilled(true);
  }, [
    data, editPrefilled,
    setKind, setDate, setEndDate, setSeat, setPricePaid, setTicketCount, setTourName,
    setSetlistsByPerformer, setProductionName, setNotes,
    setHeadlinerName, setHeadliner, setVenue, setVenueQuery,
    setPerformers, setCastMembers, setTimeframe,
  ]);

  return { editPrefilled };
}
