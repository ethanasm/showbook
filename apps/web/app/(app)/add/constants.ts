import type { ShowKind } from "@/components/design-system";
import type { Timeframe } from "./types";

export const KIND_CONFIG: {
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

export const TIMEFRAME_CONFIG: {
  key: Timeframe;
  label: string;
  sub: string;
}[] = [
  { key: "past", label: "past", sub: "already went" },
  { key: "upcoming", label: "upcoming", sub: "have tickets" },
  { key: "watching", label: "watching", sub: "radar · no tix" },
];

export const IMPORT_SOURCES = [
  { tag: "url", label: "Ticketmaster URL", sub: "paste a link" },
  { tag: "pdf", label: "PDF ticket", sub: "drag or upload" },
  { tag: "mail", label: "Gmail receipts", sub: "scan inbox" },
];

export const mono = "var(--font-geist-mono), monospace";
export const sans = "var(--font-geist-sans), sans-serif";
