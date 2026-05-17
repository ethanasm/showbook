import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { performers } from './performers';

// Phase 11 (§15g) — operator/auto-detected rules that short-circuit
// the prediction algorithm. When a rule matches the target date /
// venue, the predicted-setlist procedure returns
// `style: 'special_event'` carrying `effect.copy` and a list of
// prior matching events for context. The 0045 migration seeds the
// canonical Phish Halloween rule; additional rules (Springsteen NYE
// marathons, Sphere residencies) are added via the admin UI at
// `/admin/eval`.
//
// `rule_kind` discriminates the `pattern` jsonb shape:
//   'date_match'         → { month: number, day: number }
//   'venue_run'          → { venueNamePattern: string }
//   'tour_name_pattern'  → { regex: string }
//
// `effect` carries `{ copy: string, sampleCount?: number }` —
// `sampleCount` controls how many prior matching events are
// surfaced in the empty-state card.
//
// `source` is 'auto' (seed migration) or 'manual' (admin UI).
export const specialEventRules = pgTable(
  'special_event_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    performerId: uuid('performer_id')
      .notNull()
      .references(() => performers.id, { onDelete: 'cascade' }),
    ruleKind: text('rule_kind').notNull(),
    pattern: jsonb('pattern').notNull(),
    effect: jsonb('effect').notNull(),
    source: text('source').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('special_event_rules_performer_active_idx')
      .on(table.performerId)
      .where(sql`${table.active} = true`),
  ],
);

export interface SpecialEventDateMatchPattern {
  month: number;
  day: number;
}

export interface SpecialEventVenueRunPattern {
  venueNamePattern: string;
}

export interface SpecialEventTourNamePattern {
  regex: string;
}

export interface SpecialEventEffect {
  copy: string;
  sampleCount?: number;
}
