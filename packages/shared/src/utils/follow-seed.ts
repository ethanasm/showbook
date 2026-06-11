/**
 * Follow seeding — derive one-tap "Follow X" suggestions from a show the
 * user just saved. The user told us exactly which artist and venue they
 * care about; offering the follow at the save confirmation is the moment
 * the Discover feed stops being a cold start.
 *
 * Shared between the web Add toast and the mobile chat confirmation card
 * so both surfaces agree on what's followable.
 */

import { isVenuePlaceholder } from './format';

export interface FollowSeedEntity {
  id: string;
  name: string;
}

export interface FollowSeedSuggestions {
  /** Headliner to offer following, or null when not applicable. */
  performer: FollowSeedEntity | null;
  /** Venue to offer following, or null when not applicable. */
  venue: FollowSeedEntity | null;
}

/**
 * Structural subset of the expanded show shape returned by
 * `shows.create` / `shows.detail` (venue + showPerformers w/ performer).
 */
export interface FollowSeedShowLike {
  kind: string;
  venue?: {
    id: string;
    name: string;
    city?: string | null;
  } | null;
  showPerformers?:
    | Array<
        | {
            role: string;
            sortOrder: number;
            performer: { id: string; name: string } | null;
          }
        | null
        | undefined
      >
    | null;
}

/**
 * Kinds whose headliner is a followable touring act. Theatre lineups are
 * cast members and festivals have no single headliner — for those only
 * the venue suggestion applies.
 */
const PERFORMER_FOLLOW_KINDS = new Set(['concert', 'comedy']);

/**
 * Placeholder venue identities produced by the chat quick-save path
 * (`venue_hint` missing → "Unknown Venue" / city "Unknown"). Following
 * one of those rows would seed Discover with noise.
 */
function isPlaceholderVenue(venue: { name: string; city?: string | null }): boolean {
  const name = venue.name.trim();
  if (!name || name.toLowerCase() === 'unknown venue' || isVenuePlaceholder(name)) {
    return true;
  }
  return isVenuePlaceholder(venue.city);
}

export function deriveFollowSuggestions(
  show: FollowSeedShowLike,
  opts: {
    followedPerformerIds?: Iterable<string>;
    followedVenueIds?: Iterable<string>;
  } = {},
): FollowSeedSuggestions {
  const followedPerformers = new Set(opts.followedPerformerIds ?? []);
  const followedVenues = new Set(opts.followedVenueIds ?? []);

  let performer: FollowSeedEntity | null = null;
  if (PERFORMER_FOLLOW_KINDS.has(show.kind)) {
    const headliner = (show.showPerformers ?? [])
      .filter(
        (sp): sp is { role: string; sortOrder: number; performer: { id: string; name: string } } =>
          Boolean(sp && sp.performer && sp.role === 'headliner'),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder)[0];
    if (
      headliner &&
      headliner.performer.name.trim().length > 0 &&
      !followedPerformers.has(headliner.performer.id)
    ) {
      performer = { id: headliner.performer.id, name: headliner.performer.name };
    }
  }

  let venue: FollowSeedEntity | null = null;
  const v = show.venue;
  if (v && !isPlaceholderVenue(v) && !followedVenues.has(v.id)) {
    venue = { id: v.id, name: v.name };
  }

  return { performer, venue };
}
