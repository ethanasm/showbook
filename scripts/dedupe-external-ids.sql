-- One-shot dedupe of duplicate venues / performers that share an external
-- ID. Run this on prod *before* applying migration 0019 if the dry-run
-- SELECTs (see CLAUDE follow-up to plan §F) reveal duplicate rows. The
-- partial UNIQUE indexes that 0019 creates will refuse to build if any
-- duplicate set still exists.
--
-- Safety:
--   * Every block runs inside its own transaction; review the EXPLAIN /
--     dry-run counts first, then BEGIN; … COMMIT;
--   * For each duplicate set we keep the row that has the most populated
--     columns, with oldest created_at as tiebreaker, and rewrite all
--     foreign-key pointers (shows.venue_id, show_performers.performer_id,
--     user_venue_follows, user_performer_follows, media_asset_performers)
--     onto the canonical row before deleting the non-canonical rows.
--   * Tables with composite PKs that include the FK column use
--     INSERT … ON CONFLICT DO NOTHING + DELETE so we never collide on PK.
--
-- Usage (prod):
--   docker compose --env-file .env.prod -f docker-compose.prod.yml \
--     exec db psql -U showbook_prod -d showbook_prod -f - < scripts/dedupe-external-ids.sql
--
-- After this finishes with no errors, run `pnpm prod:migrate` to apply
-- 0019_unique_external_ids.

\set ON_ERROR_STOP on
\timing on

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: dump current duplicate counts so the operator can confirm
--    the script's scope before COMMIT.
-- ---------------------------------------------------------------------------
\echo '== pre-flight: duplicate counts =='
SELECT 'venues.tm_venue_id'         AS col, count(*) AS dup_groups, sum(c) - count(*) AS rows_to_delete
FROM (SELECT count(*) c FROM venues     WHERE ticketmaster_venue_id      IS NOT NULL GROUP BY ticketmaster_venue_id      HAVING count(*) > 1) s
UNION ALL
SELECT 'venues.google_place_id',          count(*),    sum(c) - count(*)
FROM (SELECT count(*) c FROM venues     WHERE google_place_id            IS NOT NULL GROUP BY google_place_id            HAVING count(*) > 1) s
UNION ALL
SELECT 'performers.tm_attraction_id',     count(*),    sum(c) - count(*)
FROM (SELECT count(*) c FROM performers WHERE ticketmaster_attraction_id IS NOT NULL GROUP BY ticketmaster_attraction_id HAVING count(*) > 1) s
UNION ALL
SELECT 'performers.musicbrainz_id',       count(*),    sum(c) - count(*)
FROM (SELECT count(*) c FROM performers WHERE musicbrainz_id             IS NOT NULL GROUP BY musicbrainz_id             HAVING count(*) > 1) s;

-- ---------------------------------------------------------------------------
-- 1. Dedupe venues by ticketmaster_venue_id.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE venue_tm_canonical ON COMMIT DROP AS
SELECT DISTINCT ON (ticketmaster_venue_id)
  ticketmaster_venue_id,
  id AS canonical_id
FROM venues
WHERE ticketmaster_venue_id IS NOT NULL
ORDER BY
  ticketmaster_venue_id,
  -- score = number of populated optional columns (more populated = better)
  (
    (CASE WHEN state_region   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latitude       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN longitude      IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN google_place_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN photo_url      IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN scrape_config  IS NOT NULL THEN 1 ELSE 0 END)
  ) DESC,
  created_at ASC;

CREATE TEMP TABLE venue_tm_dups ON COMMIT DROP AS
SELECT v.id AS dup_id, c.canonical_id
FROM venues v
JOIN venue_tm_canonical c USING (ticketmaster_venue_id)
WHERE v.id <> c.canonical_id;

\echo '== venues.tm_venue_id: duplicate row count =='
SELECT count(*) FROM venue_tm_dups;

-- 1a. Rewrite FKs on tables without composite PKs over the FK column.
UPDATE shows
SET venue_id = d.canonical_id
FROM venue_tm_dups d
WHERE shows.venue_id = d.dup_id;

UPDATE announcements
SET venue_id = d.canonical_id
FROM venue_tm_dups d
WHERE announcements.venue_id = d.dup_id;

-- venue_scrape_runs cascades on venue delete; UPDATE first so the runs
-- attach to the canonical row instead of being lost.
UPDATE venue_scrape_runs
SET venue_id = d.canonical_id
FROM venue_tm_dups d
WHERE venue_scrape_runs.venue_id = d.dup_id;

-- 1b. user_venue_follows: PK (user_id, venue_id). Insert canonical-pointed
--     rows, ignoring conflicts, then delete the dup-pointed rows.
INSERT INTO user_venue_follows (user_id, venue_id, followed_at)
SELECT f.user_id, d.canonical_id, f.followed_at
FROM user_venue_follows f
JOIN venue_tm_dups d ON f.venue_id = d.dup_id
ON CONFLICT (user_id, venue_id) DO NOTHING;
DELETE FROM user_venue_follows
WHERE venue_id IN (SELECT dup_id FROM venue_tm_dups);

