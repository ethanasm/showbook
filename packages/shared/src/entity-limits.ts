/**
 * In-code registry of per-user entity caps — the "how many can I keep?"
 * knobs for the Discover surfaces. Mirrors the `feature-flags.ts` pattern:
 * values live here and change by PR (no env vars, no remote config), so a
 * cap is defined exactly once and can never drift between the 400 the
 * server throws and the disabled-state hint the web / mobile clients show.
 *
 * Each limit is consumed in two places:
 *   - server-side enforcement in the tRPC mutation that creates the row,
 *     which throws `entityLimitExceededError(key)` on overflow;
 *   - client-side disabled state in the web + mobile "add" UI, gated on
 *     `canAddEntity(key, currentCount)` and labelled with
 *     `entityLimitReachedHint(key)`.
 *
 * `nounPlural` is the human label used to build both messages, so the copy
 * stays in lock-step with the number.
 */
export const EntityLimit = {
  regions: {
    max: 5,
    nounPlural: 'regions',
    description:
      'Saved Discover regions per user. Enforced server-side in ' +
      '`preferences.addRegion` and surfaced as a disabled "Add region" ' +
      'state on the web Preferences + Discover surfaces and the mobile ' +
      'Regions editor + Discover add sheet.',
  },
  venues: {
    max: 100,
    nounPlural: 'venues',
    description:
      'Followed venues per user. NOT yet enforced — the cap is declared ' +
      'here so the number has a single home, but the `venues.follow` ' +
      'server guard and the matching disabled-state UI land in a ' +
      'follow-up PR.',
  },
  artists: {
    max: 250,
    nounPlural: 'artists',
    description:
      'Followed artists per user. NOT yet enforced — see the `venues` ' +
      'note above; the `performers.follow` / `followAttraction` guard and ' +
      'its UI ship in the same follow-up PR.',
  },
} as const satisfies Record<
  string,
  { max: number; nounPlural: string; description: string }
>;

export type EntityLimitKey = keyof typeof EntityLimit;

/** The configured cap for an entity type. */
export function entityLimit(key: EntityLimitKey): number {
  return EntityLimit[key].max;
}

/**
 * `true` iff the user is below the cap for `key` and may add another.
 * Negative / non-finite counts are treated as zero — the server is the
 * source of truth, so this is only a UI hint, never a security boundary.
 */
export function canAddEntity(key: EntityLimitKey, currentCount: number): boolean {
  if (!Number.isFinite(currentCount) || currentCount < 0) return true;
  return currentCount < EntityLimit[key].max;
}

/**
 * Persistent hint shown next to a disabled "add" control once the cap is
 * hit, e.g. "Maximum 5 regions — remove one to add another."
 */
export function entityLimitReachedHint(key: EntityLimitKey): string {
  const { max, nounPlural } = EntityLimit[key];
  return `Maximum ${max} ${nounPlural} — remove one to add another.`;
}

/**
 * Error message thrown by the server-side guard when an add would exceed
 * the cap, e.g. "You can have at most 5 regions."
 */
export function entityLimitExceededError(key: EntityLimitKey): string {
  const { max, nounPlural } = EntityLimit[key];
  return `You can have at most ${max} ${nounPlural}.`;
}
