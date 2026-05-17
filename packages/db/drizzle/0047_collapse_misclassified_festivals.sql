-- Collapse same-venue + same-headliner festival rows that were stored as
-- non-festival kinds (kind='unknown' or 'concert') because pre-fix inferKind
-- only checked the known-festival name list inside the music segment branch.
-- Outside Lands 2026 came back from TM with no music classification at all
-- and landed as 3 separate `unknown` rows (one per day) at the same venue —
-- migration 0045 didn't catch them because its filter was `kind = 'festival'`.
--
-- Strategy: cluster future TM rows by lower(headliner) + venue_id where the
-- headliner matches a festival signal (the literal "fest"/"festival" word
-- pattern that hasFestivalSignal uses, plus the curated KNOWN_FESTIVAL_NAMES
-- entries). Pick the earliest row as canonical, fold the siblings' dates and
-- source_event_ids into it, force kind='festival', then delete the siblings.
-- Single-row clusters and rows already linked to a user Show are left alone.
--
-- One statement: a chain of data-modifying CTEs (UPDATE … RETURNING followed
-- by DELETE) keeps the candidate set computed exactly once and avoids relying
-- on a TEMP TABLE surviving between Drizzle's statement-breakpoint splits.
WITH candidates AS (
  SELECT
    a."id",
    a."venue_id",
    lower(a."headliner") AS headliner_key,
    a."show_date",
    a."source_event_id",
    coalesce(a."extra_source_event_ids", ARRAY[]::text[]) AS extras,
    a."extra_source_event_ids" AS existing_extras
  FROM "announcements" a
  WHERE a."source" = 'ticketmaster'
    AND a."show_date" >= CURRENT_DATE
    AND (
      a."headliner" ~* '(festival|\mfest\M)'
      OR lower(a."headliner") LIKE '%outside lands%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "show_announcement_links" sal
      WHERE sal."announcement_id" = a."id"
    )
),
ordered AS (
  SELECT
    "id",
    venue_id,
    headliner_key,
    show_date,
    source_event_id,
    extras,
    existing_extras,
    row_number() OVER (
      PARTITION BY venue_id, headliner_key
      ORDER BY show_date, "id"
    ) AS rn,
    count(*) OVER (PARTITION BY venue_id, headliner_key) AS cluster_size
  FROM candidates
),
clusters AS (
  SELECT
    venue_id,
    headliner_key,
    (array_agg("id" ORDER BY rn) FILTER (WHERE rn = 1))[1] AS canonical_id,
    array_agg("id" ORDER BY rn) FILTER (WHERE rn > 1) AS sibling_ids,
    array_agg(DISTINCT show_date ORDER BY show_date) AS dates,
    -- Sibling source IDs gathered into the canonical row's extras.
    array_agg(source_event_id ORDER BY rn) FILTER (
      WHERE rn > 1 AND source_event_id IS NOT NULL
    ) AS sibling_source_ids,
    -- Every cluster row's prior extras, concatenated.
    coalesce(
      (
        SELECT array_agg(e)
        FROM (
          SELECT unnest(o2.extras) AS e
          FROM ordered o2
          WHERE o2.venue_id = ordered.venue_id
            AND o2.headliner_key = ordered.headliner_key
        ) _x
        WHERE e IS NOT NULL
      ),
      ARRAY[]::text[]
    ) AS prior_extras
  FROM ordered
  GROUP BY venue_id, headliner_key
  HAVING count(*) > 1
),
updated AS (
  UPDATE "announcements" a
  SET
    "kind" = 'festival',
    "show_date" = c.dates[1],
    "run_start_date" = c.dates[1],
    "run_end_date" = c.dates[array_length(c.dates, 1)],
    "performance_dates" = c.dates,
    "production_name" = coalesce(a."production_name", a."headliner"),
    "extra_source_event_ids" = NULLIF(
      (
        SELECT array_agg(DISTINCT s)
        FROM unnest(
          coalesce(c.sibling_source_ids, ARRAY[]::text[])
            || coalesce(c.prior_extras, ARRAY[]::text[])
            || coalesce(a."extra_source_event_ids", ARRAY[]::text[])
        ) s
        WHERE s IS NOT NULL AND s <> coalesce(a."source_event_id", '')
      ),
      ARRAY[]::text[]
    )
  FROM clusters c
  WHERE a."id" = c.canonical_id
  RETURNING a."id"
)
DELETE FROM "announcements" a
USING clusters c
WHERE c.sibling_ids IS NOT NULL
  AND a."id" = ANY(c.sibling_ids)
  -- Force the UPDATE CTE to materialise before the DELETE runs.
  AND EXISTS (SELECT 1 FROM updated);
