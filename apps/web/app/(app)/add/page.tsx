"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { type ShowKind } from "@/components/design-system";

// ── Types ────────────────────────────────────────────────────

type Mode = "Form" | "Chat";
type Timeframe = "past" | "upcoming" | "watching";

interface VenueData {
  name: string;
  city: string;
  stateRegion?: string;
  country?: string;
  tmVenueId?: string;
  googlePlaceId?: string;
  lat?: number;
  lng?: number;
}

interface HeadlinerData {
  name: string;
  tmAttractionId?: string;
  imageUrl?: string;
}

interface PerformerData {
  name: string;
  role: "headliner" | "support" | "cast";
  characterName?: string;
  sortOrder: number;
  tmAttractionId?: string;
  imageUrl?: string;
}

interface TMResult {
  tmEventId: string;
  name: string;
  date: string;
  venueName: string | null;
  venueCity: string | null;
  venueState: string | null;
  venueCountry: string | null;
  venueTmId: string | null;
  venueLat: number | null;
  venueLng: number | null;
  kind: string | null;
  performers: {
    name: string;
    tmAttractionId: string;
    imageUrl: string | null;
  }[];
}

interface CastMember {
  actor: string;
  role: string;
}

// ── Constants ────────────────────────────────────────────────

const KIND_CONFIG: {
  kind: ShowKind;
  label: string;
  icon: string;
  enrichmentHint: string;
}[] = [
  { kind: "concert", label: "Concert", icon: "♫", enrichmentHint: "setlist.fm" },
  { kind: "theatre", label: "Theatre", icon: "🎭", enrichmentHint: "playbill" },
  { kind: "comedy", label: "Comedy", icon: "🎙", enrichmentHint: "tour · material" },
  { kind: "festival", label: "Festival", icon: "★", enrichmentHint: "multi-day lineup" },
];

const TIMEFRAME_CONFIG: {
  key: Timeframe;
  label: string;
  sub: string;
}[] = [
  { key: "past", label: "past", sub: "already went" },
  { key: "upcoming", label: "upcoming", sub: "have tickets" },
  { key: "watching", label: "watching", sub: "radar · no tix" },
];

const IMPORT_SOURCES = [
  { tag: "url", label: "Ticketmaster URL", sub: "paste a link" },
  { tag: "pdf", label: "PDF ticket", sub: "drag or upload" },
  { tag: "mail", label: "Gmail receipts", sub: "scan inbox" },
];

const PROVENANCE_ROWS = [
  { source: "setlist.fm", what: "tour, setlist", defaultStatus: "pending" },
  { source: "ticketmaster", what: "venue, date, seat, price", defaultStatus: "pending" },
  { source: "playbill", what: "cast on this night", defaultStatus: "pending" },
  { source: "musicbrainz", what: "artist disambiguation", defaultStatus: "pending" },
  { source: "photos", what: "local images", defaultStatus: "pending" },
] as const;

// ── Styles ───────────────────────────────────────────────────

const mono = "var(--font-geist-mono), monospace";
const sans = "var(--font-geist-sans), sans-serif";

// ── Main Component ───────────────────────────────────────────

