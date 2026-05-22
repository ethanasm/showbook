"use client";

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useInvalidateSidebarCounts } from "@/lib/sidebar-counts";
import { useRouter } from "next/navigation";
import type { PerformerSetlist } from "@showbook/shared";

export type ImportSource = "gmail" | "setlistfm" | "eventbrite";

export type BulkResult = {
  gmailMessageId?: string;
  headliner: string;
  production_name: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  date: string | null;
  seat: string | null;
  price: string | null;
  ticket_count: number | null;
  kind_hint: "concert" | "theatre" | "comedy" | "festival" | null;
  confidence: "high" | "medium" | "low";
  // Source-specific extras carried through to createShow:
  setlistId?: string;
  musicbrainzId?: string;
  tourName?: string | null;
  setlist?: PerformerSetlist;
  orderId?: string;
  eventId?: string;
};

export interface ScanProgress {
  phase: string;
  processed: number;
  total: number;
  found: number;
}

type DuplicateFn = (ticket: { headliner: string; date: string | null }) => boolean;

interface UseBulkImportScanArgs {
  isDuplicate: DuplicateFn;
}

/**
 * Unified driver for the Gmail / Eventbrite / setlist.fm bulk-import
 * flows on /upcoming and /logbook. The three live as one because they
 * share everything past the initial scan: dedupe-against-existing on
 * load, a checkbox-selectable review list, and a single "Add selected"
 * loop that hands each ticket to `shows.create` with a source-tagged
 * `sourceRefs` payload so the next scan can short-circuit anything
 * already imported.
 *
 * Per-source differences are confined to the three `start*` methods:
 *   - Gmail streams SSE progress events from `/api/gmail/scan` so the
 *     modal can show a per-message progress bar during the LLM
 *     extraction pass.
 *   - Eventbrite POSTs to `/api/eventbrite/scan` and gets back a flat
 *     tickets array (no SSE — Eventbrite's API is paginated, not
 *     streaming).
 *   - setlist.fm goes through the tRPC `imports.setlistfmFetchAttended`
 *     mutation (no OAuth — just the user's public profile name).
 *
 * The hook also owns the gated-consent state for Gmail (Groq AI
 * disclosure) and Eventbrite/Gmail (OAuth disclosure) — the modal
 * renders the disclaimer step before starting the popup, and the hook
 * holds the access token between OAuth-success and the Groq-disclosure
 * acceptance so the scan resumes seamlessly after the user accepts.
 */
