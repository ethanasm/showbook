-- The Warfield (982 Market St, San Francisco) was geocoded before
-- geocode.ts began passing stateRegion into Google's autocomplete query
-- (the April 2026 fix referenced in apps/web/.../routers/shows.ts).
-- Without the state, "Warfield, San Francisco" resolved to a Place
-- without lat/lng, the code fell back to Nominatim, and Nominatim
-- returned a location ~0.5mi southwest of the actual venue. The admin
-- coordinate backfill only fills NULL coordinates, and the shows.create
-- lazy backfill only touches googlePlaceId/photoUrl, so the wrong
-- lat/lng persisted on the existing row. Restore the correct
-- coordinates here.
UPDATE "venues"
SET
  "latitude" = 37.78272,
  "longitude" = -122.41066
WHERE
  lower("name") IN ('warfield', 'the warfield')
  AND lower("city") = 'san francisco';
