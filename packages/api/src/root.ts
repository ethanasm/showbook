import { router } from './trpc';
import { showsRouter } from './routers/shows';
import { venuesRouter } from './routers/venues';
import { performersRouter } from './routers/performers';
import { discoverRouter } from './routers/discover';
import { enrichmentRouter } from './routers/enrichment';
import { preferencesRouter } from './routers/preferences';
import { searchRouter } from './routers/search';
import { mediaRouter } from './routers/media';
import { spotifyRouter } from './routers/spotify';
import { spotifyImportRouter } from './routers/spotify-import';
import { appleMusicImportRouter } from './routers/apple-music-import';
import { adminRouter } from './routers/admin';
import { importsRouter } from './routers/imports';
import { setlistIntelRouter } from './routers/setlist-intel';
import { songsRouter } from './routers/songs';
export const appRouter = router({
  shows: showsRouter,
  venues: venuesRouter,
  performers: performersRouter,
  discover: discoverRouter,
  enrichment: enrichmentRouter,
  preferences: preferencesRouter,
  search: searchRouter,
  media: mediaRouter,
  spotify: spotifyRouter,
  spotifyImport: spotifyImportRouter,
  appleMusicImport: appleMusicImportRouter,
  imports: importsRouter,
  admin: adminRouter,
  setlistIntel: setlistIntelRouter,
  songs: songsRouter,
});

export type AppRouter = typeof appRouter;
