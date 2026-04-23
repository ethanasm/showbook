export { appRouter, type AppRouter } from './root';
export { createContext, type Session } from './trpc';
export { searchArtist, searchSetlist } from './setlistfm';
export type { ArtistSearchResult, SetlistResult } from './setlistfm';

// Data-source clients & matchers
export {
  searchEvents,
  inferKind,
  selectBestImage,
  type TMEvent,
  type TMVenue,
  type TMAttraction,
} from './ticketmaster';
export { matchOrCreateVenue } from './venue-matcher';
export { matchOrCreatePerformer } from './performer-matcher';
