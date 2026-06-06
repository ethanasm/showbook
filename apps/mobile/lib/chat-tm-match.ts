/**
 * Chat-add Ticketmaster matching for mobile.
 *
 * After the LLM parses free text into a structured show, the chat
 * screen offers a "did you mean one of these?" picker of upcoming
 * Ticketmaster events — the same convenience the web chat-add flow has.
 * The date gate (`isUpcomingDateHint`) and search window (`tmDateWindow`)
 * are shared with web via `@showbook/shared` so both surfaces only run
 * the lookup for shows the user is *going* to see — never past shows,
 * which Ticketmaster's catalogue doesn't expose anyway.
 *
 * `tmResultToFormParams` turns a picked `enrichment.searchTM` result
 * into the `/add/form` query params, mirroring the web Form-tab prefill
 * (`handleSelectTmResult`): for concerts/comedy the first attraction is
 * the headliner and the rest become support; for festivals every
 * attraction is a lineup row under the festival name; theatre carries
 * only the production (cast comes from a playbill later).
 */
import { isUpcomingDateHint, tmDateWindow } from '@showbook/shared';

export { isUpcomingDateHint, tmDateWindow };

/** The subset of an `enrichment.searchTM` row the chat picker needs. */
export interface TmChatMatch {
  tmEventId: string;
  name: string;
  date: string;
  venueName: string | null;
  venueCity: string | null;
  kind: string;
  performers: { name: string; tmAttractionId: string; imageUrl: string | null }[];
}

type FormKind = 'concert' | 'theatre' | 'comedy' | 'festival';

function normalizeKind(kind: string): FormKind {
  const k = kind?.toLowerCase();
  if (k === 'theatre' || k === 'comedy' || k === 'festival') return k;
  // film / unknown / anything else falls back to the form's default —
  // the user can still adjust the kind before saving.
  return 'concert';
}

/**
 * Build the `/add/form` query params that pre-fill the add-show form
 * from a picked Ticketmaster match. Shares the form's param contract
 * with the festival-poster and future-shows deep-links: `headliner`
 * doubles as the production / festival name for theatre / festival,
 * and `performersJson` carries the support lineup.
 */
export function tmResultToFormParams(match: TmChatMatch): Record<string, string> {
  const kind = normalizeKind(match.kind);

  const toRow = (p: TmChatMatch['performers'][number]) => {
    const row: {
      name: string;
      tier: 'support';
      tmAttractionId?: string;
      imageUrl?: string;
    } = { name: p.name, tier: 'support' };
    if (p.tmAttractionId) row.tmAttractionId = p.tmAttractionId;
    if (p.imageUrl) row.imageUrl = p.imageUrl;
    return row;
  };

  let headliner: string;
  let lineup: ReturnType<typeof toRow>[];
  if (kind === 'festival') {
    // Festival: the event name is the festival; every attraction is lineup.
    headliner = match.name;
    lineup = match.performers.map(toRow);
  } else if (kind === 'theatre') {
    // Theatre: production name only; cast comes from a playbill later.
    headliner = match.name;
    lineup = [];
  } else {
    // Concert / comedy: first attraction headlines, the rest support.
    headliner = match.performers[0]?.name ?? match.name;
    lineup = match.performers.slice(1).map(toRow);
  }

  const params: Record<string, string> = {
    kindHint: kind,
    headliner,
    dateHint: match.date,
  };
  if (match.venueName) params.venueHint = match.venueName;
  if (match.venueCity) params.venueCity = match.venueCity;
  if (lineup.length > 0) params.performersJson = JSON.stringify(lineup);
  return params;
}
