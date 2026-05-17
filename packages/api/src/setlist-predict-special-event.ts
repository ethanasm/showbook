/**
 * Phase 11 §15g — special-event detection.
 *
 * When the target date matches a `special_event_rules` row, the
 * predicted-setlist procedure short-circuits the per-style algorithm
 * and returns a `SpecialEventPrediction` carrying the operator-curated
 * explainer copy plus a list of prior matching events for context.
 *
 * Rule discrimination by `rule_kind`:
 *   - 'date_match'         → pattern { month, day } matches target's
 *                            MM-DD (e.g. Phish Halloween).
 *   - 'venue_run'          → pattern { venueNamePattern } matches the
 *                            show's venue (e.g. Sphere residencies).
 *   - 'tour_name_pattern'  → pattern { regex } matches the active
 *                            tour name (operator-curated).
 *
 * The rule lookup happens BEFORE any corpus load — special-event
 * detection is the rare case where we never want to predict.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { db, specialEventRules, tourSetlists } from '@showbook/db';
import { child } from '@showbook/observability';
import type {
  SpecialEventDateMatchPattern,
  SpecialEventEffect,
  SpecialEventTourNamePattern,
  SpecialEventVenueRunPattern,
} from '@showbook/db';

const log = child({ component: 'api.setlist-predict-special-event' });

export type SpecialEventRuleKind =
  | 'date_match'
  | 'venue_run'
  | 'tour_name_pattern';

export interface SpecialEventPastEvent {
  /** Display date "Oct 31, 2024". */
  date: string;
  /** ISO date for sorting. */
  performanceDate: string;
  /** Venue name from the corpus row (raw setlist.fm string). */
  venueName: string | null;
  /** Total song count of the prior setlist — for the "21 songs"
   *  context line under each prior event. */
  songCount: number;
}

export interface SpecialEventPrediction {
  style: 'special_event';
  /** Performer this rule fired for. */
  performerId: string;
  /** Rule kind that fired — surfaced for observability + the admin
   *  UI ribbon ("Halloween rule"). */
  ruleKind: SpecialEventRuleKind;
  /** Rule row id for the admin-UI link to the rule editor. */
  ruleId: string;
  /** Operator-curated copy. UI renders this verbatim in the special-
   *  event card body. */
  copy: string;
  /** Prior events that matched the same rule, newest first. */
  pastEvents: SpecialEventPastEvent[];
  /** Always 0 — the prediction is explicitly suppressed. */
  confidence: 0;
  sampleSize: number;
}

interface LookupOpts {
  performerId: string;
  targetDate: string; // YYYY-MM-DD
  venueName: string | null;
  activeTourName?: string | null;
}

interface RuleRow {
  id: string;
  ruleKind: string;
  pattern: unknown;
  effect: unknown;
}

/**
 * Look up an applicable special-event rule for the given performer +
 * target. Returns null when no rule matches.
 */
export async function lookupSpecialEventRule(
  opts: LookupOpts,
): Promise<SpecialEventPrediction | null> {
  const rules = await db
    .select({
      id: specialEventRules.id,
      ruleKind: specialEventRules.ruleKind,
      pattern: specialEventRules.pattern,
      effect: specialEventRules.effect,
    })
    .from(specialEventRules)
    .where(
      and(
        eq(specialEventRules.performerId, opts.performerId),
        eq(specialEventRules.active, true),
      ),
    );

  if (rules.length === 0) return null;

  for (const rule of rules) {
    if (matches(rule, opts)) {
      const effect = parseEffect(rule.effect);
      const sampleCount = effect.sampleCount ?? 5;
      const pastEvents = await loadPastEvents({
        performerId: opts.performerId,
        rule,
        sampleCount,
      });

      log.info(
        {
          event: 'setlist.special_event.matched',
          performerId: opts.performerId,
          ruleId: rule.id,
          ruleKind: rule.ruleKind,
          performanceDate: opts.targetDate,
        },
        'special-event rule matched',
      );

      return {
        style: 'special_event',
        performerId: opts.performerId,
        ruleKind: rule.ruleKind as SpecialEventRuleKind,
        ruleId: rule.id,
        copy: effect.copy,
        pastEvents,
        confidence: 0,
        sampleSize: pastEvents.length,
      };
    }
  }

  return null;
}

function matches(rule: RuleRow, opts: LookupOpts): boolean {
  const pattern = rule.pattern;
  switch (rule.ruleKind) {
    case 'date_match': {
      const p = pattern as SpecialEventDateMatchPattern;
      if (typeof p?.month !== 'number' || typeof p?.day !== 'number') return false;
      const target = new Date(`${opts.targetDate}T00:00:00Z`);
      return target.getUTCMonth() + 1 === p.month && target.getUTCDate() === p.day;
    }
    case 'venue_run': {
      const p = pattern as SpecialEventVenueRunPattern;
      if (!opts.venueName || typeof p?.venueNamePattern !== 'string') return false;
      return opts.venueName.toLowerCase().includes(p.venueNamePattern.toLowerCase());
    }
    case 'tour_name_pattern': {
      const p = pattern as SpecialEventTourNamePattern;
      if (!opts.activeTourName || typeof p?.regex !== 'string') return false;
      try {
        return new RegExp(p.regex, 'i').test(opts.activeTourName);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}

function parseEffect(raw: unknown): SpecialEventEffect {
  if (!raw || typeof raw !== 'object') return { copy: '' };
  const e = raw as Partial<SpecialEventEffect>;
  return {
    copy: typeof e.copy === 'string' ? e.copy : '',
    sampleCount: typeof e.sampleCount === 'number' ? e.sampleCount : undefined,
  };
}

async function loadPastEvents(opts: {
  performerId: string;
  rule: RuleRow;
  sampleCount: number;
}): Promise<SpecialEventPastEvent[]> {
  // For date_match (Halloween, NYE), pull prior setlists where the
  // performance_date's month+day matches the pattern. For venue_run
  // and tour_name_pattern, we leave pastEvents empty for v1 — the
  // copy is the primary surface and the corpus query would need
  // additional joins to compute "prior runs at this venue".
  if (opts.rule.ruleKind !== 'date_match') return [];

  const p = opts.rule.pattern as SpecialEventDateMatchPattern;
  if (typeof p?.month !== 'number' || typeof p?.day !== 'number') return [];
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');

  const rows = await db
    .select({
      performanceDate: tourSetlists.performanceDate,
      venueName: tourSetlists.venueNameRaw,
      songCount: tourSetlists.songCount,
    })
    .from(tourSetlists)
    .where(
      and(
        eq(tourSetlists.performerId, opts.performerId),
        sql`to_char(${tourSetlists.performanceDate}, 'MM-DD') = ${`${mm}-${dd}`}`,
      ),
    )
    .orderBy(desc(tourSetlists.performanceDate))
    .limit(opts.sampleCount);

  return rows.map((r) => ({
    date: formatHumanDate(r.performanceDate),
    performanceDate: r.performanceDate,
    venueName: r.venueName,
    songCount: r.songCount,
  }));
}

function formatHumanDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
