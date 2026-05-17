export { appRouter, type AppRouter } from './root';
export { createContext, type Session } from './trpc';
export { searchArtist, searchSetlist, getUserAttended, fetchArtistSetlists, SetlistFmError } from './setlistfm';
export { fetchSetlistForPerformer, type SetlistLookupResult } from './setlist-lookup';
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
  getAppAccessToken,
  getArtistAlbums,
  getAlbumTracks,
} from './spotify';
export type {
  SpotifyArtist,
  SpotifyTokenSet,
  SpotifyMe,
  SpotifyTrack,
  SpotifyPlaylist,
  SpotifyRecentlyPlayedTrack,
  SpotifyTopTrack,
  SpotifyAlbum,
  SpotifyAlbumTracks,
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
  inferStyleForEval,
  loadTruncatedCorpus,
  rerunEvalForShow,
  latestRunId,
  type EvalStyle,
  type PerShowEvalRow,
} from './eval-show';

// Phase 5 — setlist-style classifier (§15b). Pure helpers used by the
// nightly refresh cron, the eval back-test bucketer, and the predicted-
// setlist surface.
export {
  inferStyle as inferSetlistStyle,
  classifyFromSignals,
  reconcileStyleTransition,
  styleSignals,
  meanPairwiseJaccard,
  uniqueSongRatio,
  meanSetlistLength,
  setlistSongSet,
  type SetlistStyle,
  type SetlistStyleOrUnknown,
  type StyleSignals,
} from './setlist-style';
export { lookupSeedStyle, allSeedEntries } from './setlist-style-seeds';

// Phase 5 — rotating-style prediction + multi-night run detection.
export {
  detectMultiNightRun,
  type RunContext,
} from './multi-night-run-detector';
export {
  predictRotating,
  type RotatingPrediction,
  type OverdueSong,
  type HotSong,
  type PositionPool,
  type PositionRole,
  type MultiNightContext,
  type RotatingPredictionResult,
} from './setlist-predict-rotating';
export {
  evaluateReleaseGate,
  type ReleaseGateResult,
  type ReleaseGateBreach,
  type ReleaseGateMetric,
  RELEASE_GATE_THRESHOLDS,
} from './setlist-release-gate';

// Phase 6 — theatrical + improvised prediction models.
export {
  predictTheatrical,
  computeTheatricalSurpriseSlotHits,
  type TheatricalPrediction,
  type TheatricalSongRow,
  type TheatricalRotatingSlot,
  type TheatricalSlotHit,
} from './setlist-predict-theatrical';
export {
  predictImprovised,
  computeShowModes,
  computeVibeSketch,
  computeImprovisedShowModeHit,
  VIBE_AXES,
  type ImprovisedPrediction,
  type ShowMode,
  type VibeSketch,
  type VibeAxis,
  type VibeDelta,
  type ImprovisedShowModeHit,
} from './setlist-predict-improvised';

// Phase 11 — shared set-count prediction shape + special-event union variant.
export {
  computeSetCount,
  setCountFromShowModes,
  setCountFromSingleCount,
  type SetCountPrediction,
} from './setlist-predict-shared';
export {
  lookupSpecialEventRule,
  type SpecialEventPrediction,
  type SpecialEventPastEvent,
  type SpecialEventRuleKind,
} from './setlist-predict-special-event';
export { synthesizeAlbumDropRows } from './album-drop-synthetic';
export {
  resolvePersonalChips,
  __resetTopTracksCacheForTests,
  type PersonalChipSet,
} from './personal-chips';
