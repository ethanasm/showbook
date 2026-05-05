export const Kind = {
  CONCERT: 'concert',
  THEATRE: 'theatre',
  COMEDY: 'comedy',
  FESTIVAL: 'festival',
  SPORTS: 'sports',
  FILM: 'film',
  UNKNOWN: 'unknown',
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const KIND_COLORS = {
  concert: { light: '#2E6FD9', dark: '#3A86FF' },
  theatre: { light: '#D42F3A', dark: '#E63946' },
  comedy: { light: '#8340C4', dark: '#9D4EDD' },
  festival: { light: '#238577', dark: '#2A9D8F' },
  sports: { light: '#D06A28', dark: '#E8772E' },
  film: { light: '#5A4FCF', dark: '#7B6FE0' },
  unknown: { light: '#6B7280', dark: '#9CA3AF' },
} as const;

export const KIND_LABELS = {
  concert: 'Concert',
  theatre: 'Theatre',
  comedy: 'Comedy',
  festival: 'Festival',
  sports: 'Sports',
  film: 'Film',
  unknown: 'Unknown',
} as const;

// Kinds that can be the `kind` of a show on a user's watchlist. Sports,
// film, and unknown are surfaced on the Discover feed but cannot (yet) be
// added as shows — `discover.watch` rejects them and the UI hides the
// Watch button. Keep this list in lockstep with the WATCHABLE_KINDS check
// in packages/api/src/routers/discover.ts.
export const NON_WATCHABLE_KINDS = ['sports', 'film', 'unknown'] as const;
export type NonWatchableKind = (typeof NON_WATCHABLE_KINDS)[number];

export function isNonWatchableKind(kind: string): kind is NonWatchableKind {
  return (NON_WATCHABLE_KINDS as readonly string[]).includes(kind);
}
