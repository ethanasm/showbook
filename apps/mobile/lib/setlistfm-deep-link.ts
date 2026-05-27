/**
 * Mobile setlist.fm deep-link resolver for the artist detail hero.
 *
 * setlist.fm doesn't publish a native iOS/Android URL scheme and the
 * direct-to-artist URL pattern (`/setlists/<slug>-<reverse-mbid>.html`)
 * uses an undocumented MBID-to-slug encoding that's brittle to compute
 * client-side — different "Taylor Swift"-style URLs we've tested in
 * the past resolved to a totally different artist. So we use the
 * documented name search, which reliably lands on a "Found artist:"
 * results page that links directly to the artist's setlists when the
 * name is a strong match.
 *
 * The React layer in `app/artists/[id].tsx` wires this up to
 * `WebBrowser.openBrowserAsync` (with `Linking.openURL` as a fallback)
 * — there's no native scheme to try first.
 */

export interface SetlistfmOpenPlan {
  /** Universal web URL — opens setlist.fm search results in the browser. */
  url: string;
}

/**
 * Build the open-in-setlist.fm plan for a performer. Returns null
 * when the performer has no name to search — the button should be
 * hidden in that case.
 *
 * Caller pattern:
 *
 *   const plan = buildSetlistfmOpenPlan(performer.name);
 *   if (!plan) return null;
 *   try { await WebBrowser.openBrowserAsync(plan.url); }
 *   catch { await Linking.openURL(plan.url); }
 */
export function buildSetlistfmOpenPlan(
  performerName: string | null | undefined,
): SetlistfmOpenPlan | null {
  const trimmed = (performerName ?? '').trim();
  if (!trimmed) return null;

  // URLSearchParams turns " " into "+", which setlist.fm's search
  // accepts. Encoding the colon / slash / etc. is also fine — the
  // search box treats them as plain query text.
  const params = new URLSearchParams();
  params.set('query', trimmed);
  return { url: `https://www.setlist.fm/search?${params.toString()}` };
}
