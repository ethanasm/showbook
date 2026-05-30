export const Kind = {
  CONCERT: 'concert',
  THEATRE: 'theatre',
  COMEDY: 'comedy',
  FESTIVAL: 'festival',
  FILM: 'film',
  UNKNOWN: 'unknown',
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export const KIND_COLORS = {
  concert: { light: '#2E6FD9', dark: '#3A86FF' },
  theatre: { light: '#D42F3A', dark: '#E63946' },
  comedy: { light: '#8340C4', dark: '#9D4EDD' },
  festival: { light: '#238577', dark: '#2A9D8F' },
  film: { light: '#5A4FCF', dark: '#7B6FE0' },
  unknown: { light: '#6B7280', dark: '#9CA3AF' },
} as const;

export const KIND_LABELS = {
  concert: 'Concert',
  theatre: 'Theatre',
  comedy: 'Comedy',
  festival: 'Festival',
  film: 'Film',
  unknown: 'Unknown',
} as const;

// Single-character emoji glyphs used as a typographic icon for each show
// kind in surfaces that prefer an inline character over a Lucide SVG (e.g.
// the Add page's compact kind picker and the right-rail LivePreview). All
// four are well-supported emoji in both the iOS and Android system fonts,
// so the same glyph renders with a colour pictograph on every platform —
// avoiding the old-Unicode-fallback split (♫ / ★ rendering as serif text
// while 🎭 / 🎙 render as colour emoji) the original set produced.
// The Lucide equivalents live in `apps/web/lib/kind-icons.ts` for surfaces
// that want the full icon component instead.
export const KIND_GLYPHS = {
  concert: '🎵',
  theatre: '🎭',
  comedy: '🎙',
  festival: '🎪',
} as const;

// Kinds that can be the `kind` of a show on a user's watchlist. Film and
// unknown are surfaced on the Discover feed but cannot (yet) be added as
// shows — `discover.watch` rejects them and the UI hides the Watch button.
// Keep this list in lockstep with the WATCHABLE_KINDS check in
// packages/api/src/routers/discover.ts.
export const NON_WATCHABLE_KINDS = ['film', 'unknown'] as const;
export type NonWatchableKind = (typeof NON_WATCHABLE_KINDS)[number];

export function isNonWatchableKind(kind: string): kind is NonWatchableKind {
  return (NON_WATCHABLE_KINDS as readonly string[]).includes(kind);
}
