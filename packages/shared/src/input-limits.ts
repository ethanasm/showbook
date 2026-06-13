/**
 * Maximum character lengths for user-editable free-text fields that flow
 * into the database. Sibling to `entity-limits.ts` (which caps *how many*
 * rows a user may keep); this file caps *how long* a single text value may
 * be, so an authenticated client — especially a buggy or hostile mobile
 * build POSTing straight to tRPC — can't plant a multi-megabyte string into
 * an unbounded Postgres `text` column.
 *
 * Defined exactly once and consumed in three places, so the number can
 * never drift between layers:
 *   - server-side zod `.max(...)` in the tRPC mutation that writes the row;
 *   - the `maxLength` prop on the web `<input>/<textarea>` and the mobile
 *     `<TextInput>` so the client stops the user before the round-trip;
 *   - unit tests that assert the schema rejects an over-cap value.
 *
 * Values are deliberately generous relative to real data (the longest
 * value of any of these in prod is ~70 chars) — the goal is a sane ceiling
 * on payload size, not a UX constraint on legitimate input.
 */
export const InputMaxLength = {
  /** Venue name — canonical (`venues.name`), per-user alias
   * (`user_venue_names.custom_name`), and the create-path
   * `venueInputSchema`. */
  venueName: 200,
  /** Venue city — `venues.city` (create path + admin location edit). */
  venueCity: 200,
  /** Venue state / region — nullable `venues.state_region`. */
  venueRegion: 200,
  /** Venue country — `venues.country`. */
  venueCountry: 120,
  /** Performer name — headliner / support / cast (`performers.name`). */
  performerName: 200,
  /** Theatre cast character name (`show_performers.character_name`). */
  characterName: 200,
  /** Concert tour name (`shows.tour_name`). */
  tourName: 300,
  /** Theatre / comedy production name (`shows.production_name`). */
  productionName: 300,
  /** Seat / section free-text (`shows.seat`). */
  seat: 100,
  /** Per-show personal notes (`shows.notes`). */
  notes: 5000,
  /** Saved Discover region city label (`user_regions.city_name`). */
  regionCity: 200,
  /** A single setlist song title (stored in `shows.setlists` jsonb). */
  setlistSongTitle: 300,
  /** A single setlist song note (stored in `shows.setlists` jsonb). */
  setlistSongNote: 200,
} as const satisfies Record<string, number>;

export type InputLimitKey = keyof typeof InputMaxLength;