export function useBulkImportScan({ isDuplicate }: UseBulkImportScanArgs) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const invalidateSidebarCounts = useInvalidateSidebarCounts();
  const createShow = trpc.shows.create.useMutation();
  const setlistfmFetchAttended = trpc.imports.setlistfmFetchAttended.useMutation();

  const [importSource, setImportSource] = useState<ImportSource | null>(null);
  // Gated OAuth: for gmail/eventbrite the consent disclaimer renders
  // first; the popup only opens once the user explicitly continues.
  const [oauthConsentStarted, setOauthConsentStarted] = useState(false);
  // Groq disclosure gate (GDPR Art. 6 / Art. 28). The first time a
  // user runs a Gmail scan we hold the OAuth access token in state
  // and surface a disclosure modal explaining that email content
  // will be sent to Groq. The modal's Accept button calls
  // `preferences.acceptGmailScan` which sets the timestamp; we then
  // proceed with the held token. On subsequent scans the timestamp
  // is non-null and the modal is skipped.
  const [pendingGmailToken, setPendingGmailToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [gmailAccessToken, setGmailAccessToken] = useState<string | null>(null);
  const [eventbriteAccessToken, setEventbriteAccessToken] = useState<string | null>(null);
  const [setlistfmUsername, setSetlistfmUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);

  const startGmailScan = useCallback(async (token: string) => {
    setLoading(true);
    setProgress(null);
    try {
      const res = await fetch("/api/gmail/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });
      if (!res.ok || !res.body) throw new Error("Scan request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalTickets: BulkResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6));
            if (eventType === "progress") {
              setProgress(data);
            } else if (eventType === "done") {
              finalTickets = data.tickets;
            } else if (eventType === "error") {
              throw new Error(data.message);
            }
          }
        }
      }

      setResults(finalTickets);
      const initialSelected = new Set<number>();
      finalTickets.forEach((t, i) => {
        if (!isDuplicate(t)) initialSelected.add(i);
      });
      setSelected(initialSelected);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      setError(msg);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, [isDuplicate]);

  const startEventbriteScan = useCallback(async (token: string) => {
    setLoading(true);
    setProgress(null);
    try {
      const res = await fetch("/api/eventbrite/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: token }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "Scan failed");
        throw new Error(text || "Scan failed");
      }
      const data = (await res.json()) as {
        tickets: Array<{
          orderId: string;
          eventId: string;
          date: string | null;
          eventName: string | null;
          venueName: string | null;
          venueCity: string | null;
          venueState: string | null;
          price: string | null;
          ticketCount: number;
          kindHint: "concert" | "theatre" | "comedy" | "festival" | null;
          duplicate: boolean;
        }>;
      };
      const mapped: BulkResult[] = data.tickets.map((t) => ({
        headliner: t.eventName ?? "(unknown)",
        production_name: null,
        venue_name: t.venueName,
        venue_city: t.venueCity,
        venue_state: t.venueState,
        date: t.date,
        seat: null,
        price: t.price,
        ticket_count: t.ticketCount,
        kind_hint: t.kindHint,
        confidence: "medium",
        orderId: t.orderId,
        eventId: t.eventId,
      }));
      setResults(mapped);
      const initial = new Set<number>();
      mapped.forEach((t, i) => { if (!isDuplicate(t)) initial.add(i); });
      setSelected(initial);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eventbrite scan failed");
    } finally {
      setLoading(false);
    }
  }, [isDuplicate]);

  const startSetlistfmScan = useCallback(async (username: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await setlistfmFetchAttended.mutateAsync({ username });
      const mapped: BulkResult[] = data.tickets.map((t) => ({
        headliner: t.headliner,
        production_name: null,
        venue_name: t.venueName,
        venue_city: t.venueCity,
        venue_state: t.venueState,
        date: t.date,
        seat: null,
        price: null,
        ticket_count: 1,
        kind_hint: "concert",
        confidence: "high",
        setlistId: t.setlistId,
        musicbrainzId: t.musicbrainzId ?? undefined,
        tourName: t.tourName,
        setlist: t.setlist,
      }));
      setResults(mapped);
      const initial = new Set<number>();
      mapped.forEach((t, i) => { if (!isDuplicate(t)) initial.add(i); });
      setSelected(initial);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "setlist.fm import failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [isDuplicate, setlistfmFetchAttended]);

  const openModal = useCallback((source: ImportSource) => {
    setImportSource(source);
    setResults([]);
    setSelected(new Set());
    setAddedCount(0);
    setGmailAccessToken(null);
    setEventbriteAccessToken(null);
    setSetlistfmUsername("");
    setError(null);
    setProgress(null);
    setOauthConsentStarted(false);
    // OAuth popup does NOT open here — the modal first renders a
    // consent step with the disclaimer; only then does the user click
    // "Continue with Gmail / Eventbrite" which calls
    // `startOauthPopup` to open the popup.
  }, []);

  const closeModal = useCallback(() => setImportSource(null), []);

  const startOauthPopup = useCallback(
    (source: "gmail" | "eventbrite", gmailScanAlreadyAccepted: boolean) => {
      setOauthConsentStarted(true);

      const expectedAuth = source === "gmail" ? "gmail-auth" : "eventbrite-auth";
      const expectedAuthError = source === "gmail" ? "gmail-auth-error" : "eventbrite-auth-error";
      const popupPath = source === "gmail" ? "/api/gmail" : "/api/eventbrite";

      const handler = (e: MessageEvent) => {
        if (e.data?.type === expectedAuth && e.data.accessToken) {
          window.removeEventListener("message", handler);
          if (source === "gmail") {
            setGmailAccessToken(e.data.accessToken);
            // GDPR consent gate. If the user hasn't accepted the
            // Groq-AI disclosure, hold the token in state and let
            // the modal handle it; otherwise scan immediately.
            if (gmailScanAlreadyAccepted) {
              startGmailScan(e.data.accessToken);
            } else {
              setPendingGmailToken(e.data.accessToken);
            }
          } else {
            setEventbriteAccessToken(e.data.accessToken);
            startEventbriteScan(e.data.accessToken);
          }
        }
        if (e.data?.type === expectedAuthError) {
          window.removeEventListener("message", handler);
        }
      };
      window.addEventListener("message", handler);

      const popup = window.open(popupPath, `${source}-auth`, "width=500,height=600,popup=yes");
      if (popup) {
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            window.removeEventListener("message", handler);
          }
        }, 500);
      }
    },
    [startGmailScan, startEventbriteScan],
  );

  const toggleSelected = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const addSelected = useCallback(async () => {
    setAdding(true);
    setAddedCount(0);
    const chosen = results.filter((_, i) => selected.has(i));

    for (const ticket of chosen) {
      try {
        let sourceRefs: Record<string, unknown>;
        if (ticket.setlistId) {
          sourceRefs = { setlistfm: { setlistId: ticket.setlistId } };
        } else if (ticket.orderId) {
          sourceRefs = { eventbrite: { orderId: ticket.orderId, eventId: ticket.eventId } };
        } else if (ticket.gmailMessageId) {
          // Persisted so the next scan can dedup against this message
          // before paying for another LLM call (P4 cross-scan dedup).
          sourceRefs = {
            gmail: true,
            gmailMessageId: ticket.gmailMessageId,
            scanAt: new Date().toISOString(),
          };
        } else {
          sourceRefs = { gmail: true };
        }
        await createShow.mutateAsync({
          kind: ticket.kind_hint ?? "concert",
          headliner: {
            name: ticket.headliner,
            ...(ticket.musicbrainzId ? { musicbrainzId: ticket.musicbrainzId } : {}),
            ...(ticket.setlist ? { setlist: ticket.setlist } : {}),
          },
          venue: {
            name: ticket.venue_name ?? "Unknown Venue",
            city: ticket.venue_city ?? "Unknown",
            stateRegion: ticket.venue_state ?? undefined,
          },
          date: ticket.date ?? new Date().toISOString().split("T")[0],
          seat: ticket.seat ?? undefined,
          pricePaid: ticket.price ?? undefined,
          ticketCount: ticket.ticket_count ?? 1,
          productionName: ticket.production_name ?? undefined,
          tourName: ticket.tourName ?? undefined,
          sourceRefs,
        });
        setAddedCount((prev) => prev + 1);
      } catch {
        // skip failed individual adds
      }
    }

    setAdding(false);
    setImportSource(null);
    await Promise.all([
      utils.shows.invalidate(),
      invalidateSidebarCounts(),
    ]);
    // The logbook/upcoming pages prefetch shows.list on the server and
    // hydrate into the client cache; refresh the RSC so the SSR'd payload
    // also picks up the just-imported rows. router is intentionally not
    // in the dep array — it's stable across renders and adding it has been
    // observed to deterministically break Playwright shard 3 (see #110).
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, selected, createShow, utils, invalidateSidebarCounts]);

  return {
    // modal state
    importSource, openModal, closeModal,
    oauthConsentStarted,
    pendingGmailToken, setPendingGmailToken,
    // scan state
    loading, results, selected, error, progress,
    gmailAccessToken, eventbriteAccessToken,
    setlistfmUsername, setSetlistfmUsername,
    // add-selected state
    adding, addedCount,
    // actions
    startGmailScan,
    startEventbriteScan,
    startSetlistfmScan,
    startOauthPopup,
    toggleSelected,
    addSelected,
  };
}

export type BulkImportScanApi = ReturnType<typeof useBulkImportScan>;
