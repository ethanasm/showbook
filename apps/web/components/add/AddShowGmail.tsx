"use client";

import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";
import { mono, sans } from "@/app/(app)/add/constants";
import type { GmailResult } from "@/app/(app)/add/types";

type ScanGmailMutation = ReturnType<typeof trpc.enrichment.scanGmailForShow.useMutation>;

export interface GmailImportApi {
  scanning: boolean;
  results: GmailResult[];
  showResults: boolean;
  start: () => void;
  hide: () => void;
}

/**
 * Drives the per-show Gmail scan that powers the headliner-card
 * "Gmail receipts" import on the Add page: opens the OAuth popup,
 * waits for the postMessage with an access token, then calls
 * `enrichment.scanGmailForShow` to find ticket emails matching the
 * already-entered headliner. The dropdown surfaces matches that the
 * user can click to autofill the form.
 *
 * This is distinct from the bulk Gmail importer on the shows list —
 * that one scans the whole inbox without a headliner hint.
 */
export function useAddShowGmail(args: {
  scanGmailForShow: ScanGmailMutation;
  getHeadlinerName: () => string;
  getVenueName: () => string;
}): GmailImportApi {
  const { scanGmailForShow, getHeadlinerName, getVenueName } = args;
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<GmailResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  const start = useCallback(() => {
    const headlinerName = getHeadlinerName();
    if (!headlinerName || headlinerName.length < 2) {
      setShowResults(false);
      return;
    }
    setScanning(true);
    setShowResults(true);

    const popup = window.open("/api/gmail", "gmail-auth", "width=500,height=600,popup=yes");

    const handler = async (e: MessageEvent) => {
      if (e.data?.type === "gmail-auth" && e.data.accessToken) {
        window.removeEventListener("message", handler);
        try {
          const venueName = getVenueName();
          const next = await scanGmailForShow.mutateAsync({
            accessToken: e.data.accessToken,
            headliner: headlinerName,
            venue: venueName || undefined,
          });
          setResults(next);
        } catch {
          setResults([]);
        } finally {
          setScanning(false);
        }
      }
      if (e.data?.type === "gmail-auth-error") {
        window.removeEventListener("message", handler);
        setScanning(false);
        setResults([]);
      }
    };
    window.addEventListener("message", handler);

    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        window.removeEventListener("message", handler);
        setScanning(false);
      }
    }, 500);
  }, [scanGmailForShow, getHeadlinerName, getVenueName]);

  const hide = useCallback(() => setShowResults(false), []);

  return { scanning, results, showResults, start, hide };
}

interface AddShowGmailProps {
  gmail: GmailImportApi;
  headlinerName: string;
  onSelect: (result: GmailResult) => void;
}

export function AddShowGmail({ gmail, headlinerName, onSelect }: AddShowGmailProps) {
  if (!gmail.showResults) return null;
  return (
    <div style={{ marginTop: 8, border: "1px solid var(--rule-strong)", background: "var(--surface)" }}>
      {gmail.scanning && (
        <div style={{ padding: "14px 16px", fontFamily: mono, fontSize: 11, color: "var(--muted)", letterSpacing: ".04em" }}>
          Scanning Gmail for &ldquo;{headlinerName}&rdquo;...
        </div>
      )}
      {!gmail.scanning && gmail.results.length === 0 && (
        <div style={{ padding: "14px 16px", fontFamily: mono, fontSize: 11, color: "var(--faint)", letterSpacing: ".04em" }}>
          No ticket emails found
        </div>
      )}
      {gmail.results.map((result, i) => (
        <div
          key={i}
          onClick={() => {
            onSelect(result);
            gmail.hide();
          }}
          style={{ padding: "10px 16px", cursor: "pointer", borderTop: i > 0 ? "1px solid var(--rule)" : "none", display: "flex", flexDirection: "column", gap: 3 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)", letterSpacing: -0.1 }}>
            {result.headliner}
          </div>
          <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", letterSpacing: ".04em", display: "flex", gap: 12 }}>
            {result.venue_name && <span>{result.venue_name}</span>}
            {result.date && <span>{result.date}</span>}
            {result.seat && <span>{result.seat}</span>}
            {result.price && <span>${result.price}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
