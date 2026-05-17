-- "Golden Gate Park" is a 1,017-acre venue, but in practice the only
-- shows logged here (Outside Lands) take place on the Polo Fields at
-- the western end of the park. The geocoder resolved the venue name
-- to a point ~2 miles east near the Conservatory of Flowers, which
-- puts the map pin nowhere near the actual festival grounds. Move
-- the coordinates to the Polo Fields so the map view matches reality.
UPDATE "venues"
SET
  "latitude" = 37.7686,
  "longitude" = -122.4929
WHERE
  lower("name") = 'golden gate park'
  AND lower("city") = 'san francisco';
