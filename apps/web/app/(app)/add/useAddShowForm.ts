"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  deriveFollowSuggestions,
  isDatePast,
  setlistTotalSongs,
  type PerformerSetlist,
} from "@showbook/shared";
import { showShowAddedToast } from "@/components/add/ShowAddedToast";
import { trpc } from "@/lib/trpc";
import { useInvalidateSidebarCounts } from "@/lib/sidebar-counts";
import type { ShowKind } from "@/components/design-system";
import {
  useFestivalLineup,
  type SelectedFestivalArtist,
  type FestivalLineupMeta,
} from "@/components/add/useFestivalLineup";
import { useMediaStaging } from "@/components/add/MediaUploadSection";
import { useEditShowPrefill } from "./useEditShowPrefill";
import type {
  CastMember,
  GmailResult,
  HeadlinerData,
  Mode,
  PerformerData,
  Timeframe,
  TMResult,
  VenueData,
} from "./types";

/**
 * Owns every piece of state the Add page renders — kind / timeframe /
 * headliner / venue / lineup / setlists / media staging — plus the
 * derived flags (`canSave`, `isPastEvent`, `provenanceStatuses`,
 * `autoFilledCount`) and the form-side handlers (`handleFormSave`,
 * `handleSelectTmResult`, `handleSelectPlace`, et al.) that the page
 * wires into its inputs.
 *
 * Chat-mode and the per-show Gmail scan are extracted into their own
 * components and consume the underlying tRPC mutations from this hook
 * via the returned `parseChat`, `createShow`, and `scanGmailForShow`
 * mutations. The legacy-shape edit prefill is delegated to
 * `useEditShowPrefill`; the festival lineup extraction picker lives
 * in `useFestivalLineup` and is composed in here so chat-mode can
 * share the same `openFestivalPicker` callback.
 */
