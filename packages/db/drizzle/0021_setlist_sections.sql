-- Convert per-performer setlists from `Record<performerId, string[]>` to
-- `Record<performerId, PerformerSetlist>` where PerformerSetlist is
--   { sections: [{ kind: 'set' | 'encore', name?: string,
--                  songs: [{ title: string, note?: string }, ...] }] }
--
-- Encore as a section is new; previously songs were just an ordered flat
-- array with no encore marker. Every existing row becomes a single
-- main set section.

-- 1. Migrate the new per-performer map: each value is a string[] today.
--    Convert each string[] to { sections: [{ kind: 'set', songs: [...] }] }.
UPDATE shows s
SET setlists = sub.next
FROM (
  SELECT
    s2.id,
    jsonb_object_agg(
      kv.key,
      jsonb_build_object(
        'sections',
        jsonb_build_array(
          jsonb_build_object(
            'kind', 'set',
            'songs', coalesce(
              (
                SELECT jsonb_agg(jsonb_build_object('title', t))
                FROM jsonb_array_elements_text(kv.value) AS t
                WHERE length(t) > 0
              ),
              '[]'::jsonb
            )
          )
        )
      )
    ) AS next
  FROM shows s2,
       jsonb_each(s2.setlists) AS kv
  WHERE s2.setlists IS NOT NULL
    -- only rewrite rows whose values are still arrays (the old shape).
    -- New-shape values are objects with a `sections` array — leave them.
    AND jsonb_typeof(kv.value) = 'array'
  GROUP BY s2.id
) AS sub
WHERE s.id = sub.id;
--> statement-breakpoint

-- 2. Backfill from the very-old `setlist text[]` column for any row that
--    still has no `setlists` map at all but does have a legacy array.
--    Pull the lowest-sortOrder headliner (matches 0011_per_performer_setlists).
UPDATE shows s
SET setlists = jsonb_build_object(
  sp.performer_id::text,
  jsonb_build_object(
    'sections',
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'set',
        'songs', coalesce(
          (
            SELECT jsonb_agg(jsonb_build_object('title', t))
            FROM unnest(s.setlist) AS t
            WHERE length(t) > 0
          ),
          '[]'::jsonb
        )
      )
    )
  )
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
