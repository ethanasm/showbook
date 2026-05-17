-- Phase 9 follow-up — iTunes preview fallback for the row-play button.
--
-- Spotify's Search API has stopped returning `preview_url` for apps
-- registered after Nov 2024 (the spec at phase-09-follow-rail-previews.md
-- predicted the thinning trend but the deprecation went further than
-- "thinning"; ~all results now omit the field). The setlistIntel
-- `resolveTrackPreview` mutation now falls back to the public iTunes
-- Search API when Spotify returns a track without a preview, caching
-- whatever URL it gets in `spotify_preview_url` (column kept as-is;
-- the column name predates the fallback but the storage is opaque).
--
-- This timestamp lets the cache check distinguish "we tried every
-- source and got nothing" from "we never tried" — without it, the
-- mutation re-fetches Spotify + iTunes on every click for any row
-- where Spotify found a track id but no preview survived. Setting it
-- once per lookup makes subsequent taps a single indexed DB read.

ALTER TABLE "songs"
  ADD COLUMN "preview_resolved_at" timestamp;