export function useAddShowForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const editId = searchParams.get("editId");
  const isEditMode = !!editId;

  // Mode toggle. Chat is the default door — describing the show in one
  // sentence is the lowest-friction path, and mobile is already
  // chat-first. Anything that arrives with structured prefill (edit,
  // a Ticketmaster deep link, the Map page's venue handoff, an explicit
  // ?mode=form) opens the form instead so the prefilled fields are
  // immediately visible.
  const hasFormPrefill = Boolean(
    editId ||
      searchParams.get("tmEventId") ||
      searchParams.get("venueName") ||
      searchParams.get("timeframe"),
  );
  const [mode, setMode] = useState<Mode>(() =>
    hasFormPrefill || searchParams.get("mode") === "form" ? "Form" : "Chat",
  );

  // Form state
  const [timeframe, setTimeframe] = useState<Timeframe>("past");
  const [kind, setKind] = useState<ShowKind | null>(null);
  const [headlinerName, setHeadlinerName] = useState("");
  const [headliner, setHeadliner] = useState<HeadlinerData>({ name: "" });
  const [venue, setVenue] = useState<VenueData>({ name: "", city: "" });
  const [venueQuery, setVenueQuery] = useState("");
  const [debouncedVenueQuery, setDebouncedVenueQuery] = useState("");
  const venueSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const timeframeManuallySet = useRef(false);
  const [tmEnriched, setTmEnriched] = useState(false);
  const [selectedTmEvent, setSelectedTmEvent] = useState<TMResult | null>(null);
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  const [importUrlValue, setImportUrlValue] = useState("");
  const [pdfImporting, setPdfImporting] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // Kind-specific enrichment
  // setlistsByPerformer: keyed by performer name (headliner or support).
  // Stores the section-shaped PerformerSetlist so an encore returned from
  // setlist.fm survives a round-trip through the form.
  const [setlistsByPerformer, setSetlistsByPerformer] = useState<Record<string, PerformerSetlist>>({});
  const [tourName, setTourName] = useState("");
  const [performers, setPerformers] = useState<PerformerData[]>([]);
  const [castMembers, setCastMembers] = useState<CastMember[]>([]);
  const [openerName, setOpenerName] = useState("");
  const [productionName, setProductionName] = useState("");
  const [notes, setNotes] = useState("");

  // Personal data
  const [seat, setSeat] = useState("");
  const [pricePaid, setPricePaid] = useState("");
  const [ticketCount, setTicketCount] = useState("1");
  const [showMoreDetails, setShowMoreDetails] = useState(false);

  // Performer search
  const [performerSearchInput, setPerformerSearchInput] = useState("");
  const [debouncedPerformerQuery, setDebouncedPerformerQuery] = useState("");
  const performerSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const utils = trpc.useUtils();

  // Pre-fill from query params (e.g. navigating from Map page)
  useEffect(() => {
    const tf = searchParams.get("timeframe");
    if (tf === "past" || tf === "upcoming" || tf === "watching") {
      setTimeframe(tf);
    }
    const venueName = searchParams.get("venueName");
    const venueCity = searchParams.get("venueCity");
    if (venueName) {
      setVenue((v) => ({
        ...v,
        name: venueName,
        city: venueCity ?? v.city,
      }));
    }
  }, [searchParams]);

  // TM search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Ticketmaster event search powers the headliner picker for concerts /
  // theatre / comedy (it auto-fills venue + date from the picked event).
  // Festivals are built up by name + lineup, so picking a one-off TM event
  // is the wrong abstraction — we use the artist search below instead.
  const tmSearch = trpc.enrichment.searchTM.useQuery(
    { headliner: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 && kind !== "festival" },
  );

  // Artist (TM attraction) search — returns artists, not events. Used for the
  // festival headliner picker and the "+ search artists" lineup add input so
  // those flows never surface ticketmaster events.
  const festivalHeadlinerSearch = trpc.performers.searchExternal.useQuery(
    { query: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 && kind === "festival" },
  );
  // The lineup add input. For theatre the kind routes searchExternal to
  // Wikidata (cast members have no Ticketmaster page); every other kind
  // keeps the TM attraction search.
  const performerArtistSearch = trpc.performers.searchExternal.useQuery(
    { query: debouncedPerformerQuery, kind: kind ?? undefined },
    { enabled: debouncedPerformerQuery.length >= 2 },
  );

  const fetchTMEvent = trpc.enrichment.fetchTMEventByUrl.useMutation();

  // Places venue search
  const venueSearch = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedVenueQuery, types: "venue" },
    { enabled: debouncedVenueQuery.length >= 2 && !tmEnriched },
  );

  // Auto-fetch headliner setlist for past concerts
  const isPastConcert =
    kind === "concert" && !!date && new Date(date) < new Date();

  // Media uploads are gated to events that have already happened. Use the
  // run's last day so a multi-night festival isn't "past" until after the
  // closing night.
  const isPastEvent = useMemo(() => {
    const lastDay = endDate || date;
    return Boolean(lastDay && isDatePast(lastDay));
  }, [date, endDate]);

  const setlistQuery = trpc.enrichment.fetchSetlist.useQuery(
    { performerName: headliner.name, date },
    {
      enabled:
        !!isPastConcert && headliner.name.length > 0 && date.length > 0,
    },
  );
  // Track which performers have a pending setlist fetch
  const [fetchingSetlistFor, setFetchingSetlistFor] = useState<Record<string, boolean>>({});

  // Mutations
  const parseChat = trpc.enrichment.parseChat.useMutation();
  const extractCast = trpc.enrichment.extractCast.useMutation();
  const extractFromPdf = trpc.enrichment.extractFromPdf.useMutation();
  const invalidateSidebarCounts = useInvalidateSidebarCounts();
  // Undo for create reuses the same delete mutation. Silenced so the
  // "Show removed" toast isn't shadowed by the generic "Show deleted"
  // surface that ShowDetailTabsView and the context menu use.
  const undoDelete = trpc.shows.delete.useMutation({
    meta: { errorToast: false },
  });
  const createShow = trpc.shows.create.useMutation({
    onSuccess: (data) => {
      utils.shows.invalidate();
      invalidateSidebarCounts();
      if (data?.id) {
        // Follow seeding: the user just told us which artist and venue
        // they care about — offer the follow right in the save
        // confirmation. Already-followed entities are filtered against
        // whatever follow lists are in the query cache; when the cache
        // is cold we still offer (both mutations are idempotent).
        const suggestions = deriveFollowSuggestions(data, {
          followedPerformerIds: utils.performers.followed
            .getData()
            ?.map((p) => p.id),
          followedVenueIds: utils.venues.followed.getData()?.map((v) => v.id),
        });
        showShowAddedToast({
          performer: suggestions.performer,
          venue: suggestions.venue,
          handlers: {
            onUndo: async () => {
              try {
                await undoDelete.mutateAsync({ showId: data.id });
                utils.shows.invalidate();
                invalidateSidebarCounts();
                toast.success("Show removed");
                router.push("/home");
              } catch {
                toast.error("Couldn't undo — try again");
              }
            },
            onFollowPerformer: async (performerId) => {
              await utils.client.performers.follow.mutate({ performerId });
              void utils.performers.followed.invalidate();
            },
            onFollowVenue: async (venueId) => {
              await utils.client.venues.follow.mutate({ venueId });
              void utils.venues.followed.invalidate();
            },
          },
        });
      }
    },
  });
  const updateShow = trpc.shows.update.useMutation({
    meta: { successToast: "Show updated" },
    onSuccess: () => {
      utils.shows.invalidate();
      invalidateSidebarCounts();
    },
  });
  const createUploadIntent = trpc.media.createUploadIntent.useMutation();
  const completeUpload = trpc.media.completeUpload.useMutation();

  // Staged media uploads (processed after show is created)
  const media = useMediaStaging({ isPastEvent });

  // Fetch existing show for edit mode
  const editQuery = trpc.shows.detail.useQuery(
    { showId: editId! },
    { enabled: isEditMode },
  );

  useEditShowPrefill({
    data: editQuery.data,
    setKind, setDate, setEndDate, setSeat, setPricePaid, setTicketCount, setTourName,
    setSetlistsByPerformer, setProductionName, setNotes,
    setHeadlinerName, setHeadliner, setVenue, setVenueQuery,
    setPerformers, setCastMembers, setTimeframe,
  });

  // Gmail
  const scanGmailForShow = trpc.enrichment.scanGmailForShow.useMutation();

  // Count auto-filled fields
  const autoFilledCount = useMemo(() => {
    let count = 0;
    if (tmEnriched) {
      if (venue.name) count++;
      if (venue.city) count++;
      if (date) count++;
      if (headliner.tmAttractionId) count++;
      if (performers.length > 0) count++;
    }
    if (Object.keys(setlistsByPerformer).length > 0) count++;
    if (tourName && setlistQuery.data && kind !== "festival") count++;
    return count;
  }, [tmEnriched, venue, date, headliner, performers, setlistsByPerformer, tourName, setlistQuery.data, kind]);

  // ── Handlers ─────────────────────────────────────────────

  const handleHeadlinerInput = useCallback(
    (value: string) => {
      setHeadlinerName(value);
      setHeadliner((prev) => ({ ...prev, name: value }));
      setSelectedTmEvent(null);
      setTmEnriched(false);

      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (value.length >= 2) {
        searchTimerRef.current = setTimeout(() => {
          setDebouncedQuery(value);
        }, 500);
      } else {
        setDebouncedQuery("");
      }
    },
    [],
  );

  const handleDateChange = useCallback((value: string) => {
    setDate(value);
    if (!timeframeManuallySet.current && value) {
      const d = new Date(value + "T12:00:00");
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (d < today) {
        setTimeframe("past");
      } else if (timeframe !== "upcoming") {
        setTimeframe("watching");
      }
    }
  }, [timeframe]);

  const handleSelectTmResult = useCallback(
    (result: TMResult) => {
      setSelectedTmEvent(result);
      setTmEnriched(true);
      setVenue({
        name: result.venueName ?? "",
        city: result.venueCity ?? "",
        stateRegion: result.venueState ?? undefined,
        country: result.venueCountry ?? undefined,
        tmVenueId: result.venueTmId ?? undefined,
        lat: result.venueLat ?? undefined,
        lng: result.venueLng ?? undefined,
      });
      setDate(result.date);

      const mappedKind = result.kind?.toLowerCase();
      const resultKind: ShowKind | null =
        mappedKind === "concert" ||
        mappedKind === "theatre" ||
        mappedKind === "comedy" ||
        mappedKind === "festival"
          ? mappedKind
          : null;
      if (resultKind) setKind(resultKind);

      // Theatre + festival are identified by a production / festival
      // name on the show row, not a headliner performer. For a festival
      // the event's attractions are the lineup; theatre cast comes from
      // a playbill later, so no performers are pre-filled.
      if (resultKind === "theatre" || resultKind === "festival") {
        setProductionName((prev) => prev || result.name);
        setHeadlinerName("");
        setHeadliner({ name: "" });
        setPerformers(
          resultKind === "festival"
            ? result.performers.map((p, i) => ({
                name: p.name,
                role: "support" as const,
                sortOrder: i + 1,
                tmAttractionId: p.tmAttractionId,
                imageUrl: p.imageUrl ?? undefined,
              }))
            : [],
        );
        return;
      }

      // Concert / comedy: first attraction is the headliner, the rest
      // are support acts.
      setHeadlinerName(result.performers[0]?.name ?? result.name);
      setHeadliner({
        name: result.performers[0]?.name ?? result.name,
        tmAttractionId: result.performers[0]?.tmAttractionId,
        imageUrl: result.performers[0]?.imageUrl ?? undefined,
      });
      if (result.performers.length > 1) {
        setPerformers(
          result.performers.slice(1).map((p, i) => ({
            name: p.name,
            role: "support" as const,
            sortOrder: i + 1,
            tmAttractionId: p.tmAttractionId,
            imageUrl: p.imageUrl ?? undefined,
          })),
        );
      }
    },
    [],
  );

  // Chat-mode "did you mean one of these?" hands a picked Ticketmaster
  // event straight into the structured form: reuse the same prefill the
  // Form-mode TM picker uses, carry over the seat the user mentioned,
  // then flip to Form so they can review before saving.
  const handleChatTmEventSelected = useCallback(
    (result: TMResult, seatHint: string | null) => {
      handleSelectTmResult(result);
      if (seatHint) setSeat(seatHint);
      setMode("Form");
    },
    [handleSelectTmResult],
  );

  // Imperative Ticketmaster event search for chat mode — the chat
  // component runs it after the LLM parse to offer event matches.
  const searchTMEvents = useCallback(
    (args: { headliner: string; startDate?: string; endDate?: string }) =>
      utils.enrichment.searchTM.fetch(args),
    [utils],
  );

  // Prefill from a Ticketmaster event id — the deep link the global
  // search "Future shows" section uses. Re-fetch the full event so the
  // headliner, lineup, venue, and date all land on the form. Runs once;
  // skipped in edit mode (an editId prefill takes precedence).
  const tmEventId = searchParams.get("tmEventId");
  const tmPrefillRef = useRef(false);
  useEffect(() => {
    if (!tmEventId || isEditMode || tmPrefillRef.current) return;
    tmPrefillRef.current = true;
    fetchTMEvent
      .mutateAsync({ url: tmEventId })
      .then((result) => handleSelectTmResult(result))
      .catch(() => {
        toast.error("Couldn't load that event from Ticketmaster");
      });
  }, [tmEventId, isEditMode, fetchTMEvent, handleSelectTmResult]);

  const handleImportFromUrl = useCallback(async () => {
    if (!importUrlValue.trim()) return;
    try {
      const result = await fetchTMEvent.mutateAsync({ url: importUrlValue.trim() });
      handleSelectTmResult(result);
      setImportUrlOpen(false);
      setImportUrlValue("");
    } catch {
      // Error state surfaced via fetchTMEvent.isError in the UI
    }
  }, [importUrlValue, fetchTMEvent, handleSelectTmResult]);

  const handlePdfImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfImporting(true);
    setPdfError(null);

    try {
      const reader = new FileReader();
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.split(",")[1]!);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await extractFromPdf.mutateAsync({ fileBase64 });

      if (result.headliner) {
        setHeadlinerName(result.headliner);
        setHeadliner({ name: result.headliner });
      }
      if (result.venue_name) {
        setVenue((prev) => ({
          ...prev,
          name: result.venue_name ?? prev.name,
          city: result.venue_city ?? prev.city,
          stateRegion: result.venue_state ?? prev.stateRegion,
        }));
        setVenueQuery(result.venue_name);
      }
      if (result.date) setDate(result.date);
      if (result.seat) setSeat(result.seat);
      if (result.price) setPricePaid(result.price);
      if (result.ticket_count) setTicketCount(String(result.ticket_count));
      if (result.production_name) setProductionName(result.production_name);
      if (result.kind_hint) setKind(result.kind_hint);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : "Failed to extract from PDF");
    } finally {
      setPdfImporting(false);
      if (pdfInputRef.current) pdfInputRef.current.value = "";
    }
  }, [extractFromPdf]);

  // ── Festival poster / schedule upload ─────────────────────────
  const [festivalModalOpen, setFestivalModalOpen] = useState(false);
  const festivalFileInputRef = useRef<HTMLInputElement>(null);

  const handleFestivalSubmit = useCallback(
    async (artists: SelectedFestivalArtist[], meta: FestivalLineupMeta) => {
      // Write back to form state so the user lands on the structured
      // form with festival name, date(s), venue hint, and lineup
      // pre-populated — they can edit the name and venue before the
      // actual save click. Chat mode flips to Form so the user sees
      // what's about to be created.
      if (kind !== "festival") setKind("festival");
      if (meta.festivalName) {
        setProductionName((prev) => prev || meta.festivalName!);
      }
      if (meta.startDate) {
        setDate((prev) => prev || meta.startDate!);
      }
      if (meta.endDate) {
        setEndDate((prev) => prev || meta.endDate!);
      }
      if (meta.venueHint) {
        setVenue((prev) =>
          prev.name
            ? prev
            : { ...prev, name: meta.venueHint!, city: prev.city || "" },
        );
        setVenueQuery((prev) => prev || meta.venueHint!);
      }
      setPerformers(
        artists.map((a) => ({
          name: a.name,
          role: a.role,
          sortOrder: a.sortOrder,
          tmAttractionId: a.tmAttractionId,
          imageUrl: a.imageUrl,
          musicbrainzId: a.musicbrainzId,
        })),
      );
      setFestivalModalOpen(false);
      if (mode === "Chat") setMode("Form");
    },
    [mode, kind],
  );

  const festivalFlow = useFestivalLineup({ onSubmit: handleFestivalSubmit });

  const openFestivalPicker = useCallback(
    async (file: File) => {
      setFestivalModalOpen(true);
      await festivalFlow.extractFromFile(file);
    },
    [festivalFlow],
  );

  const handleFestivalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so the same filename can be re-selected later.
      e.target.value = "";
      if (!file) return;
      await openFestivalPicker(file);
    },
    [openFestivalPicker],
  );

  const handlePlaybillUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        if (!base64) return;
        try {
          const result = await extractCast.mutateAsync({ imageBase64: base64 });
          setCastMembers(result.cast);
          setPerformers(
            result.cast.map((c: CastMember, i: number) => ({
              name: c.actor,
              role: "cast" as const,
              characterName: c.role,
              sortOrder: i + 1,
            })),
          );
        } catch {
          // Extraction failed silently; user can add manually
        }
      };
      reader.readAsDataURL(file);
    },
    [extractCast],
  );

  const handleSelectGmailResult = useCallback(
    (result: GmailResult) => {
      if (result.headliner) {
        setHeadlinerName(result.headliner);
        setHeadliner({ name: result.headliner });
      }
      if (result.venue_name) {
        setVenue((prev) => ({
          ...prev,
          name: result.venue_name ?? prev.name,
          city: result.venue_city ?? prev.city,
          stateRegion: result.venue_state ?? prev.stateRegion,
        }));
      }
      if (result.date) setDate(result.date);
      if (result.seat) setSeat(result.seat);
      if (result.price) setPricePaid(result.price);
      if (result.ticket_count) setTicketCount(String(result.ticket_count));
      if (result.production_name) setProductionName(result.production_name);
      if (result.kind_hint) setKind(result.kind_hint);
    },
    [],
  );

  // Auto-fill headliner setlist + capture the resolved MusicBrainz ID when
  // the query resolves. The MBID lands on the headliner row even if
  // setlist.fm has no setlist for this date (in which case `data.setlist`
  // is null) — without this, the Add flow loses every MBID for shows
  // setlist.fm couldn't find a setlist for.
  useEffect(() => {
    if (!setlistQuery.data || !headliner.name) return;
    const data = setlistQuery.data;
    if (data.setlist) {
      setSetlistsByPerformer((prev) => ({
        ...prev,
        [headliner.name]: data.setlist!,
      }));
    }
    if (data.tourName) {
      setTourName(data.tourName);
    }
    if (data.mbid) {
      setHeadliner((prev) =>
        prev.musicbrainzId === data.mbid
          ? prev
          : { ...prev, musicbrainzId: data.mbid },
      );
    }
  }, [setlistQuery.data, headliner.name]);

  // Auto-fetch support performer setlists for past concerts.
  // Mirrors the headliner useQuery above but loops over the dynamic
  // performers array. The Set tracks attempted name+date combos so we
  // don't refetch on every render or clobber manual edits.
  const supportSetlistAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isPastConcert || !date) return;
    for (const p of performers) {
      if (p.role !== "support" || !p.name) continue;
      const key = `${p.name} ${date}`;
      if (supportSetlistAttemptedRef.current.has(key)) continue;
      supportSetlistAttemptedRef.current.add(key);
      const performerName = p.name;
      setFetchingSetlistFor((prev) => ({ ...prev, [performerName]: true }));
      utils.enrichment.fetchSetlist
        .fetch({ performerName, date })
        .then((result) => {
          if (!result) return;
          if (result.mbid) {
            // Persist the resolved MBID on the matching support performer
            // even when no setlist was returned. Match on name (the user
            // can't have two support performers with the same name in
            // one show — the form prevents it).
            setPerformers((prev) =>
              prev.map((pp) =>
                pp.name === performerName && !pp.musicbrainzId
                  ? { ...pp, musicbrainzId: result.mbid }
                  : pp,
              ),
            );
          }
          if (result.setlist && setlistTotalSongs(result.setlist) > 0) {
            setSetlistsByPerformer((prev) => ({
              ...prev,
              [performerName]: result.setlist!,
            }));
          }
        })
        .finally(() => {
          setFetchingSetlistFor((prev) => ({ ...prev, [performerName]: false }));
        });
    }
  }, [performers, date, isPastConcert, utils]);

  const handleFormSave = useCallback(async () => {
    const needsHeadliner = kind !== "theatre" && kind !== "festival";
    const needsProductionName = kind === "theatre" || kind === "festival";
    if (!kind || !venue.name || !venue.city || !date) return;
    if (needsHeadliner && !headliner.name) return;
    if (needsProductionName && !productionName) return;

    let allPerformers = [...performers];

    if (kind === "comedy" && openerName.trim()) {
      allPerformers = [
        ...allPerformers,
        {
          name: openerName.trim(),
          role: "support" as const,
          sortOrder: allPerformers.length + 1,
        },
      ];
    }

    try {
      let venueToSave = { ...venue };

      if (venueToSave.lat == null && venueToSave.name && venueToSave.city) {
        try {
          const geo = await utils.enrichment.geocodeVenue.fetch({
            venueName: venueToSave.name,
            city: venueToSave.city,
          });
          if (geo) {
            venueToSave = {
              ...venueToSave,
              lat: geo.lat,
              lng: geo.lng,
              stateRegion: venueToSave.stateRegion ?? geo.stateRegion,
              country: venueToSave.country ?? geo.country,
              googlePlaceId: venueToSave.googlePlaceId ?? geo.googlePlaceId,
              photoUrl: venueToSave.photoUrl ?? geo.photoUrl,
            };
          }
        } catch {
          // Geocoding failed; save without coordinates
        }
      }

      // Attach per-performer setlists to performers; headliner gets its own field
      const headlinerSetlist = headliner.name ? setlistsByPerformer[headliner.name] : undefined;
      const performersWithSetlists = allPerformers.map((p) => ({
        ...p,
        setlist: setlistsByPerformer[p.name] ?? undefined,
      }));

      const payload = {
        kind,
        headliner: headliner.name
          ? { ...headliner, setlist: headlinerSetlist }
          : { name: productionName || "Unknown" },
        venue: venueToSave,
        date,
        endDate: endDate || undefined,
        seat: kind === "festival" ? undefined : (seat || undefined),
        pricePaid: pricePaid || undefined,
        ticketCount: parseInt(ticketCount) || 1,
        tourName: kind === "festival" ? undefined : (tourName || undefined),
        productionName: productionName || undefined,
        notes: notes || undefined,
        performers: performersWithSetlists.length > 0 ? performersWithSetlists : undefined,
      };

      let targetShowId: string;
      let targetShowPerformers: Array<{ performer?: { id?: string; name?: string } | null } | null | undefined>;
      if (isEditMode && editId) {
        const updated = await updateShow.mutateAsync({ showId: editId, ...payload });
        targetShowId = editId;
        targetShowPerformers = updated?.showPerformers ?? editQuery.data?.showPerformers ?? [];
      } else {
        const created = await createShow.mutateAsync(payload);
        if (!created) {
          router.push("/home");
          return;
        }
        targetShowId = created.id;
        targetShowPerformers = created.showPerformers ?? [];
      }

      const uploadResult = await media.runUploads({
        targetShowId,
        targetShowPerformers,
        createUploadIntent: (input) => createUploadIntent.mutateAsync(input),
        completeUpload: (input) => completeUpload.mutateAsync(input) as Promise<unknown>,
      });
      if (!uploadResult.ok) {
        // Show is saved; let user see the partial-failure summary before navigating.
        return;
      }
      router.push(`/shows/${targetShowId}`);
    } catch {
      // Error is surfaced via mutation isError in the UI
      media.setMediaUploadStatus(null);
    }
  }, [
    kind,
    headliner,
    venue,
    date,
    endDate,
    seat,
    pricePaid,
    ticketCount,
    tourName,
    productionName,
    notes,
    setlistsByPerformer,
    performers,
    openerName,
    createShow,
    updateShow,
    isEditMode,
    editId,
    editQuery.data,
    utils,
    createUploadIntent,
    completeUpload,
    router,
    media,
  ]);

  const handleVenueInput = useCallback((value: string) => {
    setVenueQuery(value);
    setVenue((v) => ({ ...v, name: value, city: v.city }));
    if (venueSearchTimerRef.current) clearTimeout(venueSearchTimerRef.current);
    if (value.length >= 2) {
      venueSearchTimerRef.current = setTimeout(() => setDebouncedVenueQuery(value), 400);
    } else {
      setDebouncedVenueQuery("");
    }
  }, []);

  const handleSelectPlace = useCallback(async (placeId: string) => {
    try {
      const details = await utils.enrichment.placeDetails.fetch({ placeId });
      if (details) {
        setVenue({
          name: details.name,
          city: details.city,
          stateRegion: details.stateRegion ?? undefined,
          country: details.country,
          lat: details.latitude,
          lng: details.longitude,
          googlePlaceId: details.googlePlaceId,
          photoUrl: details.photoUrl ?? undefined,
        });
        setVenueQuery(details.name);
        setDebouncedVenueQuery("");
      }
    } catch { /* place details failed, user can enter manually */ }
  }, [utils]);

  const handlePerformerSearchInput = useCallback((value: string) => {
    setPerformerSearchInput(value);
    if (performerSearchTimerRef.current) clearTimeout(performerSearchTimerRef.current);
    if (value.length >= 2) {
      performerSearchTimerRef.current = setTimeout(() => {
        setDebouncedPerformerQuery(value);
      }, 500);
    } else {
      setDebouncedPerformerQuery("");
    }
  }, []);

  const handleAddPerformer = useCallback(() => {
    if (!performerSearchInput.trim()) return;
    setPerformers((prev) => [
      ...prev,
      {
        name: performerSearchInput.trim(),
        role: "support",
        sortOrder: prev.length + 1,
      },
    ]);
    setPerformerSearchInput("");
    setDebouncedPerformerQuery("");
  }, [performerSearchInput]);

  const handleSelectArtistAsPerformer = useCallback(
    (artist: {
      tmAttractionId?: string | null;
      wikidataQid?: string | null;
      name: string;
      imageUrl: string | null;
      musicbrainzId: string | null;
    }) => {
      setPerformers((prev) => [
        ...prev,
        {
          name: artist.name,
          // Theatre lineups are cast (each with a character name); every
          // other kind adds support acts.
          role: kind === "theatre" ? "cast" : "support",
          sortOrder: prev.length + 1,
          tmAttractionId: artist.tmAttractionId ?? undefined,
          wikidataQid: artist.wikidataQid ?? undefined,
          musicbrainzId: artist.musicbrainzId ?? undefined,
          imageUrl: artist.imageUrl ?? undefined,
        },
      ]);
      setPerformerSearchInput("");
      setDebouncedPerformerQuery("");
    },
    [kind],
  );

  const handleSelectArtistAsHeadliner = useCallback(
    (artist: { tmAttractionId?: string | null; name: string; imageUrl: string | null; musicbrainzId: string | null }) => {
      setHeadlinerName(artist.name);
      setHeadliner({
        name: artist.name,
        tmAttractionId: artist.tmAttractionId ?? undefined,
        musicbrainzId: artist.musicbrainzId ?? undefined,
        imageUrl: artist.imageUrl ?? undefined,
      });
      setSelectedTmEvent(null);
      setTmEnriched(false);
      setDebouncedQuery("");
    },
    [],
  );

  const handleRemovePerformer = useCallback((index: number) => {
    setPerformers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleTogglePerformerRole = useCallback((index: number) => {
    setPerformers((prev) =>
      prev.map((p, i) =>
        i === index
          ? { ...p, role: p.role === "headliner" ? "support" : "headliner" }
          : p,
      ),
    );
  }, []);

  // Theatre cast — the character each actor played (e.g. "Elphaba").
  const handleUpdatePerformerCharacterName = useCallback(
    (index: number, value: string) => {
      setPerformers((prev) =>
        prev.map((p, i) =>
          i === index ? { ...p, characterName: value } : p,
        ),
      );
    },
    [],
  );

  // Drops the headliner-search dropdown without changing what's in the
  // input. Used by the "Use <typed name>" manual-entry button and after
  // a TM-result row is clicked, both of which want to keep the typed
  // text but suppress further suggestions.
  const clearHeadlinerSearch = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setDebouncedQuery("");
  }, []);

  // Adopt the typed-but-unmatched headliner name as a free-text entry:
  // drop any TM-enriched venue/date, clear the picker dropdown, and
  // collapse the headliner object back to just `{ name }`.
  const useManualHeadliner = useCallback(() => {
    setHeadliner({
      name: headlinerName,
      tmAttractionId: undefined,
      musicbrainzId: undefined,
      imageUrl: undefined,
    });
    setSelectedTmEvent(null);
    setTmEnriched(false);
    clearHeadlinerSearch();
  }, [headlinerName, clearHeadlinerSearch]);

  // Determine if form can save
  const hasValidVenue = venue.name.length > 0 && venue.city.length > 0;
  const hasIdentity = (kind === "theatre" || kind === "festival") ? productionName.length > 0 : headliner.name.length > 0;
  const canSave = kind !== null && hasIdentity && hasValidVenue && date.length > 0;

  // Provenance statuses derived from state
  const provenanceStatuses = useMemo(() => {
    return [
      {
        source: "setlist.fm",
        what: (() => {
          const total = Object.values(setlistsByPerformer).reduce(
            (sum, sl) => sum + setlistTotalSongs(sl),
            0,
          );
          return total > 0 ? `${total} songs${tourName ? ` · ${tourName}` : ""}` : "tour, setlist";
        })(),
        status: setlistQuery.isLoading ? "pending" : Object.keys(setlistsByPerformer).length > 0 ? "ok" : setlistQuery.isFetched ? "skipped" : isPastConcert ? "pending" : "skipped",
      },
      {
        source: "ticketmaster",
        what: "venue, date, seat, price",
        status: tmEnriched ? "ok" : debouncedQuery.length >= 2 ? (tmSearch.isLoading ? "pending" : "skipped") : (venue.name && date ? "skipped" : "pending"),
      },
      {
        source: "playbill",
        what: "cast on this night",
        status: castMembers.length > 0 ? "ok" : kind === "theatre" ? "pending" : "skipped",
      },
      {
        source: "musicbrainz",
        what: "artist disambiguation",
        status: headliner.name ? "ok" : "pending",
      },
      {
        source: "photos",
        what: "local images",
        status: "pending",
      },
    ];
  }, [setlistsByPerformer, tourName, setlistQuery.isLoading, setlistQuery.isFetched, isPastConcert, tmEnriched, debouncedQuery, tmSearch.isLoading, castMembers, kind, headliner, venue.name, date]);

  return {
    // routing / mode
    router,
    mode, setMode,
    isEditMode, editId,
    editQuery,

    // fields
    timeframe, setTimeframe, timeframeManuallySet,
    kind, setKind,
    headlinerName, setHeadlinerName,
    headliner, setHeadliner,
    venue, setVenue,
    venueQuery, setVenueQuery,
    debouncedVenueQuery,
    date, setDate,
    endDate, setEndDate,
    tmEnriched,
    selectedTmEvent,
    importUrlOpen, setImportUrlOpen,
    importUrlValue, setImportUrlValue,
    pdfImporting, pdfError, pdfInputRef,

    setlistsByPerformer, setSetlistsByPerformer,
    tourName, setTourName,
    performers, setPerformers,
    castMembers,
    openerName, setOpenerName,
    productionName, setProductionName,
    notes, setNotes,

    seat, setSeat,
    pricePaid, setPricePaid,
    ticketCount, setTicketCount,
    showMoreDetails, setShowMoreDetails,

    performerSearchInput,
    debouncedPerformerQuery,
    debouncedQuery,

    // queries / mutations
    utils,
    tmSearch, festivalHeadlinerSearch, performerArtistSearch,
    fetchTMEvent,
    venueSearch,
    setlistQuery,
    createShow, updateShow,
    extractCast, extractFromPdf,
    parseChat,
    scanGmailForShow,
    createUploadIntent, completeUpload,

    // derived
    isPastConcert, isPastEvent,
    fetchingSetlistFor, setFetchingSetlistFor,
    hasValidVenue, hasIdentity, canSave,
    autoFilledCount, provenanceStatuses,

    // festival
    festivalFlow,
    festivalModalOpen, setFestivalModalOpen,
    festivalFileInputRef,
    openFestivalPicker,
    handleFestivalFileChange,

    // media
    media,

    // handlers
    handleHeadlinerInput,
    handleDateChange,
    handleSelectTmResult,
    handleChatTmEventSelected,
    searchTMEvents,
    handleImportFromUrl,
    handlePdfImport,
    handlePlaybillUpload,
    handleSelectGmailResult,
    handleFormSave,
    handleVenueInput, handleSelectPlace,
    handlePerformerSearchInput,
    handleAddPerformer,
    handleSelectArtistAsPerformer,
    handleSelectArtistAsHeadliner,
    handleRemovePerformer,
    handleTogglePerformerRole,
    handleUpdatePerformerCharacterName,
    clearHeadlinerSearch,
    useManualHeadliner,
  };
}

export type AddShowForm = ReturnType<typeof useAddShowForm>;
