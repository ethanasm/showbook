-- Rename performers.setlistfm_mbid to performers.musicbrainz_id.
-- MusicBrainz IDs are used by both setlist.fm and Ticketmaster external links;
-- the old name implied setlist.fm-only ownership which was inaccurate.
ALTER TABLE performers RENAME COLUMN setlistfm_mbid TO musicbrainz_id;