export default function AddPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Mode toggle
  const [mode, setMode] = useState<Mode>("Form");

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
  const [tmEnriched, setTmEnriched] = useState(false);
  const [selectedTmEvent, setSelectedTmEvent] = useState<TMResult | null>(null);
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  const [importUrlValue, setImportUrlValue] = useState("");

  // Kind-specific enrichment
  const [setlist, setSetlist] = useState<string[] | null>(null);
  const [tourName, setTourName] = useState("");
  const [performers, setPerformers] = useState<PerformerData[]>([]);
  const [castMembers, setCastMembers] = useState<CastMember[]>([]);
  const [openerName, setOpenerName] = useState("");
  const [festivalHeadliners, setFestivalHeadliners] = useState("");

  // Personal data
  const [seat, setSeat] = useState("");
  const [pricePaid, setPricePaid] = useState("");

  // Chat state
  const [chatMessages, setChatMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([
    {
      role: "assistant",
      content:
        'Tell me about a show you saw or are going to see. For example: "Saw Radiohead at MSG on March 15, section 204"',
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatParsed, setChatParsed] = useState<{
    headliner: string;
    venue_hint: string | null;
    date_hint: string | null;
    seat_hint: string | null;
    kind_hint: ShowKind | null;
  } | null>(null);
  const [chatConfirmed, setChatConfirmed] = useState(false);

  // Gmail scan state
  const [gmailScanning, setGmailScanning] = useState(false);
  const [gmailResults, setGmailResults] = useState<
    Array<{
      headliner: string;
      venue_name: string | null;
      venue_city: string | null;
      date: string | null;
      seat: string | null;
      price: string | null;
      kind_hint: "concert" | "theatre" | "comedy" | "festival" | null;
      confidence: "high" | "medium" | "low";
    }>
  >([]);
  const [gmailShowResults, setGmailShowResults] = useState(false);

  // Performer search
  const [performerSearchInput, setPerformerSearchInput] = useState("");

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

  const tmSearch = trpc.enrichment.searchTM.useQuery(
    { headliner: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 },
  );

  const fetchTMEvent = trpc.enrichment.fetchTMEventByUrl.useMutation();

  // Places venue search
  const venueSearch = trpc.enrichment.searchPlaces.useQuery(
    { query: debouncedVenueQuery, types: "venue" },
    { enabled: debouncedVenueQuery.length >= 2 && !tmEnriched },
  );

  // Setlist fetch
  const isPastConcert =
    kind === "concert" && date && new Date(date) < new Date();
  const setlistQuery = trpc.enrichment.fetchSetlist.useQuery(
    { performerName: headliner.name, date },
    {
      enabled:
        !!isPastConcert && headliner.name.length > 0 && date.length > 0,
    },
  );

  // Mutations
  const parseChat = trpc.enrichment.parseChat.useMutation();
  const extractCast = trpc.enrichment.extractCast.useMutation();
  const createShow = trpc.shows.create.useMutation({
    onSuccess: () => {
      router.push("/shows");
    },
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
    if (setlist && setlist.length > 0) count++;
    if (tourName && setlistQuery.data) count++;
    return count;
  }, [tmEnriched, venue, date, headliner, performers, setlist, tourName, setlistQuery.data]);

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

  const handleSelectTmResult = useCallback(
    (result: TMResult) => {
      setSelectedTmEvent(result);
      setTmEnriched(true);
      setHeadlinerName(result.performers[0]?.name ?? result.name);
      setHeadliner({
        name: result.performers[0]?.name ?? result.name,
        tmAttractionId: result.performers[0]?.tmAttractionId,
        imageUrl: result.performers[0]?.imageUrl ?? undefined,
      });
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

      if (result.kind) {
        const mappedKind = result.kind.toLowerCase() as ShowKind;
        if (["concert", "theatre", "comedy", "festival"].includes(mappedKind)) {
          setKind(mappedKind);
        }
      }

      // Set additional performers
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

  const handleGmailImportClick = useCallback(() => {
    if (!headlinerName || headlinerName.length < 2) {
      setGmailShowResults(false);
      return;
    }
    setGmailScanning(true);
    setGmailShowResults(true);

    const popup = window.open("/api/gmail", "gmail-auth", "width=500,height=600,popup=yes");

    const handler = async (e: MessageEvent) => {
      if (e.data?.type === "gmail-auth" && e.data.accessToken) {
        window.removeEventListener("message", handler);
        try {
          const results = await scanGmailForShow.mutateAsync({
            accessToken: e.data.accessToken,
            headliner: headlinerName,
            venue: venue.name || undefined,
          });
          setGmailResults(results);
        } catch {
          setGmailResults([]);
        } finally {
          setGmailScanning(false);
        }
      }
      if (e.data?.type === "gmail-auth-error") {
        window.removeEventListener("message", handler);
        setGmailScanning(false);
        setGmailResults([]);
      }
    };
    window.addEventListener("message", handler);

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        window.removeEventListener("message", handler);
        setGmailScanning(false);
      }
    }, 500);
  }, [headlinerName, venue.name, scanGmailForShow]);

  const handleSelectGmailResult = useCallback(
    (result: (typeof gmailResults)[number]) => {
      if (result.headliner) {
        setHeadlinerName(result.headliner);
        setHeadliner({ name: result.headliner });
      }
      if (result.venue_name) {
        setVenue((prev) => ({
          ...prev,
          name: result.venue_name ?? prev.name,
          city: result.venue_city ?? prev.city,
        }));
      }
      if (result.date) setDate(result.date);
      if (result.seat) setSeat(result.seat);
      if (result.price) setPricePaid(result.price);
      if (result.kind_hint) setKind(result.kind_hint);
      setGmailShowResults(false);
    },
    [],
  );

  // Update setlist when query resolves
  useEffect(() => {
    if (setlistQuery.data) {
      setSetlist(setlistQuery.data.songs);
      if (setlistQuery.data.tourName) {
        setTourName(setlistQuery.data.tourName);
      }
    }
  }, [setlistQuery.data]);

  const handleChatSend = useCallback(async () => {
    if (!chatInput.trim()) return;

    const userMessage = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setChatInput("");

    try {
      const result = await parseChat.mutateAsync({ freeText: userMessage });
      setChatParsed(result);

      const parts: string[] = [];
      if (result.headliner) parts.push(`Headliner: ${result.headliner}`);
      if (result.venue_hint) parts.push(`Venue: ${result.venue_hint}`);
      if (result.date_hint) parts.push(`Date: ${result.date_hint}`);
      if (result.seat_hint) parts.push(`Seat: ${result.seat_hint}`);
      if (result.kind_hint) parts.push(`Type: ${result.kind_hint}`);

      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Here's what I got:\n\n${parts.join("\n")}\n\nLook right? Click "Confirm & Save" to add this show, or tell me what to change.`,
        },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, I had trouble understanding that. Could you try again with more details?",
        },
      ]);
    }
  }, [chatInput, parseChat]);

  const handleChatConfirmSave = useCallback(async () => {
    if (!chatParsed) return;

    const showKind = chatParsed.kind_hint ?? "concert";
    const showDate =
      chatParsed.date_hint ?? new Date().toISOString().split("T")[0]!;

    try {
      await createShow.mutateAsync({
        kind: showKind,
        headliner: { name: chatParsed.headliner },
        venue: {
          name: chatParsed.venue_hint ?? "Unknown Venue",
          city: "Unknown",
        },
        date: showDate,
        seat: chatParsed.seat_hint ?? undefined,
      });
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "There was an error saving the show. Please try again.",
        },
      ]);
    }
  }, [chatParsed, createShow]);

  const handleFormSave = useCallback(async () => {
    if (!kind || !headliner.name || !venue.name || !venue.city || !date) return;

    let allPerformers = [...performers];
    if (kind === "festival" && festivalHeadliners.trim()) {
      const festNames = festivalHeadliners
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      const festPerformers: PerformerData[] = festNames.map((name, i) => ({
        name,
        role: "headliner" as const,
        sortOrder: allPerformers.length + i + 1,
      }));
      allPerformers = [...allPerformers, ...festPerformers];
    }

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
            venueToSave = { ...venueToSave, lat: geo.lat, lng: geo.lng };
          }
        } catch {
          // Geocoding failed; save without coordinates
        }
      }

      await createShow.mutateAsync({
        kind,
        headliner,
        venue: venueToSave,
        date,
        endDate: endDate || undefined,
        seat: seat || undefined,
        pricePaid: pricePaid || undefined,
        tourName: tourName || undefined,
        setlist: setlist ?? undefined,
        performers: allPerformers.length > 0 ? allPerformers : undefined,
      });
    } catch {
      // Error is surfaced via createShow.isError in the UI
    }
  }, [
    kind,
    headliner,
    venue,
    date,
    endDate,
    seat,
    pricePaid,
    tourName,
    setlist,
    performers,
    festivalHeadliners,
    openerName,
    createShow,
    utils,
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
        });
        setVenueQuery(details.name);
        setDebouncedVenueQuery("");
      }
    } catch { /* place details failed, user can enter manually */ }
  }, [utils]);

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
  }, [performerSearchInput]);

  const handleRemovePerformer = useCallback((index: number) => {
    setPerformers((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Determine if form can save
  const hasValidVenue = venue.name.length > 0 && venue.city.length > 0 && (venue.googlePlaceId != null || venue.tmVenueId != null);
  const canSave = kind !== null && headliner.name.length > 0 && hasValidVenue && date.length > 0;

  // Provenance statuses derived from state
  const provenanceStatuses = useMemo(() => {
    return [
      {
        source: "setlist.fm",
        what: setlist ? `${setlist.length} songs${tourName ? ` · ${tourName}` : ""}` : "tour, setlist",
        status: setlistQuery.isLoading ? "pending" : setlist ? "ok" : isPastConcert ? "pending" : "skipped",
      },
      {
        source: "ticketmaster",
        what: "venue, date, seat, price",
        status: tmEnriched ? "ok" : debouncedQuery.length >= 2 ? (tmSearch.isLoading ? "pending" : "skipped") : "pending",
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
  }, [setlist, tourName, setlistQuery.isLoading, isPastConcert, tmEnriched, debouncedQuery, tmSearch.isLoading, castMembers, kind, headliner]);

  // Kind color helper
  const kindColor = (k: ShowKind) => `var(--kind-${k})`;

  // ── Render: Form Mode (Left Panel) ─────────────────────────

  const renderFormPanel = () => (
    <div style={{
      padding: "28px 36px 100px",
      overflow: "auto",
      minHeight: 0,
      flex: 1,
    }}>
      {/* Heading + mode tabs */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginBottom: 20 }}>
        <div>
          <div style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}>
            New record · draft
          </div>
          <div style={{
            fontFamily: sans,
            fontSize: 32,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -1,
            marginTop: 4,
          }}>
            Add a show
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Mode Tabs */}
        <div style={{ display: "inline-flex", border: `1px solid var(--rule-strong)` }}>
          {(["Form", "Chat"] as Mode[]).map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                padding: "7px 14px",
                background: mode === m ? "var(--ink)" : "transparent",
                color: mode === m ? "var(--bg)" : "var(--muted)",
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                fontWeight: 500,
                border: "none",
                borderLeft: i === 0 ? "none" : `1px solid var(--rule-strong)`,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {m === "Form" ? "FORM" : "CONVERSATIONAL"}
            </button>
          ))}
        </div>
      </div>

      {mode === "Chat" ? renderChatMode() : renderFormFields()}
    </div>
  );

  const renderFormFields = () => (
    <>
      {/* ── Timeframe ── */}
      <div style={{ marginBottom: 26 }}>
        <FieldLabel>Timeframe</FieldLabel>
        <div style={{ display: "flex", gap: 6 }}>
          {TIMEFRAME_CONFIG.map((tf) => {
            const active = timeframe === tf.key;
            return (
              <button
                key={tf.key}
                type="button"
                onClick={() => setTimeframe(tf.key)}
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  background: active ? "var(--surface)" : "transparent",
                  border: `1px solid ${active ? "var(--rule-strong)" : "var(--rule)"}`,
                  borderLeft: active ? "2px solid var(--ink)" : "2px solid transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{
                  fontFamily: sans,
                  fontSize: 14,
                  fontWeight: active ? 600 : 500,
                  color: active ? "var(--ink)" : "var(--muted)",
                  letterSpacing: -0.2,
                }}>
                  {tf.label}
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: "var(--faint)",
                  letterSpacing: ".04em",
                  marginTop: 3,
                }}>
                  {tf.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Kind ── */}
      <div style={{ marginBottom: 26 }}>
        <FieldLabel hint="drives which data source is used">Kind</FieldLabel>
        <div style={{ display: "flex", borderLeft: `1px solid var(--rule-strong)` }}>
          {KIND_CONFIG.map((k) => {
            const active = kind === k.kind;
            const c = kindColor(k.kind);
            return (
              <button
                key={k.kind}
                type="button"
                onClick={() => setKind(k.kind)}
                style={{
                  flex: 1,
                  padding: "14px 14px",
                  background: active ? "var(--surface)" : "transparent",
                  borderLeft: active ? `2px solid ${c}` : "2px solid transparent",
                  borderTop: `1px solid var(--rule-strong)`,
                  borderRight: `1px solid var(--rule-strong)`,
                  borderBottom: `1px solid var(--rule-strong)`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: c,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  fontWeight: 500,
                }}>
                  <span style={{ fontSize: 14 }}>{k.icon}</span>
                  {k.label}
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: active ? "var(--muted)" : "var(--faint)",
                  letterSpacing: ".02em",
                }}>
                  {k.enrichmentHint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Lineup / Headliner ── */}
      <div style={{ marginBottom: 26 }}>
        <FieldLabel hint="first is headliner">Lineup</FieldLabel>
        <div style={{ border: `1px solid var(--rule-strong)` }}>
          {/* Headliner input row */}
          <div style={{
            padding: "12px 16px",
            background: headliner.name ? "var(--surface)" : "transparent",
            borderLeft: headliner.name ? `2px solid ${kind ? kindColor(kind) : "var(--ink)"}` : "2px solid transparent",
            display: "grid",
            gridTemplateColumns: "18px 1fr auto",
            columnGap: 14,
            alignItems: "center",
          }}>
            <div style={{ color: "var(--faint)", fontFamily: mono, fontSize: 11 }}>⋮⋮</div>
            <input
              type="text"
              placeholder="Search for an artist or show..."
              value={headlinerName}
              onChange={(e) => handleHeadlinerInput(e.target.value)}
              autoFocus
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                fontWeight: headliner.name ? 600 : 400,
                color: headliner.name ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.15,
                width: "100%",
              }}
            />
            <div style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".06em",
              textTransform: "uppercase",
            }}>
              headliner
            </div>
          </div>

          {/* TM search results dropdown */}
          {debouncedQuery.length >= 2 && (
            <div style={{ borderTop: `1px solid var(--rule)` }}>
              {/* Manual entry option */}
              <button
                type="button"
                onClick={() => {
                  setHeadliner({ name: headlinerName, tmAttractionId: undefined, imageUrl: undefined });
                  setTmEnriched(false);
                  setSelectedTmEvent(null);
                  setDebouncedQuery("");
                }}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid var(--rule)`,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                  Use &quot;{headlinerName}&quot;
                </span>
                <span style={{ fontFamily: mono, fontSize: 10, color: "var(--faint)" }}>
                  enter details manually
                </span>
              </button>

              {tmSearch.isLoading && (
                <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--muted)" }}>
                  Searching upcoming events...
                </div>
              )}
              {tmSearch.data && tmSearch.data.length > 0 && tmSearch.data.map((result) => (
                <button
                  key={result.tmEventId}
                  type="button"
                  onClick={() => {
                    handleSelectTmResult(result);
                    setDebouncedQuery("");
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    background: selectedTmEvent?.tmEventId === result.tmEventId
                      ? "var(--surface)"
                      : "transparent",
                    border: "none",
                    borderBottom: `1px solid var(--rule)`,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                    {result.name}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {result.venueName && `${result.venueName}`}
                    {result.venueCity && ` · ${result.venueCity}`}
                    {result.date && ` · ${result.date}`}
                  </div>
                </button>
              ))}
              {tmSearch.data && tmSearch.data.length === 0 && (
                <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--faint)" }}>
                  No upcoming events found
                </div>
              )}
            </div>
          )}

          {/* Existing performers as chips */}
          {performers.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "18px 1fr auto auto 18px",
                alignItems: "center",
                columnGap: 14,
                padding: "12px 16px",
                background: "transparent",
                borderLeft: "2px solid transparent",
                borderTop: `1px solid var(--rule)`,
              }}
            >
              <div style={{ color: "var(--faint)", fontFamily: mono, fontSize: 11 }}>⋮⋮</div>
              <div>
                <div style={{ fontFamily: sans, fontSize: 14, fontWeight: 500, color: "var(--ink)", letterSpacing: -0.15 }}>
                  {p.name}
                </div>
              </div>
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                {p.role}
              </div>
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: p.tmAttractionId ? "var(--kind-festival)" : "var(--faint)",
                letterSpacing: ".04em",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}>
                {p.tmAttractionId ? "✓ matched" : "no match"}
              </div>
              <button
                type="button"
                onClick={() => handleRemovePerformer(i)}
                style={{
                  color: "var(--faint)",
                  fontFamily: mono,
                  fontSize: 13,
                  cursor: "pointer",
                  background: "none",
                  border: "none",
                  padding: 0,
                }}
              >
                x
              </button>
            </div>
          ))}

          {/* Search input for adding performers */}
          <div style={{
            padding: "12px 16px",
            borderTop: `1px solid var(--rule)`,
            background: "transparent",
            display: "grid",
            gridTemplateColumns: "18px 1fr auto",
            columnGap: 14,
            alignItems: "center",
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>+</span>
            <input
              type="text"
              placeholder="search artists..."
              value={performerSearchInput}
              onChange={(e) => setPerformerSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddPerformer();
                }
              }}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: "var(--ink)",
                letterSpacing: -0.1,
                width: "100%",
              }}
            />
            {kind === "concert" && (
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: "var(--faint)",
                letterSpacing: ".06em",
                padding: "2px 6px",
                border: `1px solid var(--rule-strong)`,
                textTransform: "uppercase",
              }}>
                setlist.fm
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Venue + Date + Cost ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 130px", columnGap: 14, marginBottom: 26 }}>
        <div style={{ position: "relative" }}>
          <FieldLabel hint={tmEnriched ? "auto · from ticket" : venue.googlePlaceId ? "auto · google places" : undefined}>Venue</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>📍</span>
            <input
              type="text"
              placeholder="Search for a venue..."
              value={tmEnriched ? `${venue.name}${venue.city ? ` · ${venue.city}` : ""}` : venueQuery}
              onChange={(e) => {
                if (tmEnriched) return;
                handleVenueInput(e.target.value);
              }}
              readOnly={tmEnriched}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: venue.name ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.1,
              }}
            />
          </div>
          {debouncedVenueQuery.length >= 2 && !tmEnriched && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
              background: "var(--surface)", border: "1px solid var(--rule-strong)", borderTop: "none",
              maxHeight: 240, overflow: "auto",
            }}>
              {venueSearch.isLoading && (
                <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--muted)" }}>
                  Searching venues...
                </div>
              )}
              {venueSearch.data?.map((place) => (
                <button
                  key={place.placeId}
                  type="button"
                  onClick={() => handleSelectPlace(place.placeId)}
                  style={{
                    width: "100%", padding: "10px 16px", background: "transparent",
                    border: "none", borderBottom: "1px solid var(--rule)", cursor: "pointer", textAlign: "left",
                  }}
                >
                  <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                    {place.displayName}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {place.formattedAddress}
                  </div>
                </button>
              ))}
              {venueSearch.data && venueSearch.data.length === 0 && (
                <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--faint)" }}>
                  No venues found
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <FieldLabel>Date</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>📅</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: mono,
                fontSize: 13,
                color: date ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.1,
              }}
            />
          </div>
        </div>
        <div>
          <FieldLabel>Cost</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>$</span>
            <input
              type="number"
              placeholder="0.00"
              value={pricePaid}
              onChange={(e) => setPricePaid(e.target.value)}
              min="0"
              step="0.01"
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: mono,
                fontSize: 13,
                color: pricePaid ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.1,
                width: "100%",
              }}
            />
            <span style={{ fontFamily: mono, fontSize: 10, color: "var(--faint)", letterSpacing: ".04em" }}>USD</span>
          </div>
        </div>
      </div>

      {/* ── Seat + Tour ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 14, marginBottom: 26 }}>
        <div>
          <FieldLabel optional>Seat</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>🎫</span>
            <input
              type="text"
              placeholder="e.g. ORCH L · 14"
              value={seat}
              onChange={(e) => setSeat(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: mono,
                fontSize: 13,
                color: seat ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.1,
                width: "100%",
              }}
            />
          </div>
        </div>
        <div>
          <FieldLabel hint={setlistQuery.data?.tourName ? "auto · setlist.fm" : undefined} optional>Tour</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>♫</span>
            <input
              type="text"
              placeholder="e.g. Romance World Tour"
              value={tourName}
              onChange={(e) => setTourName(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: tourName ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.1,
                width: "100%",
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Festival: End Date ── */}
      {kind === "festival" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel>End Date</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
            maxWidth: 300,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>📅</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: mono,
                fontSize: 13,
                color: endDate ? "var(--ink)" : "var(--faint)",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Festival: other headliners ── */}
      {kind === "festival" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel hint="comma-separated">Other Headliners</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
          }}>
            <input
              type="text"
              placeholder="Artist 1, Artist 2, Artist 3"
              value={festivalHeadliners}
              onChange={(e) => setFestivalHeadliners(e.target.value)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: "var(--ink)",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Comedy: opener ── */}
      {kind === "comedy" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel optional>Opener</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
          }}>
            <input
              type="text"
              placeholder="Opening act name"
              value={openerName}
              onChange={(e) => setOpenerName(e.target.value)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: "var(--ink)",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Theatre: playbill upload ── */}
      {kind === "theatre" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel hint="OCR cast extraction" optional>Playbill Photo</FieldLabel>
          <div style={{
            padding: "12px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
          }}>
            <input
              type="file"
              accept="image/*"
              onChange={handlePlaybillUpload}
              style={{
                fontFamily: mono,
                fontSize: 12,
                color: "var(--muted)",
                cursor: "pointer",
              }}
            />
            {extractCast.isPending && (
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", marginTop: 8 }}>
                Extracting cast from photo...
              </div>
            )}
            {extractCast.isError && (
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "#E63946", marginTop: 8 }}>
                Could not extract cast. Add manually above.
              </div>
            )}
          </div>
          {castMembers.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: "var(--faint)", letterSpacing: ".06em", marginBottom: 6, textTransform: "uppercase" }}>
                Extracted Cast
              </div>
              {castMembers.map((c, i) => (
                <div key={i} style={{ marginBottom: 4, display: "flex", gap: 8 }}>
                  <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{c.actor}</span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: "var(--muted)" }}>as {c.role}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Setlist (past concerts) ── */}
      {isPastConcert && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel hint={setlistQuery.isLoading ? "fetching..." : setlist ? `${setlist.length} songs` : undefined}>
            Setlist
          </FieldLabel>
          {setlistQuery.isLoading && (
            <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", padding: "8px 0" }}>
              Checking setlist.fm...
            </div>
          )}
          {setlist && setlist.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {setlist.map((song, i) => (
                <span key={i} style={{
                  display: "inline-block",
                  padding: "4px 10px",
                  background: "var(--surface2)",
                  color: "var(--ink)",
                  fontFamily: mono,
                  fontSize: 11,
                  letterSpacing: ".02em",
                }}>
                  {song}
                </span>
              ))}
            </div>
          )}
          {!setlistQuery.isLoading && (!setlist || setlist.length === 0) && (
            <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--faint)", padding: "8px 0" }}>
              No setlist found. We&apos;ll check again later.
            </div>
          )}
        </div>
      )}

      {/* ── Import From ── */}
      <div style={{ marginBottom: 26 }}>
        <FieldLabel hint="start from a source">Import from</FieldLabel>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {IMPORT_SOURCES.map((src) => (
            <div
              key={src.tag}
              onClick={
                src.tag === "mail" ? handleGmailImportClick
                : src.tag === "url" ? () => setImportUrlOpen((v) => !v)
                : undefined
              }
              style={{
                padding: "12px 14px",
                background: src.tag === "mail" && gmailScanning ? "var(--ink)"
                  : src.tag === "url" && importUrlOpen ? "var(--ink)"
                  : "var(--surface)",
                border: `1px solid var(--rule-strong)`,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  fontFamily: mono,
                  fontSize: 9.5,
                  color: (src.tag === "mail" && gmailScanning) || (src.tag === "url" && importUrlOpen) ? "var(--bg)" : "var(--muted)",
                  letterSpacing: ".1em",
                  padding: "2px 5px",
                  border: `1px solid ${(src.tag === "mail" && gmailScanning) || (src.tag === "url" && importUrlOpen) ? "var(--bg)" : "var(--rule-strong)"}`,
                  textTransform: "uppercase",
                }}>
                  {src.tag}
                </div>
                <div style={{
                  fontFamily: sans,
                  fontSize: 13,
                  fontWeight: 500,
                  color: (src.tag === "mail" && gmailScanning) || (src.tag === "url" && importUrlOpen) ? "var(--bg)" : "var(--ink)",
                  letterSpacing: -0.1,
                }}>
                  {src.tag === "mail" && gmailScanning ? "Scanning..." : src.tag === "url" && fetchTMEvent.isPending ? "Importing..." : src.label}
                </div>
              </div>
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: (src.tag === "mail" && gmailScanning) || (src.tag === "url" && importUrlOpen) ? "var(--bg)" : "var(--faint)",
                letterSpacing: ".04em",
              }}>
                {src.sub}
              </div>
            </div>
          ))}
        </div>

        {/* URL import input */}
        {importUrlOpen && (
          <div style={{ marginTop: 8 }}>
            <div style={{
              padding: "10px 14px",
              background: "var(--surface)",
              border: "1px solid var(--rule-strong)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <input
                type="text"
                placeholder="https://www.ticketmaster.com/.../event/..."
                value={importUrlValue}
                onChange={(e) => setImportUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleImportFromUrl(); }
                  if (e.key === "Escape") { setImportUrlOpen(false); setImportUrlValue(""); }
                }}
                autoFocus
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontFamily: mono,
                  fontSize: 13,
                  color: "var(--ink)",
                  letterSpacing: -0.1,
                }}
              />
              <button
                type="button"
                onClick={handleImportFromUrl}
                disabled={fetchTMEvent.isPending || !importUrlValue.trim()}
                style={{
                  padding: "6px 12px",
                  background: importUrlValue.trim() ? "var(--ink)" : "var(--surface2)",
                  color: importUrlValue.trim() ? "var(--bg)" : "var(--faint)",
                  fontFamily: mono,
                  fontSize: 10.5,
                  letterSpacing: ".06em",
                  textTransform: "uppercase" as const,
                  border: "none",
                  cursor: importUrlValue.trim() ? "pointer" : "not-allowed",
                }}
              >
                {fetchTMEvent.isPending ? "Loading..." : "Import"}
              </button>
            </div>
            {fetchTMEvent.isError && (
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "#E63946", marginTop: 6 }}>
                {fetchTMEvent.error?.message?.includes("not found")
                  ? "Event not found. Check the URL and try again."
                  : "Failed to import. Check the URL and try again."}
              </div>
            )}
          </div>
        )}

        {/* Gmail results dropdown */}
        {gmailShowResults && (
          <div style={{
            marginTop: 8,
            border: "1px solid var(--rule-strong)",
            background: "var(--surface)",
          }}>
            {gmailScanning && (
              <div style={{
                padding: "14px 16px",
                fontFamily: mono,
                fontSize: 11,
                color: "var(--muted)",
                letterSpacing: ".04em",
              }}>
                Scanning Gmail for &ldquo;{headlinerName}&rdquo;...
              </div>
            )}
            {!gmailScanning && gmailResults.length === 0 && (
              <div style={{
                padding: "14px 16px",
                fontFamily: mono,
                fontSize: 11,
                color: "var(--faint)",
                letterSpacing: ".04em",
              }}>
                No ticket emails found
              </div>
            )}
            {gmailResults.map((result, i) => (
              <div
                key={i}
                onClick={() => handleSelectGmailResult(result)}
                style={{
                  padding: "10px 16px",
                  cursor: "pointer",
                  borderTop: i > 0 ? "1px solid var(--rule)" : "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  fontFamily: sans,
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--ink)",
                  letterSpacing: -0.1,
                }}>
                  {result.headliner}
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: "var(--muted)",
                  letterSpacing: ".04em",
                  display: "flex",
                  gap: 12,
                }}>
                  {result.venue_name && <span>{result.venue_name}</span>}
                  {result.date && <span>{result.date}</span>}
                  {result.seat && <span>{result.seat}</span>}
                  {result.price && <span>${result.price}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Commit Bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 8,
        paddingTop: 18,
        borderTop: `1px solid var(--rule)`,
      }}>
        <div style={{
          fontFamily: mono,
          fontSize: 10.5,
          color: "var(--faint)",
          letterSpacing: ".04em",
          flex: 1,
        }}>
          {autoFilledCount} fields auto-filled · {createShow.isError ? "1 error" : "0 errors"}
        </div>
        <button
          type="button"
          onClick={() => router.push("/shows")}
          style={{
            padding: "9px 14px",
            border: `1px solid var(--rule-strong)`,
            background: "transparent",
            color: "var(--muted)",
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleFormSave}
          disabled={!canSave || createShow.isPending}
          style={{
            padding: "9px 16px",
            background: canSave ? "var(--ink)" : "var(--surface2)",
            color: canSave ? "var(--bg)" : "var(--faint)",
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: canSave ? "pointer" : "not-allowed",
            border: "none",
            opacity: createShow.isPending ? 0.6 : 1,
          }}
        >
          {createShow.isPending ? "Saving..." : "✓ Save to history"}
        </button>
      </div>

      {createShow.isError && (
        <div style={{ color: "#E63946", fontSize: 12, fontFamily: mono, marginTop: 8 }}>
          Failed to save show. Please try again.
        </div>
      )}
    </>
  );

  // ── Render: Chat Mode ──────────────────────────────────────

  const renderChatMode = () => (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 16,
      minHeight: 400,
    }}>
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        marginBottom: 16,
      }}>
        {chatMessages.map((msg, i) => (
          <div
            key={i}
            style={{
              maxWidth: "80%",
              alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              padding: "12px 16px",
              borderRadius: 12,
              background: msg.role === "user" ? "var(--accent)" : "var(--surface)",
              color: msg.role === "user" ? "var(--accent-text)" : "var(--ink)",
              fontFamily: sans,
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {msg.content.split("\n").map((line, j) => (
              <div key={j}>{line || " "}</div>
            ))}
          </div>
        ))}
        {parseChat.isPending && (
          <div style={{
            alignSelf: "flex-start",
            padding: "12px 16px",
            borderRadius: 12,
            background: "var(--surface)",
            color: "var(--muted)",
            fontFamily: mono,
            fontSize: 12,
          }}>
            Thinking...
          </div>
        )}
      </div>

      {chatParsed && !chatConfirmed && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            style={{
              padding: "9px 16px",
              background: "var(--ink)",
              color: "var(--bg)",
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
            onClick={async () => {
              setChatConfirmed(true);
              await handleChatConfirmSave();
            }}
            disabled={createShow.isPending}
          >
            {createShow.isPending ? "Saving..." : "Confirm & Save"}
          </button>
          <button
            type="button"
            style={{
              padding: "9px 14px",
              border: `1px solid var(--rule-strong)`,
              background: "transparent",
              color: "var(--ink)",
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
            onClick={() => {
              setChatParsed(null);
              setChatMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "No problem! Tell me what to change.",
                },
              ]);
            }}
          >
            Edit
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <textarea
          style={{
            flex: 1,
            padding: "12px 16px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            color: "var(--ink)",
            fontFamily: sans,
            fontSize: 13,
            outline: "none",
            resize: "none",
            minHeight: 48,
          }}
          placeholder="Describe your show..."
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleChatSend();
            }
          }}
          rows={1}
        />
        <button
          type="button"
          style={{
            padding: "9px 16px",
            background: "var(--ink)",
            color: "var(--bg)",
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            fontWeight: 500,
            border: "none",
            cursor: "pointer",
            opacity: parseChat.isPending || !chatInput.trim() ? 0.4 : 1,
          }}
          onClick={handleChatSend}
          disabled={parseChat.isPending || !chatInput.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );

  // ── Render: Live Preview (Right Panel) ─────────────────────

  const renderLivePreview = () => {
    const kindLabel = KIND_CONFIG.find((k) => k.kind === kind)?.label ?? "Show";
    const kColor = kind ? kindColor(kind) : "var(--muted)";

    // Format date for display
    let dateDisplay = "";
    let dateSub = "";
    let dateYear = "";
    if (date) {
      const d = new Date(date + "T12:00:00");
      const day = String(d.getDate()).padStart(2, "0");
      const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
      const month = monthNames[d.getMonth()] ?? "";
      const dayOfWeek = dayNames[d.getDay()] ?? "";
      dateDisplay = `${day}`;
      dateSub = `${month} · ${dayOfWeek}`;
      dateYear = String(d.getFullYear());
    }

    // Time ago
    let timeAgo = "";
    if (date) {
      const now = new Date();
      const showDate = new Date(date + "T12:00:00");
      const diff = Math.floor((now.getTime() - showDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diff > 0) timeAgo = `PAST · ${diff} DAYS AGO`;
      else if (diff === 0) timeAgo = "TODAY";
      else timeAgo = `IN ${Math.abs(diff)} DAYS`;
    }

    // Build detail rows
    const detailRows: [string, string][] = [];
    if (venue.name) detailRows.push(["Venue", venue.name]);
    if (venue.city) detailRows.push(["City", venue.city]);
    if (seat) detailRows.push(["Seat", seat]);
    if (pricePaid) detailRows.push(["Paid", `$${pricePaid}`]);
    if (tourName) detailRows.push(["Tour", tourName]);
    if (setlist && setlist.length > 0) detailRows.push(["Setlist", `${setlist.length} songs`]);

    return (
      <div style={{
        padding: "28px 28px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 22,
        minHeight: 0,
        overflow: "auto",
      }}>
        {/* Section header */}
        <div>
          <div style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}>
            Live preview
          </div>
          <div style={{
            fontFamily: mono,
            fontSize: 10,
            color: "var(--faint)",
            letterSpacing: ".02em",
            marginTop: 3,
          }}>
            what the archive row will look like
          </div>
        </div>

        {/* Preview card */}
        <div style={{
          padding: "22px 22px",
          background: "var(--surface)",
          borderLeft: `3px solid ${kColor}`,
        }}>
          {/* Kind + time badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: mono,
              fontSize: 10.5,
              color: kColor,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}>
              {kind ? KIND_CONFIG.find((k) => k.kind === kind)?.icon : "·"} {kindLabel}
            </span>
            {timeAgo && (
              <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", letterSpacing: ".04em" }}>
                {timeAgo}
              </span>
            )}
          </div>

          {/* Headliner */}
          <div style={{
            fontFamily: sans,
            fontSize: 30,
            fontWeight: 600,
            color: headliner.name ? "var(--ink)" : "var(--faint)",
            letterSpacing: -1.1,
            lineHeight: 1,
          }}>
            {headliner.name || "Headliner"}
          </div>

          {/* Support */}
          {performers.length > 0 && (
            <div style={{ fontFamily: sans, fontSize: 14, color: "var(--muted)", marginTop: 6, letterSpacing: -0.15 }}>
              with {performers.map((p) => p.name).join(", ")}
            </div>
          )}

          {/* Date display */}
          {date && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 18 }}>
              <div style={{
                fontFamily: sans,
                fontSize: 48,
                fontWeight: 500,
                color: "var(--ink)",
                letterSpacing: -1.8,
                lineHeight: 0.9,
                fontFeatureSettings: '"tnum"',
              }}>
                {dateDisplay}
              </div>
              <div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: kColor,
                  letterSpacing: ".1em",
                  fontWeight: 500,
                }}>
                  {dateSub}
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: "var(--muted)",
                  letterSpacing: ".04em",
                  marginTop: 3,
                }}>
                  {dateYear}
                </div>
              </div>
            </div>
          )}

          {/* Detail rows */}
          {detailRows.length > 0 && (
            <div style={{ marginTop: 18, fontFamily: mono, fontSize: 11, display: "grid", gridTemplateColumns: "1fr", rowGap: 0 }}>
              {detailRows.map(([k, v]) => (
                <div key={k} style={{
                  display: "grid",
                  gridTemplateColumns: "82px 1fr",
                  columnGap: 10,
                  padding: "6px 0",
                  borderTop: `1px solid var(--rule)`,
                  alignItems: "baseline",
                }}>
                  <div style={{ color: "var(--faint)", letterSpacing: ".08em", textTransform: "uppercase", fontSize: 10 }}>{k}</div>
                  <div style={{ color: "var(--ink)", letterSpacing: ".02em" }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {/* Photo strip placeholder */}
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{
                aspectRatio: "4/3",
                background: `repeating-linear-gradient(135deg, var(--surface2) 0 6px, var(--bg) 6px 12px)`,
                border: `1px solid var(--rule)`,
                display: "flex",
                alignItems: "flex-end",
                padding: 5,
              }}>
                <div style={{ fontFamily: mono, fontSize: 9, color: "var(--faint)", letterSpacing: ".06em" }}>
                  IMG_{String(i).padStart(2, "0")}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Provenance Log ── */}
        <div>
          <div style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}>
            Provenance · auto-fetched
          </div>
          <div style={{ border: `1px solid var(--rule-strong)` }}>
            {provenanceStatuses.map((row, i) => {
              const isOk = row.status === "ok";
              const isSkipped = row.status === "skipped";
              return (
                <div key={row.source} style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr auto",
                  columnGap: 12,
                  padding: "10px 14px",
                  borderTop: i === 0 ? "none" : `1px solid var(--rule)`,
                  alignItems: "center",
                }}>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    color: "var(--ink)",
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    fontWeight: 500,
                  }}>
                    {row.source}
                  </div>
                  <div style={{
                    fontFamily: sans,
                    fontSize: 12.5,
                    color: "var(--muted)",
                    letterSpacing: -0.1,
                  }}>
                    {row.what}
                  </div>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 10,
                    color: isOk ? "var(--kind-festival)" : isSkipped ? "var(--muted)" : "var(--faint)",
                    letterSpacing: ".04em",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}>
                    {isOk ? "✓" : isSkipped ? "–" : "···"}
                    {" "}{row.status}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{
            marginTop: 10,
            fontFamily: mono,
            fontSize: 10,
            color: "var(--faint)",
            letterSpacing: ".04em",
            lineHeight: 1.5,
          }}>
            we never ask you to type cast, setlists, or tour names — these are
            fetched from sources when you pick an artist + date.
          </div>
        </div>
      </div>
    );
  };

  // ── Main Render ────────────────────────────────────────────

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: "100vh",
      background: "var(--bg)",
      color: "var(--ink)",
      fontFamily: sans,
      WebkitFontSmoothing: "antialiased",
    }}>
      {/* Top bar / Breadcrumb */}
      <div style={{
        padding: "14px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid var(--rule)`,
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: mono,
          fontSize: 11.5,
          color: "var(--muted)",
          letterSpacing: ".04em",
        }}>
          <span style={{ cursor: "pointer" }} onClick={() => router.push("/home")}>home</span>
          <span style={{ color: "var(--faint)" }}>&gt;</span>
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>add a show</span>
          <span style={{ color: "var(--faint)" }}>·</span>
          <span style={{ color: "var(--faint)" }}>draft · autosaved 2s ago</span>
        </div>
        <div style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          fontFamily: mono,
          fontSize: 11,
          color: "var(--muted)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--kind-festival)",
              display: "inline-block",
            }} />
            5 sources connected
          </span>
        </div>
      </div>

      {/* 2-column layout */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr 440px",
        minHeight: 0,
        overflow: "hidden",
      }}>
        {/* Left: Form */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          {renderFormPanel()}
        </div>

        {/* Right: Live Preview + Provenance */}
        <div style={{
          minWidth: 0,
          borderLeft: `1px solid var(--rule)`,
          background: "var(--bg)",
          overflow: "auto",
        }}>
          {renderLivePreview()}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────

function FieldLabel({
  children,
  hint,
  optional,
}: {
  children: React.ReactNode;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginBottom: 8,
    }}>
      <div style={{
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 10.5,
        color: "var(--ink)",
        letterSpacing: ".08em",
        textTransform: "uppercase",
        fontWeight: 500,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}>
        {children}
        {optional && (
          <span style={{ color: "var(--faint)", fontWeight: 400 }}>· optional</span>
        )}
      </div>
      {hint && (
        <div style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10,
          color: "var(--faint)",
          letterSpacing: ".02em",
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}
