"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import {
  SegmentedControl,
  type ShowKind,
} from "@/components/design-system";

// ── Types ────────────────────────────────────────────────────

type Mode = "Form" | "Chat";

interface VenueData {
  name: string;
  city: string;
  stateRegion?: string;
  country?: string;
  tmVenueId?: string;
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
  color: string;
}[] = [
  { kind: "concert", label: "Concert", icon: "♫", color: "var(--kind-concert)" },
  { kind: "theatre", label: "Theatre", icon: "🎭", color: "var(--kind-theatre)" },
  { kind: "comedy", label: "Comedy", icon: "🎙", color: "var(--kind-comedy)" },
  { kind: "festival", label: "Festival", icon: "★", color: "var(--kind-festival)" },
];

const STEPS = [
  "Kind",
  "Headliner",
  "Venue & Date",
  "Details",
  "Personal",
  "Review",
] as const;

// ── Styles ───────────────────────────────────────────────────

const s = {
  page: {
    minHeight: "100vh",
    background: "var(--bg)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-geist-sans), sans-serif",
    padding: "32px 24px",
    maxWidth: 640,
    margin: "0 auto",
  } as React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 32,
  } as React.CSSProperties,

  title: {
    fontSize: "1.5rem",
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "var(--marquee-gold)",
  } as React.CSSProperties,

  progress: {
    display: "flex",
    gap: 4,
    marginBottom: 32,
  } as React.CSSProperties,

  progressDot: (active: boolean, completed: boolean) =>
    ({
      height: 4,
      flex: 1,
      borderRadius: 2,
      background: completed
        ? "var(--marquee-gold)"
        : active
          ? "color-mix(in srgb, var(--marquee-gold) 50%, transparent)"
          : "var(--border)",
      transition: "background 0.2s ease",
    }) as React.CSSProperties,

  stepTitle: {
    fontSize: "1.1rem",
    fontWeight: 700,
    marginBottom: 16,
    color: "var(--text-primary)",
  } as React.CSSProperties,

  kindGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  } as React.CSSProperties,

  kindButton: (color: string, selected: boolean) =>
    ({
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "24px 16px",
      borderRadius: 12,
      border: selected ? `2px solid ${color}` : "2px solid var(--border)",
      background: selected
        ? `color-mix(in srgb, ${color} 10%, var(--surface))`
        : "var(--surface)",
      cursor: "pointer",
      transition: "all 0.15s ease",
      color: selected ? color : "var(--text-secondary)",
      fontSize: "0.9rem",
      fontWeight: 600,
      fontFamily: "var(--font-geist-sans), sans-serif",
    }) as React.CSSProperties,

  kindIcon: {
    fontSize: "2rem",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: "0.9rem",
    outline: "none",
  } as React.CSSProperties,

  label: {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: 6,
    fontFamily: "var(--font-geist-mono), monospace",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  } as React.CSSProperties,

  field: {
    marginBottom: 16,
  } as React.CSSProperties,

  card: {
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    cursor: "pointer",
    transition: "all 0.15s ease",
    marginBottom: 8,
  } as React.CSSProperties,

  cardSelected: {
    borderColor: "var(--marquee-gold)",
    background: "color-mix(in srgb, var(--marquee-gold) 6%, var(--surface))",
  } as React.CSSProperties,

  cardTitle: {
    fontWeight: 700,
    fontSize: "0.9rem",
    color: "var(--text-primary)",
    marginBottom: 4,
  } as React.CSSProperties,

  cardMeta: {
    fontSize: "0.75rem",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-mono), monospace",
  } as React.CSSProperties,

  btn: (variant: "primary" | "secondary" | "ghost") =>
    ({
      padding: "12px 24px",
      borderRadius: 8,
      border:
        variant === "ghost"
          ? "none"
          : variant === "secondary"
            ? "1px solid var(--border)"
            : "none",
      background:
        variant === "primary"
          ? "var(--marquee-gold)"
          : variant === "secondary"
            ? "var(--surface)"
            : "transparent",
      color:
        variant === "primary"
          ? "#0C0C0C"
          : variant === "ghost"
            ? "var(--text-secondary)"
            : "var(--text-primary)",
      fontFamily: "var(--font-geist-sans), sans-serif",
      fontSize: "0.85rem",
      fontWeight: 700,
      cursor: "pointer",
      transition: "opacity 0.15s ease",
    }) as React.CSSProperties,

  nav: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 32,
  } as React.CSSProperties,

  searchLoading: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-mono), monospace",
    padding: "12px 0",
  } as React.CSSProperties,

  reviewSection: {
    marginBottom: 16,
  } as React.CSSProperties,

  reviewLabel: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-mono), monospace",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: 4,
  } as React.CSSProperties,

  reviewValue: {
    fontSize: "0.9rem",
    color: "var(--text-primary)",
  } as React.CSSProperties,

  chatContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
    minHeight: 400,
  } as React.CSSProperties,

  chatMessages: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    marginBottom: 16,
  } as React.CSSProperties,

  chatBubble: (isUser: boolean) =>
    ({
      maxWidth: "80%",
      alignSelf: isUser ? "flex-end" : "flex-start",
      padding: "12px 16px",
      borderRadius: 12,
      background: isUser ? "var(--marquee-gold)" : "var(--surface)",
      color: isUser ? "#0C0C0C" : "var(--text-primary)",
      fontSize: "0.85rem",
      lineHeight: 1.5,
    }) as React.CSSProperties,

  chatInputRow: {
    display: "flex",
    gap: 8,
  } as React.CSSProperties,

  textarea: {
    flex: 1,
    padding: "12px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: "0.9rem",
    outline: "none",
    resize: "none" as const,
    minHeight: 48,
  } as React.CSSProperties,

  tag: {
    display: "inline-block",
    padding: "4px 10px",
    borderRadius: 6,
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontSize: "0.8rem",
    marginRight: 6,
    marginBottom: 6,
  } as React.CSSProperties,

  error: {
    color: "#E63946",
    fontSize: "0.8rem",
    marginTop: 8,
  } as React.CSSProperties,

  notListed: {
    fontSize: "0.8rem",
    color: "var(--text-secondary)",
    cursor: "pointer",
    textDecoration: "underline" as const,
    padding: "8px 0",
    background: "none",
    border: "none",
    fontFamily: "var(--font-geist-mono), monospace",
  } as React.CSSProperties,
};

