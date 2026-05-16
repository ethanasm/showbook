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
  tracksContains,
  saveTracksToLibrary,
  getRecentlyPlayed,
  getTopTracks,
  replacePlaylistItems,
  diffScopes,
} from './spotify';
export type {
  SpotifyArtist,
  SpotifyTokenSet,
  SpotifyMe,
  SpotifyTrack,
  SpotifyPlaylist,
  SpotifyRecentlyPlayedTrack,
  SpotifyTopTrack,
  MissingScopesResult,
} from './spotify';
export {
  __resetSavedCacheForTests as __resetMusicLayerCacheForTests,
  fanLoyaltyForShow,
  discoveredLiveForShow,
  saveDiscoveredSong,
  primingStatForShow,
  checkTracksSavedForUser,
} from './spotify-music-layer';
export type {
  FanLoyaltyResult,
  DiscoveredLiveResult,
  DiscoveredTrack,
  PrimingStatResult,
} from './spotify-music-layer';
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

// Setlist intelligence — Phase 2 (badges + songs surface)
export {
  computeSongBadges,
  RARE_THRESHOLD,
  type SongBadge,
  type SongBadgesMap,
  type ComputeSongBadgesInput,
} from './song-badges';
export { rowIsUserDebut } from './routers/songs';

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

// Eval-harness pure metric helpers — Phase 4.
export {
  brierScore,
  precisionAtK,
  recallAtK,
  recallActual,
  calibrationBuckets,
  calibrationError,
  mergeCalibrationBuckets,
  emptyCalibrationCurve,
  type CalibrationBin,
  type PredictedSongLike,
} from './eval-metrics';

// Phase 4 per-show eval primitives — used by the cron in @showbook/jobs
// and by the `eval.rerunShow` tRPC mutation.
export {
  evaluateShow,
  setlistTitles,
  flattenPrediction,
  inferStyle,
  loadTruncatedCorpus,
  rerunEvalForShow,
  latestRunId,
  type EvalStyle,
  type PerShowEvalRow,
} from './eval-show';
