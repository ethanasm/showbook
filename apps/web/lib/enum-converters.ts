/**
 * Tiny enum ↔ display-label converter. The Preferences SegmentedControls
 * read display strings ("Light", "Always blur") but persist enum keys
 * ("light", "always_blur"), so each one needs a pair of
 * `valueToDisplay` / `displayToValue` functions. Building each pair
 * from a single record keeps them in sync — adding a new option flips
 * both directions at once and TypeScript catches stale display labels.
 */
export interface EnumConverter<T extends string> {
  /** Display labels in the canonical order, suitable for `<SegmentedControl options=…>`. */
  options: string[];
  /** Enum value → display label. Falls back to the first value's label if the input is unknown. */
  toDisplay(value: T | null | undefined): string;
  /** Display label → enum value. Falls back to the first value if the input is unknown. */
  fromDisplay(display: string): T;
}

export function makeEnumConverter<T extends string>(
  entries: Record<T, string>,
): EnumConverter<T> {
  const values = Object.keys(entries) as T[];
  const options = values.map((v) => entries[v]);
  const reverse = new Map<string, T>(values.map((v) => [entries[v], v]));
  const fallback = values[0]!;
  return {
    options,
    toDisplay(value) {
      if (value == null) return entries[fallback];
      return entries[value as T] ?? entries[fallback];
    },
    fromDisplay(display) {
      return reverse.get(display) ?? fallback;
    },
  };
}

export const themeConverter = makeEnumConverter({
  system: "System",
  light: "Light",
  dark: "Dark",
});

// Phase 11 §15o — spoiler-blur preference options + serialization.
// `style_default` respects the per-prediction blur (stable + theatrical
// default ON; rotating + improvised default OFF). `always_blur` /
// `never_blur` force the behavior across the predicted-setlist tab AND
// the daily digest tile.
export const setlistSpoilersConverter = makeEnumConverter({
  style_default: "Style default",
  always_blur: "Always blur",
  never_blur: "Never blur",
});
