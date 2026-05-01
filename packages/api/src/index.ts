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
  selectBestImage,
  type TMEvent,
  type TMVenue,
  type TMAttraction,
} from './ticketmaster';
export { matchOrCreateVenue } from './venue-matcher';
export { matchOrCreatePerformer } from './performer-matcher';
export { getPlacePhotoMediaUrl, getPlaceDetails } from './google-places';
export { extractShowFromEmail } from './groq';
export type { ExtractedTicketInfo } from './groq';
export {
  searchMessages,
  getMessageBody,
  buildBulkScanQueries,
} from './gmail';
export {
  scrapeConfigSchema,
  parseScrapeConfig,
  type ScrapeConfig,
} from './scrape-config';
export { storeLocalObject } from './media-storage';
export { getMediaConfig } from './media-config';
export { enforceRateLimit, isRateLimited } from './rate-limit';
