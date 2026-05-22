import { KIND_GLYPHS, KIND_LABELS } from "@showbook/shared";
import type { ShowKind } from "@/components/design-system";
import type { Timeframe } from "./types";

const ENRICHMENT_HINTS: Record<ShowKind, string> = {
  concert: "setlist.fm",
  theatre: "playbill",
  comedy: "tour · material",
  festival: "multi-day lineup",
};

export const KIND_CONFIG: {
  kind: ShowKind;
  label: string;
  icon: string;
  enrichmentHint: string;
}[] = (["concert", "theatre", "comedy", "festival"] as const).map((k) => ({
  kind: k,
  label: KIND_LABELS[k],
  icon: KIND_GLYPHS[k],
  enrichmentHint: ENRICHMENT_HINTS[k],
}));

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
