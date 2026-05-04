export { appRouter, type AppRouter } from './root';
export { createContext, type Session } from './trpc';
export { searchArtist, searchSetlist } from './setlistfm';
export type { ArtistSearchResult, SetlistResult } from './setlistfm';

// Data-source clients & matchers
export {
  searchEvents,
  getEvent,
  searchAttractions,
  getAttraction,
  inferKind,
  extractMusicbrainzId,
  selectBestImage,
  type TMEvent,
  type TMVenue,
  type TMAttraction,
} from './ticketmaster';
export { matchOrCreateVenue } from './venue-matcher';
export { matchOrCreatePerformer } from './performer-matcher';
export { getPlacePhotoMediaUrl, getPlaceDetails } from './google-places';
export { extractShowFromEmail, generateDigestPreamble, pingGroq } from './groq';
export type { ExtractedTicketInfo, DigestPreambleInput } from './groq';
export {
  searchMessages,
  getMessageBody,
  buildBulkScanQueries,
} from './gmail';
export { getFollowedArtists, SpotifyError } from './spotify';
export type { SpotifyArtist } from './spotify';
export {
  scrapeConfigSchema,
  parseScrapeConfig,
  type ScrapeConfig,
} from './scrape-config';
export { storeLocalObject } from './media-storage';
export { getMediaConfig } from './media-config';
export { enforceRateLimit, isRateLimited } from './rate-limit';
export { parseAdminEmails, isAdminEmail } from './admin';
