-- The venue-photo proxy now prefers Google Places over Ticketmaster
-- (TM's venue.images[] is a wordmark logo on white for most venues, not
-- a hero photo). Clear stored TM HTTPS URLs on venues that also have a
-- googlePlaceId so the proxy resolves a fresh Places photo on next
-- request. Venues without a Place ID keep their TM URL — there's no
-- better option to fall back to.
UPDATE "venues"
SET "photo_url" = NULL
WHERE "photo_url" LIKE 'https://%'
  AND "google_place_id" IS NOT NULL;