-- 1c. Delete the now-orphan dup venues.
DELETE FROM venues
WHERE id IN (SELECT dup_id FROM venue_tm_dups);

\echo '== venues.tm_venue_id: residual duplicate groups (expect 0) =='
SELECT count(*) FROM (
  SELECT 1 FROM venues WHERE ticketmaster_venue_id IS NOT NULL
   GROUP BY ticketmaster_venue_id HAVING count(*) > 1
) s;

COMMIT;

-- ---------------------------------------------------------------------------
-- 2. Dedupe venues by google_place_id.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE venue_gp_canonical ON COMMIT DROP AS
SELECT DISTINCT ON (google_place_id)
  google_place_id,
  id AS canonical_id
FROM venues
WHERE google_place_id IS NOT NULL
ORDER BY
  google_place_id,
  (
    (CASE WHEN state_region          IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN latitude              IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN longitude             IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN ticketmaster_venue_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN photo_url             IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN scrape_config         IS NOT NULL THEN 1 ELSE 0 END)
  ) DESC,
  created_at ASC;

CREATE TEMP TABLE venue_gp_dups ON COMMIT DROP AS
SELECT v.id AS dup_id, c.canonical_id
FROM venues v
JOIN venue_gp_canonical c USING (google_place_id)
WHERE v.id <> c.canonical_id;

\echo '== venues.google_place_id: duplicate row count =='
SELECT count(*) FROM venue_gp_dups;

UPDATE shows
SET venue_id = d.canonical_id
FROM venue_gp_dups d
WHERE shows.venue_id = d.dup_id;

UPDATE announcements
SET venue_id = d.canonical_id
FROM venue_gp_dups d
WHERE announcements.venue_id = d.dup_id;

UPDATE venue_scrape_runs
SET venue_id = d.canonical_id
FROM venue_gp_dups d
WHERE venue_scrape_runs.venue_id = d.dup_id;

INSERT INTO user_venue_follows (user_id, venue_id, followed_at)
SELECT f.user_id, d.canonical_id, f.followed_at
FROM user_venue_follows f
JOIN venue_gp_dups d ON f.venue_id = d.dup_id
ON CONFLICT (user_id, venue_id) DO NOTHING;
DELETE FROM user_venue_follows
WHERE venue_id IN (SELECT dup_id FROM venue_gp_dups);

DELETE FROM venues
WHERE id IN (SELECT dup_id FROM venue_gp_dups);

\echo '== venues.google_place_id: residual duplicate groups (expect 0) =='
SELECT count(*) FROM (
  SELECT 1 FROM venues WHERE google_place_id IS NOT NULL
   GROUP BY google_place_id HAVING count(*) > 1
) s;

COMMIT;

-- ---------------------------------------------------------------------------
-- 3. Dedupe performers by ticketmaster_attraction_id.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE perf_tm_canonical ON COMMIT DROP AS
SELECT DISTINCT ON (ticketmaster_attraction_id)
  ticketmaster_attraction_id,
  id AS canonical_id
FROM performers
WHERE ticketmaster_attraction_id IS NOT NULL
ORDER BY
  ticketmaster_attraction_id,
  (
    (CASE WHEN musicbrainz_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN image_url      IS NOT NULL THEN 1 ELSE 0 END)
  ) DESC,
  created_at ASC;

CREATE TEMP TABLE perf_tm_dups ON COMMIT DROP AS
SELECT p.id AS dup_id, c.canonical_id
FROM performers p
JOIN perf_tm_canonical c USING (ticketmaster_attraction_id)
WHERE p.id <> c.canonical_id;

\echo '== performers.tm_attraction_id: duplicate row count =='
SELECT count(*) FROM perf_tm_dups;

-- announcements.headliner_performer_id: nullable single-column FK.
UPDATE announcements
SET headliner_performer_id = d.canonical_id
FROM perf_tm_dups d
WHERE announcements.headliner_performer_id = d.dup_id;

-- show_performers: PK (show_id, performer_id, role). Insert-then-delete.
INSERT INTO show_performers (show_id, performer_id, role, character_name, sort_order)
SELECT sp.show_id, d.canonical_id, sp.role, sp.character_name, sp.sort_order
FROM show_performers sp
JOIN perf_tm_dups d ON sp.performer_id = d.dup_id
ON CONFLICT (show_id, performer_id, role) DO NOTHING;
DELETE FROM show_performers
WHERE performer_id IN (SELECT dup_id FROM perf_tm_dups);

-- user_performer_follows: PK (user_id, performer_id).
INSERT INTO user_performer_follows (user_id, performer_id, followed_at)
SELECT f.user_id, d.canonical_id, f.followed_at
FROM user_performer_follows f
JOIN perf_tm_dups d ON f.performer_id = d.dup_id
ON CONFLICT (user_id, performer_id) DO NOTHING;
DELETE FROM user_performer_follows
WHERE performer_id IN (SELECT dup_id FROM perf_tm_dups);

