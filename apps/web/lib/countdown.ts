// Calendar-day countdown label used by the home page hero and upcoming rail.
// `dateStr` is a zone-less calendar date (YYYY-MM-DD) or full ISO timestamp.
export function countdownText(dateStr: string | null): string {
  if (!dateStr) return "date TBD";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // Anchor zone-less calendar dates to local midnight so the `new Date()`
  // UTC-parse doesn't shift the day in zones west of UTC.
  const target = new Date(dateStr.includes("T") ? dateStr : `${dateStr}T00:00:00`);
  target.setHours(0, 0, 0, 0);
  // Round (not ceil) so DST 23h / 25h days still resolve to whole calendar days.
  const days = Math.round(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "tonight";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
