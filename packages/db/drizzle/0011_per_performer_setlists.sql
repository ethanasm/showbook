-- Add per-performer setlists column to shows.
-- Shape: jsonb Record<performerId, string[]>
ALTER TABLE shows ADD COLUMN setlists jsonb;
--> statement-breakpoint

-- Backfill: for every show that has a legacy setlist text[] and a headliner
-- performer (role='headliner', lowest sort_order), write a setlists object
-- keyed by that performer's id. Shows with no headliner row are left null.
UPDATE shows s
SET setlists = jsonb_build_object(
  sp.performer_id::text,
  to_jsonb(s.setlist)
)
FROM show_performers sp
WHERE s.setlists IS NULL
  AND s.setlist IS NOT NULL
  AND array_length(s.setlist, 1) > 0
  AND sp.show_id = s.id
  AND sp.role = 'headliner'
  AND sp.sort_order = (
    SELECT MIN(sp2.sort_order)
    FROM show_performers sp2
    WHERE sp2.show_id = s.id
      AND sp2.role = 'headliner'
  );
