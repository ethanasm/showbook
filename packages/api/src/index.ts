export { appRouter, type AppRouter } from './root';
export { createContext, type Session } from './trpc';
export { searchArtist, searchSetlist, getUserAttended, fetchArtistSetlists, SetlistFmError } from './setlistfm';
export type {
  ArtistSearchResult,
  SetlistResult,
  AttendedSetlist,
  AttendedPage,
  ArtistSetlistEntry,
  FetchArtistSetlistsOptions,
} from './setlistfm';

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
  HYPE_PLAYLIST_SCOPES,
  exchangeAuthorizationCode,
  refreshSpotifyToken,
  getCurrentUser,
  searchTrack,
  createPlaylist,
  addTracksToPlaylist,
  diffScopes,
} from './spotify';
export type {
  SpotifyArtist,
  SpotifyTokenSet,
  SpotifyMe,
  SpotifyTrack,
  SpotifyPlaylist,
  MissingScopesResult,
} from './spotify';
export {
  buildPlaylistName,
  buildPlaylistDescription,
  resolveTrackUris,
  getExistingPlaylist,
  probePlaylistScopes,
  createHypePlaylist,
  createHeardPlaylist,
  __resetTrackResolveCacheForTests,
} from './spotify-playlist';
export type {
  PlaylistKind,
  SetlistTrack,
  PlaylistMetadata,
  PlaylistResolution,
  CreatePlaylistResult,
} from './spotify-playlist';
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
// `show-accessors` lives in @showbook/shared so client bundles can use
// it without dragging pg-boss / drizzle through. Imported here for
// server-side procedures that need the same helpers.
export {
  pickHeadliner,
  isProductionShow,
  getHeadliner,
  getHeadlinerId,
  getSupportPerformers,
  type ShowLike,
  type ShowPerformerLike,
} from '@showbook/shared';

// Setlist intelligence — Phase 1 (predict + corpus types)
export {
  predictSetlist,
  predictedSetlistCached,
  loadCorpusForPrediction,
  coldPrediction,
  bucketTiers,
  aggregate,
  pickActiveTour,
  pickRole,
  bucketByProbability,
  computeConfidence,
  type PredictedSetlistResult,
  type PredictedSong,
  type HotPrediction,
  type ColdPrediction,
  type ColdReason,
  type SongRole,
  type TourCoverage,
  type CorpusRow,
} from './setlist-predict';
