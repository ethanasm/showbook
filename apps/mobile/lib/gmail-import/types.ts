/**
 * Wire shape of a Gmail ticket extracted by `/api/gmail/scan`. Mirrors
 * `ExtractedTicket` in `apps/web/app/api/gmail/scan/route.ts` so the
 * mobile UI can read the SSE payload without a server-type import.
 */
export interface GmailTicket {
  gmailMessageId: string;
  headliner: string;
  production_name: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  date: string | null;
  seat: string | null;
  price: string | null;
  ticket_count: number | null;
  kind_hint: 'concert' | 'theatre' | 'comedy' | 'festival' | null;
  confidence: 'high' | 'medium' | 'low';
}

export type GmailScanPhase = 'searching' | 'processing';

export interface GmailScanProgress {
  phase: GmailScanPhase;
  processed: number;
  total: number;
  found: number;
}

export interface GmailScanDone {
  tickets: GmailTicket[];
  truncated: boolean;
}

export interface GmailScanError {
  message: string;
  /**
   * Upstream Gmail HTTP status when the scan failed inside a Gmail API
   * call. Lets the client distinguish "your Gmail authorization is no
   * longer accepted" (401/403) from "Showbook hit a snag" (everything
   * else) and prompt the right next step.
   */
  status?: number;
}