-- media_asset_performers: PK (asset_id, performer_id).
INSERT INTO media_asset_performers (asset_id, performer_id)
SELECT m.asset_id, d.canonical_id
FROM media_asset_performers m
JOIN perf_tm_dups d ON m.performer_id = d.dup_id
ON CONFLICT (asset_id, performer_id) DO NOTHING;
DELETE FROM media_asset_performers
WHERE performer_id IN (SELECT dup_id FROM perf_tm_dups);

DELETE FROM performers
WHERE id IN (SELECT dup_id FROM perf_tm_dups);

\echo '== performers.tm_attraction_id: residual duplicate groups (expect 0) =='
SELECT count(*) FROM (
  SELECT 1 FROM performers WHERE ticketmaster_attraction_id IS NOT NULL
   GROUP BY ticketmaster_attraction_id HAVING count(*) > 1
) s;

COMMIT;

-- ---------------------------------------------------------------------------
-- 4. Dedupe performers by musicbrainz_id.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE perf_mb_canonical ON COMMIT DROP AS
SELECT DISTINCT ON (musicbrainz_id)
  musicbrainz_id,
  id AS canonical_id
FROM performers
WHERE musicbrainz_id IS NOT NULL
ORDER BY
  musicbrainz_id,
  (
    (CASE WHEN ticketmaster_attraction_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN image_url                  IS NOT NULL THEN 1 ELSE 0 END)
  ) DESC,
  created_at ASC;

CREATE TEMP TABLE perf_mb_dups ON COMMIT DROP AS
SELECT p.id AS dup_id, c.canonical_id
FROM performers p
JOIN perf_mb_canonical c USING (musicbrainz_id)
WHERE p.id <> c.canonical_id;

\echo '== performers.musicbrainz_id: duplicate row count =='
SELECT count(*) FROM perf_mb_dups;

UPDATE announcements
SET headliner_performer_id = d.canonical_id
FROM perf_mb_dups d
WHERE announcements.headliner_performer_id = d.dup_id;

INSERT INTO show_performers (show_id, performer_id, role, character_name, sort_order)
SELECT sp.show_id, d.canonical_id, sp.role, sp.character_name, sp.sort_order
FROM show_performers sp
JOIN perf_mb_dups d ON sp.performer_id = d.dup_id
ON CONFLICT (show_id, performer_id, role) DO NOTHING;
DELETE FROM show_performers
WHERE performer_id IN (SELECT dup_id FROM perf_mb_dups);

INSERT INTO user_performer_follows (user_id, performer_id, followed_at)
SELECT f.user_id, d.canonical_id, f.followed_at
FROM user_performer_follows f
JOIN perf_mb_dups d ON f.performer_id = d.dup_id
ON CONFLICT (user_id, performer_id) DO NOTHING;
DELETE FROM user_performer_follows
WHERE performer_id IN (SELECT dup_id FROM perf_mb_dups);

INSERT INTO media_asset_performers (asset_id, performer_id)
SELECT m.asset_id, d.canonical_id
FROM media_asset_performers m
JOIN perf_mb_dups d ON m.performer_id = d.dup_id
ON CONFLICT (asset_id, performer_id) DO NOTHING;
DELETE FROM media_asset_performers
WHERE performer_id IN (SELECT dup_id FROM perf_mb_dups);

DELETE FROM performers
WHERE id IN (SELECT dup_id FROM perf_mb_dups);

\echo '== performers.musicbrainz_id: residual duplicate groups (expect 0) =='
SELECT count(*) FROM (
  SELECT 1 FROM performers WHERE musicbrainz_id IS NOT NULL
   GROUP BY musicbrainz_id HAVING count(*) > 1
) s;

COMMIT;

-- ---------------------------------------------------------------------------
-- 5. Final verification: every "residual" count above must be 0 before
--    `pnpm prod:migrate` runs 0019_unique_external_ids.
-- ---------------------------------------------------------------------------
\echo '== post-dedupe summary =='
SELECT 'venues.tm_venue_id'             AS col, count(*) FROM (SELECT 1 FROM venues     WHERE ticketmaster_venue_id      IS NOT NULL GROUP BY ticketmaster_venue_id      HAVING count(*) > 1) s
UNION ALL SELECT 'venues.google_place_id',     count(*) FROM (SELECT 1 FROM venues     WHERE google_place_id            IS NOT NULL GROUP BY google_place_id            HAVING count(*) > 1) s
UNION ALL SELECT 'performers.tm_attraction_id', count(*) FROM (SELECT 1 FROM performers WHERE ticketmaster_attraction_id IS NOT NULL GROUP BY ticketmaster_attraction_id HAVING count(*) > 1) s
UNION ALL SELECT 'performers.musicbrainz_id',  count(*) FROM (SELECT 1 FROM performers WHERE musicbrainz_id             IS NOT NULL GROUP BY musicbrainz_id             HAVING count(*) > 1) s;
