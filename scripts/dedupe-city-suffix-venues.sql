-- One-shot dedupe of venues that are duplicates only because TM splits a
-- venue across two ids: the search-side venue (e.g. "Orpheum Theatre",
-- KovZpZAFaanA) and an event-side venue with a city-suffixed name (e.g.
-- "Orpheum Theatre-San Francisco", ZFr9jZedke). Until the matchOrCreateVenue
-- normalized-name match shipped, every such venue created two rows on
-- follow + ingest and the announcements landed on whichever id appeared
-- in the event payload — leaving the followed venue at "0 shows".
--
-- This script finds same-city venue pairs whose names match modulo the
-- trailing city qualifier ("-City", " - City", ", City", "(City)",
-- " at City"), picks the one a user already follows as canonical (else
-- the row with the search-side `K…` TM id, else the older row), repoints
-- references, and deletes the duplicate.
--
-- Usage (prod):
--   docker compose --env-file .env.prod -f docker-compose.prod.yml \
--     exec db psql -U showbook_prod -d showbook_prod -f - < scripts/dedupe-city-suffix-venues.sql
--
-- Safe to re-run: each block is idempotent and gated on the temp tables
-- it builds at the top.

\set ON_ERROR_STOP on
\timing on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Build (canonical, dup) pairs.
-- ---------------------------------------------------------------------------
-- For each city, find venue pairs (a, b) where lower(strip_city(a.name)) =
-- lower(strip_city(b.name)) but a.id <> b.id. The strip pattern matches the
-- shapes TM uses on event payloads.

CREATE TEMP TABLE city_suffix_dups ON COMMIT DROP AS
WITH normalized AS (
  SELECT
    v.id,
    v.name,
    v.city,
    v.created_at,
    v.ticketmaster_venue_id,
    -- Strip trailing city qualifier (case-insensitive). Mirrors
    -- stripCitySuffix() in packages/api/src/venue-matcher.ts.
    trim(
      regexp_replace(
        v.name,
        '\s*(?:[-—,]\s*|\s+at\s+|\s*\(\s*)' || regexp_replace(v.city, '([.\\+*?(){}|^$\[\]])', '\\\1', 'g') || '\)?\s*$',
        '',
        'i'
      )
    ) AS stripped_name,
    (SELECT count(*) FROM user_venue_follows f WHERE f.venue_id = v.id) AS follow_count
  FROM venues v
),
groups AS (
  -- Group rows whose stripped name matches another row's stripped or
  -- original name (case-insensitive) in the same city.
  SELECT
    a.id          AS a_id,
    a.name        AS a_name,
    a.created_at  AS a_created_at,
    a.ticketmaster_venue_id AS a_tm_id,
    a.follow_count          AS a_follow_count,
    b.id          AS b_id,
    b.name        AS b_name,
    b.created_at  AS b_created_at,
    b.ticketmaster_venue_id AS b_tm_id,
    b.follow_count          AS b_follow_count,
    a.city        AS city
  FROM normalized a
  JOIN normalized b
    ON a.id < b.id
   AND lower(a.city) = lower(b.city)
   AND lower(a.stripped_name) = lower(b.stripped_name)
   AND length(a.stripped_name) >= 3
)
SELECT
  city,
  -- Canonical = most follows, else has TM id starting with 'K' (search-side
  -- master id), else older.
  CASE
    WHEN a_follow_count > b_follow_count THEN a_id
    WHEN b_follow_count > a_follow_count THEN b_id
    WHEN a_tm_id LIKE 'K%' AND (b_tm_id IS NULL OR b_tm_id NOT LIKE 'K%') THEN a_id
    WHEN b_tm_id LIKE 'K%' AND (a_tm_id IS NULL OR a_tm_id NOT LIKE 'K%') THEN b_id
    WHEN a_created_at <= b_created_at THEN a_id
    ELSE b_id
  END AS canonical_id,
  CASE
    WHEN a_follow_count > b_follow_count THEN b_id
    WHEN b_follow_count > a_follow_count THEN a_id
    WHEN a_tm_id LIKE 'K%' AND (b_tm_id IS NULL OR b_tm_id NOT LIKE 'K%') THEN b_id
    WHEN b_tm_id LIKE 'K%' AND (a_tm_id IS NULL OR a_tm_id NOT LIKE 'K%') THEN a_id
    WHEN a_created_at <= b_created_at THEN b_id
    ELSE a_id
  END AS dup_id,
  a_name, b_name, a_tm_id, b_tm_id, a_follow_count, b_follow_count
FROM groups;

\echo '== detected city-suffix duplicate pairs =='
SELECT city, canonical_id, dup_id, a_name, b_name, a_tm_id, b_tm_id
FROM city_suffix_dups
ORDER BY city;

-- ---------------------------------------------------------------------------
-- 2. Repoint references from dup → canonical.
-- ---------------------------------------------------------------------------

UPDATE announcements a
SET venue_id = d.canonical_id
FROM city_suffix_dups d
WHERE a.venue_id = d.dup_id;

UPDATE shows
SET venue_id = d.canonical_id
FROM city_suffix_dups d
WHERE shows.venue_id = d.dup_id;

UPDATE venue_scrape_runs
SET venue_id = d.canonical_id
FROM city_suffix_dups d
WHERE venue_scrape_runs.venue_id = d.dup_id;

INSERT INTO user_venue_follows (user_id, venue_id, followed_at)
SELECT f.user_id, d.canonical_id, f.followed_at
FROM user_venue_follows f
JOIN city_suffix_dups d ON f.venue_id = d.dup_id
ON CONFLICT (user_id, venue_id) DO NOTHING;
DELETE FROM user_venue_follows
WHERE venue_id IN (SELECT dup_id FROM city_suffix_dups);

-- 2b. Backfill the canonical row's TM id with the dup's, but only if the
-- canonical doesn't already have one. Keeps the search-side `K…` id when
-- both are present, since that's what searchVenues will return on the next
-- follow attempt and we want subsequent ingests to dedup on it.
UPDATE venues v
SET ticketmaster_venue_id = (
  SELECT dup.ticketmaster_venue_id FROM venues dup
  JOIN city_suffix_dups d ON dup.id = d.dup_id
  WHERE d.canonical_id = v.id AND dup.ticketmaster_venue_id IS NOT NULL
  LIMIT 1
)
WHERE v.id IN (SELECT canonical_id FROM city_suffix_dups WHERE canonical_id <> dup_id)
  AND v.ticketmaster_venue_id IS NULL;

-- 2c. Delete the now-orphan dup venues.
DELETE FROM venues
WHERE id IN (SELECT dup_id FROM city_suffix_dups);

\echo '== post-dedupe: residual same-city stripped-name dup groups (expect 0) =='
WITH normalized AS (
  SELECT
    v.id,
    v.city,
    trim(
      regexp_replace(
        v.name,
        '\s*(?:[-—,]\s*|\s+at\s+|\s*\(\s*)' || regexp_replace(v.city, '([.\\+*?(){}|^$\[\]])', '\\\1', 'g') || '\)?\s*$',
        '',
        'i'
      )
    ) AS stripped_name
  FROM venues v
)
SELECT count(*) FROM (
  SELECT lower(city), lower(stripped_name)
  FROM normalized
  WHERE length(stripped_name) >= 3
  GROUP BY lower(city), lower(stripped_name)
  HAVING count(*) > 1
) s;

COMMIT;
