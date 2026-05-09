export { appRouter, type AppRouter } from './root';
export { createContext, type Session } from './trpc';
export { searchArtist, searchSetlist, getUserAttended, SetlistFmError } from './setlistfm';
export type { ArtistSearchResult, SetlistResult, AttendedSetlist, AttendedPage } from './setlistfm';

// Data-source clients & matchers
export {
  searchEvents,
  getEvent,
  getVenue,
  searchAttractions,
  getAttraction,
  inferKind,
  extractMusicbrainzId,
  selectBestImage,
  type TMEvent,
  type TMVenue,
  type TMAttraction,
} from './ticketmaster';
export { matchOrCreateVenue, isUniqueViolation } from './venue-matcher';
export { geocodeVenue } from './geocode';
export type { GeocodeResult } from './geocode';
export { matchOrCreatePerformer } from './performer-matcher';
export { getPlacePhotoMediaUrl, getPlaceDetails } from './google-places';
export {
  extractShowFromEmail,
  extractShowFromPdfText,
  generateDigestPreamble,
  generateHealthSummaryPreamble,
  pingGroq,
} from './groq';
export type {
  ExtractedTicketInfo,
  DigestPreambleInput,
  HealthSummaryPreambleInput,
} from './groq';
export {
  searchMessages,
  getMessageBody,
  getAttachment,
  buildBulkScanQueries,
} from './gmail';
export type { GmailAttachmentRef, GmailMessageDetail } from './gmail';
export {
  scoreEmailLikelyTicket,
  HEURISTIC_THRESHOLD,
} from './email-heuristic';
export {
  getFollowedArtists,
  SpotifyError,
  SPOTIFY_SCOPES,
  SPOTIFY_SCOPE_STRING,
  exchangeAuthorizationCode,
  refreshSpotifyToken,
  getCurrentUser,
} from './spotify';
export type { SpotifyArtist, SpotifyTokenSet, SpotifyMe } from './spotify';
export {
  ensureFreshUserToken,
  isSpotifyConnected,
  getConnectionStatus,
  disconnectSpotify,
  persistInitialToken,
} from './spotify-tokens';
export type { SpotifyConnectionStatus } from './spotify-tokens';
export { encrypt, decrypt, CryptoError } from './crypto';
export { getMyPastOrders, EventbriteError } from './eventbrite';
export type { EventbriteTicket } from './eventbrite';
export {
  scrapeConfigSchema,
  parseScrapeConfig,
  type ScrapeConfig,
} from './scrape-config';
export { storeLocalObject } from './media-storage';
export { getMediaConfig } from './media-config';
export { enforceRateLimit, isRateLimited } from './rate-limit';
export { parseAdminEmails, isAdminEmail } from './admin';
