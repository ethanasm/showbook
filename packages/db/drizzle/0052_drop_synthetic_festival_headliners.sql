-- Festival shows used to ship with a "synthetic" headliner performer
-- whose name mirrored `shows.production_name` (e.g. a "Bottlerock"
-- performer attached to the Bottlerock festival show). The intent was
-- to make festival shows look like concert shows in the join, but it
-- leaked into the mobile lineup ("Bottlerock" listed as a HEADLINER
-- above the real Lorde headliner) and re-spawned on every show edit
-- because shows.update always re-resolves `input.headliner`. The
-- routers now skip the festival headliner-performer insert (treating
-- festivals like theatre, where the production title lives only on
-- the show row), so this migration cleans up the rows persisted by
-- the old code.
--
-- Scope is deliberately narrow:
--   * shows.kind = 'festival'
--   * production_name is set
--   * the matching show_performers row is role='headliner', sort_order=0
--   * the linked performer's lower(name) equals lower(production_name)
--
-- Real festival headliners (Lorde at Bottlerock) come in via the
-- mobile / web lineup at sort_order >= 1 — they're untouched. The
-- deferred orphan-cleanup trigger from migration 0049 drops any
-- performer row that no longer has any reference after these deletes.
DELETE FROM "show_performers" sp
USING "shows" s, "performers" p
WHERE sp."show_id" = s."id"
  AND sp."performer_id" = p."id"
  AND s."kind" = 'festival'
  AND s."production_name" IS NOT NULL
  AND sp."role" = 'headliner'
  AND sp."sort_order" = 0
  AND lower(p."name") = lower(s."production_name");
