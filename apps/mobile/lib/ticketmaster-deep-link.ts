/**
 * Mobile Ticketmaster deep-link resolver.
 *
 * Tapping a "TIX" / "Tickets" affordance should hand off to the native
 * Ticketmaster app when installed (`ticketmaster://event/{id}`),
 * else fall back to the original https URL via `Linking.openURL`.
 *
 * Mirrors the Spotify resolver in `setlist-intel/spotify-deep-link.ts`:
 * pure helpers live here, the React layer calls `Linking.openURL`
 * directly on the `primary` and falls through to the `fallback` on
 * rejection. `Linking.canOpenURL` is intentionally not used — it
 * requires the scheme to be declared in iOS `LSApplicationQueriesSchemes`
 * (we do declare `ticketmaster` for parity with Spotify) but the
 * openURL rejection is the more reliable signal across SDK versions.
 */

// Ticketmaster event IDs are alphanumeric (typically hex, sometimes
// with a leading vendor prefix). Match a `/event/{id}` segment on any
// ticketmaster.* host (`.com`, `.ca`, `.co.uk`, `.com.au`, etc.) and
// any subdomain (`www`, `concerts`, etc.). Trailing path / query is
// tolerated so affiliate-tracked links still parse.
const TM_EVENT_URL_RE =
  /^https?:\/\/(?:[a-z0-9-]+\.)*ticketmaster\.[a-z.]+\/(?:[^?#]*\/)?event\/([A-Za-z0-9]+)(?:[/?#].*)?$/i;

/**
 * Extract the Ticketmaster event id from a URL.
 *
 * Returns null for anything that isn't recognisably a Ticketmaster
 * event URL (affiliate redirects through `on.fgtix.com`, Live Nation
 * checkout links, etc.) — callers should fall back to opening the raw
 * URL with `Linking.openURL`.
 */
export function extractTicketmasterEventId(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  const match = trimmed.match(TM_EVENT_URL_RE);
  return match?.[1] ?? null;
}

export function buildTicketmasterNativeDeepLink(eventId: string): string {
  return `ticketmaster://event/${eventId}`;
}

export interface TicketmasterOpenPlan {
  /** URL to attempt first (native deep link when possible). */
  primary: string;
  /** URL to fall back to when the native scheme isn't handled. */
  fallback: string;
}

/**
 * Build the open-in-Ticketmaster plan for a ticket URL. When the URL
 * is a recognisable Ticketmaster event page the plan prefers the
 * native scheme; otherwise both sides are the raw URL so the caller's
 * try / catch flow stays uniform.
 */
export function buildTicketmasterOpenPlan(
  url: string | null | undefined,
): TicketmasterOpenPlan {
  const id = extractTicketmasterEventId(url);
  const raw = (url ?? '').trim();
  if (id) {
    return { primary: buildTicketmasterNativeDeepLink(id), fallback: raw };
  }
  return { primary: raw, fallback: raw };
}

/**
 * Open a Ticketmaster URL — native app first, web fallback on
 * rejection. The optional `openURL` argument is for tests; in app
 * code, pass `Linking.openURL` from `react-native`.
 */
export async function openTicketmasterUrl(
  url: string,
  openURL: (target: string) => Promise<unknown>,
): Promise<void> {
  const plan = buildTicketmasterOpenPlan(url);
  if (plan.primary && plan.primary !== plan.fallback) {
    try {
      await openURL(plan.primary);
      return;
    } catch {
      // Ticketmaster app not installed — fall through to the web URL.
    }
  }
  await openURL(plan.fallback);
}