// ── Main Component ───────────────────────────────────────────

export default function AddPage() {
  const router = useRouter();

  // Mode toggle
  const [mode, setMode] = useState<Mode>("Form");

  // Form state
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ShowKind | null>(null);
  const [headlinerName, setHeadlinerName] = useState("");
  const [headliner, setHeadliner] = useState<HeadlinerData>({ name: "" });
  const [venue, setVenue] = useState<VenueData>({ name: "", city: "" });
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tmEnriched, setTmEnriched] = useState(false);
  const [selectedTmEvent, setSelectedTmEvent] = useState<TMResult | null>(null);

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

  // TM search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const tmSearch = trpc.enrichment.searchTM.useQuery(
    { headliner: debouncedQuery },
    { enabled: debouncedQuery.length >= 2 },
  );

  // Setlist fetch
  const isPastConcert =
    kind === "concert" && date && new Date(date) < new Date();
  const setlistQuery = trpc.enrichment.fetchSetlist.useQuery(
    { performerName: headliner.name, date },
    {
      enabled:
        !!isPastConcert && headliner.name.length > 0 && date.length > 0 && step === 3,
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
          // Convert cast to performers
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

      // Build a confirmation message
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

    // Build festival performers from the multi-headliner input
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

    // Add opener if present (comedy)
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
      await createShow.mutateAsync({
        kind,
        headliner,
        venue,
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
  ]);

  const canProceed = (): boolean => {
    switch (step) {
      case 0:
        return kind !== null;
      case 1:
        return headliner.name.length > 0;
      case 2:
        return venue.name.length > 0 && venue.city.length > 0 && date.length > 0;
      case 3:
        return true; // All enrichment is optional
      case 4:
        return true; // All personal data is optional
      case 5:
        return true;
      default:
        return false;
    }
  };

  // ── Render Helpers ─────────────────────────────────────────

  const renderStep0_Kind = () => (
    <div>
      <div style={s.stepTitle}>What kind of show?</div>
      <div style={s.kindGrid}>
        {KIND_CONFIG.map((k) => (
          <button
            key={k.kind}
            type="button"
            style={s.kindButton(k.color, kind === k.kind)}
            onClick={() => setKind(k.kind)}
          >
            <span style={s.kindIcon}>{k.icon}</span>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );

  const renderStep1_Headliner = () => (
    <div>
      <div style={s.stepTitle}>Who did you see?</div>
      <div style={s.field}>
        <label style={s.label}>Headliner</label>
        <input
          style={s.input}
          type="text"
          placeholder="Search for an artist or show..."
          value={headlinerName}
          onChange={(e) => handleHeadlinerInput(e.target.value)}
          autoFocus
        />
      </div>

      {/* Manual entry shortcut for past shows */}
      {debouncedQuery.length >= 2 && (
        <div>
          <button
            type="button"
            style={{
              ...s.card,
              border: "1px solid var(--marquee-gold)",
              marginBottom: 12,
              textAlign: "left" as const,
              cursor: "pointer",
            }}
            onClick={() => {
              setHeadliner({ name: headlinerName, tmAttractionId: undefined, imageUrl: undefined });
              setTmEnriched(false);
              setSelectedTmEvent(null);
              setStep(2);
            }}
          >
            <div style={s.cardTitle}>Use &quot;{headlinerName}&quot;</div>
            <div style={s.cardMeta}>Enter venue, date, and details manually</div>
          </button>

          {/* TM search results */}
          {tmSearch.isLoading && (
            <div style={s.searchLoading}>Searching upcoming events...</div>
          )}
          {tmSearch.data && tmSearch.data.length > 0 && (
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--foreground-muted)", marginBottom: 8, fontFamily: "var(--font-geist-mono), monospace" }}>
                Upcoming events from Ticketmaster
              </div>
              {tmSearch.data.map((result) => (
                <div
                  key={result.tmEventId}
                  style={{
                    ...s.card,
                    ...(selectedTmEvent?.tmEventId === result.tmEventId
                      ? s.cardSelected
                      : {}),
                  }}
                  onClick={() => handleSelectTmResult(result)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      handleSelectTmResult(result);
                    }
                  }}
                >
                  <div style={s.cardTitle}>{result.name}</div>
                  <div style={s.cardMeta}>
                    {result.venueName && `${result.venueName}`}
                    {result.venueCity && ` • ${result.venueCity}`}
                    {result.date && ` • ${result.date}`}
                  </div>
                </div>
              ))}
            </div>
          )}
          {tmSearch.data && tmSearch.data.length === 0 && (
            <div style={s.searchLoading}>No upcoming events found</div>
          )}
        </div>
      )}
    </div>
  );

  const renderStep2_VenueDate = () => (
    <div>
      <div style={s.stepTitle}>Where and when?</div>
      {tmEnriched && (
        <div
          style={{
            fontSize: "0.75rem",
            color: "var(--marquee-gold)",
            fontFamily: "var(--font-geist-mono), monospace",
            marginBottom: 16,
          }}
        >
          Auto-filled from Ticketmaster. Edit if needed.
        </div>
      )}
      <div style={s.field}>
        <label style={s.label}>Venue Name</label>
        <input
          style={s.input}
          type="text"
          placeholder="Madison Square Garden"
          value={venue.name}
          onChange={(e) => setVenue((v) => ({ ...v, name: e.target.value }))}
        />
      </div>
      <div style={s.field}>
        <label style={s.label}>City</label>
        <input
          style={s.input}
          type="text"
          placeholder="New York, NY"
          value={venue.city}
          onChange={(e) => setVenue((v) => ({ ...v, city: e.target.value }))}
        />
      </div>
      <div style={s.field}>
        <label style={s.label}>Date</label>
        <input
          style={s.input}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
      {kind === "festival" && (
        <div style={s.field}>
          <label style={s.label}>End Date</label>
          <input
            style={s.input}
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      )}
    </div>
  );

  const renderStep3_Enrichment = () => {
    switch (kind) {
      case "concert":
        return (
          <div>
            <div style={s.stepTitle}>Concert Details</div>
            <div style={s.field}>
              <label style={s.label}>Tour Name (optional)</label>
              <input
                style={s.input}
                type="text"
                placeholder="e.g. The Eras Tour"
                value={tourName}
                onChange={(e) => setTourName(e.target.value)}
              />
            </div>

            {isPastConcert && (
              <div style={s.field}>
                <label style={s.label}>Setlist</label>
                {setlistQuery.isLoading && (
                  <div style={s.searchLoading}>
                    Checking setlist.fm for the setlist...
                  </div>
                )}
                {setlistQuery.data && setlist && setlist.length > 0 ? (
                  <div>
                    {setlist.map((song, i) => (
                      <span key={i} style={s.tag}>
                        {song}
                      </span>
                    ))}
                  </div>
                ) : setlistQuery.data === null || setlistQuery.isError ? (
                  <div style={s.searchLoading}>
                    No setlist found. We&apos;ll check again later.
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );

      case "theatre":
        return (
          <div>
            <div style={s.stepTitle}>Theatre Details</div>
            <div style={s.field}>
              <label style={s.label}>Got a photo of your playbill?</label>
              <input
                type="file"
                accept="image/*"
                onChange={handlePlaybillUpload}
                style={{
                  ...s.input,
                  padding: "10px 16px",
                  cursor: "pointer",
                }}
              />
              {extractCast.isPending && (
                <div style={s.searchLoading}>Extracting cast from photo...</div>
              )}
              {extractCast.isError && (
                <div style={s.error}>
                  Could not extract cast. You can add manually below.
                </div>
              )}
            </div>
            {castMembers.length > 0 && (
              <div style={s.field}>
                <label style={s.label}>Extracted Cast</label>
                {castMembers.map((c, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                      {c.actor}
                    </span>
                    <span
                      style={{
                        color: "var(--text-secondary)",
                        fontSize: "0.8rem",
                        marginLeft: 8,
                      }}
                    >
                      as {c.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case "comedy":
        return (
          <div>
            <div style={s.stepTitle}>Comedy Details</div>
            <div style={s.field}>
              <label style={s.label}>Tour Name (optional)</label>
              <input
                style={s.input}
                type="text"
                placeholder="e.g. Happiness Begins Tour"
                value={tourName}
                onChange={(e) => setTourName(e.target.value)}
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Opener (optional)</label>
              <input
                style={s.input}
                type="text"
                placeholder="Opening act name"
                value={openerName}
                onChange={(e) => setOpenerName(e.target.value)}
              />
            </div>
          </div>
        );

      case "festival":
        return (
          <div>
            <div style={s.stepTitle}>Festival Details</div>
            <div style={s.field}>
              <label style={s.label}>Other Headliners (comma-separated)</label>
              <input
                style={s.input}
                type="text"
                placeholder="Artist 1, Artist 2, Artist 3"
                value={festivalHeadliners}
                onChange={(e) => setFestivalHeadliners(e.target.value)}
              />
              <div
                style={{
                  fontSize: "0.7rem",
                  color: "var(--text-secondary)",
                  marginTop: 4,
                }}
              >
                The main headliner is already set from Step 2
              </div>
            </div>
          </div>
        );

      default:
        return <div style={s.stepTitle}>Details</div>;
    }
  };

  const renderStep4_Personal = () => (
    <div>
      <div style={s.stepTitle}>Personal Details</div>
      <div
        style={{
          fontSize: "0.8rem",
          color: "var(--text-secondary)",
          marginBottom: 16,
        }}
      >
        All fields are optional.
      </div>
      <div style={s.field}>
        <label style={s.label}>Seat</label>
        <input
          style={s.input}
          type="text"
          placeholder="e.g. Section 204, Row 3, Seat 7"
          value={seat}
          onChange={(e) => setSeat(e.target.value)}
        />
      </div>
      <div style={s.field}>
        <label style={s.label}>Price Paid</label>
        <input
          style={s.input}
          type="number"
          placeholder="0.00"
          value={pricePaid}
          onChange={(e) => setPricePaid(e.target.value)}
          min="0"
          step="0.01"
        />
      </div>
      <div style={s.field}>
        <label style={s.label}>Photo</label>
        <input
          type="file"
          accept="image/*"
          style={{
            ...s.input,
            padding: "10px 16px",
            cursor: "pointer",
          }}
          onChange={() => {
            /* placeholder for R2 integration */
          }}
        />
        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-secondary)",
            marginTop: 4,
          }}
        >
          Photo upload coming soon
        </div>
      </div>
    </div>
  );

  const renderStep5_Review = () => {
    const kindLabel = KIND_CONFIG.find((k) => k.kind === kind)?.label ?? "";

    return (
      <div>
        <div style={s.stepTitle}>Review &amp; Save</div>
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={s.reviewSection}>
            <div style={s.reviewLabel}>Type</div>
            <div style={s.reviewValue}>{kindLabel}</div>
          </div>
          <div style={s.reviewSection}>
            <div style={s.reviewLabel}>Headliner</div>
            <div style={s.reviewValue}>{headliner.name}</div>
          </div>
          <div style={s.reviewSection}>
            <div style={s.reviewLabel}>Venue</div>
            <div style={s.reviewValue}>
              {venue.name}
              {venue.city ? ` • ${venue.city}` : ""}
            </div>
          </div>
          <div style={s.reviewSection}>
            <div style={s.reviewLabel}>Date</div>
            <div style={s.reviewValue}>
              {date}
              {endDate ? ` to ${endDate}` : ""}
            </div>
          </div>
          {tourName && (
            <div style={s.reviewSection}>
              <div style={s.reviewLabel}>Tour</div>
              <div style={s.reviewValue}>{tourName}</div>
            </div>
          )}
          {setlist && setlist.length > 0 && (
            <div style={s.reviewSection}>
              <div style={s.reviewLabel}>Setlist</div>
              <div style={s.reviewValue}>
                {setlist.map((song, i) => (
                  <span key={i} style={s.tag}>
                    {song}
                  </span>
                ))}
              </div>
            </div>
          )}
          {performers.length > 0 && (
            <div style={s.reviewSection}>
              <div style={s.reviewLabel}>
                {kind === "theatre" ? "Cast" : "Other Performers"}
              </div>
              <div style={s.reviewValue}>
                {performers.map((p, i) => (
                  <div key={i} style={{ fontSize: "0.85rem", marginBottom: 2 }}>
                    {p.name}
                    {p.characterName && (
                      <span style={{ color: "var(--text-secondary)" }}>
                        {" "}
                        as {p.characterName}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {seat && (
            <div style={s.reviewSection}>
              <div style={s.reviewLabel}>Seat</div>
              <div style={s.reviewValue}>{seat}</div>
            </div>
          )}
          {pricePaid && (
            <div style={s.reviewSection}>
              <div style={s.reviewLabel}>Price Paid</div>
              <div style={s.reviewValue}>${pricePaid}</div>
            </div>
          )}
        </div>

        {createShow.isError && (
          <div style={s.error}>
            Failed to save show. Please try again.
          </div>
        )}
      </div>
    );
  };

  const renderFormStep = () => {
    switch (step) {
      case 0:
        return renderStep0_Kind();
      case 1:
        return renderStep1_Headliner();
      case 2:
        return renderStep2_VenueDate();
      case 3:
        return renderStep3_Enrichment();
      case 4:
        return renderStep4_Personal();
      case 5:
        return renderStep5_Review();
      default:
        return null;
    }
  };

  const renderFormMode = () => (
    <div>
      {/* Progress bar */}
      <div style={s.progress}>
        {STEPS.map((_, i) => (
          <div key={i} style={s.progressDot(i === step, i < step)} />
        ))}
      </div>

      {/* Step content */}
      {renderFormStep()}

      {/* Navigation */}
      <div style={s.nav}>
        {step > 0 ? (
          <button
            type="button"
            style={s.btn("secondary")}
            onClick={() => setStep((prev) => prev - 1)}
          >
            Back
          </button>
        ) : (
          <div />
        )}

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            style={{
              ...s.btn("primary"),
              opacity: canProceed() ? 1 : 0.4,
              cursor: canProceed() ? "pointer" : "not-allowed",
            }}
            onClick={() => canProceed() && setStep((prev) => prev + 1)}
            disabled={!canProceed()}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            style={{
              ...s.btn("primary"),
              opacity: createShow.isPending ? 0.6 : 1,
            }}
            onClick={handleFormSave}
            disabled={createShow.isPending}
          >
            {createShow.isPending ? "Saving..." : "Save Show"}
          </button>
        )}
      </div>
    </div>
  );

  const renderChatMode = () => (
    <div style={s.chatContainer}>
      <div style={s.chatMessages}>
        {chatMessages.map((msg, i) => (
          <div key={i} style={s.chatBubble(msg.role === "user")}>
            {msg.content.split("\n").map((line, j) => (
              <div key={j}>{line || " "}</div>
            ))}
          </div>
        ))}
        {parseChat.isPending && (
          <div style={s.chatBubble(false)}>Thinking...</div>
        )}
      </div>

      {chatParsed && !chatConfirmed && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            style={s.btn("primary")}
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
            style={s.btn("secondary")}
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

      <div style={s.chatInputRow}>
        <textarea
          style={s.textarea}
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
          style={s.btn("primary")}
          onClick={handleChatSend}
          disabled={parseChat.isPending || !chatInput.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );

  // ── Main Render ────────────────────────────────────────────

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={s.title}>Add Show</div>
        <SegmentedControl
          options={["Form", "Chat"]}
          selected={mode}
          onChange={(v) => setMode(v as Mode)}
        />
      </div>

      {mode === "Form" ? renderFormMode() : renderChatMode()}
    </div>
  );
}
