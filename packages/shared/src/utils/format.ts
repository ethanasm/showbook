export function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(num);
}

export function formatSeatDisplay(seat: string): string {
  return seat.toUpperCase();
}

// Placeholder city values some creation paths persist when the source
// (festival poster, free-text Add chat, Spotify import) didn't carry a
// real city. We strip these before joining a venue label so the user
// doesn't see "Bottlerock · Napa Valley · Unknown" in the UI. Compared
// case-insensitively against trimmed input.
const VENUE_PLACEHOLDERS = new Set(['unknown', 'tba', 'tbd', 'n/a']);

export function isVenuePlaceholder(value: string | null | undefined): boolean {
  if (!value) return true;
  return VENUE_PLACEHOLDERS.has(value.trim().toLowerCase());
}

export function formatVenueLocation(parts: {
  city?: string | null;
  stateRegion?: string | null;
  country?: string | null;
}): string {
  return [parts.city, parts.stateRegion, parts.country]
    .filter((p) => !isVenuePlaceholder(p))
    .join(', ');
}

export function formatVenueLabel(parts: {
  name?: string | null;
  city?: string | null;
  stateRegion?: string | null;
}): string {
  return [parts.name, parts.city, parts.stateRegion]
    .filter((p) => !isVenuePlaceholder(p))
    .join(' · ');
}
