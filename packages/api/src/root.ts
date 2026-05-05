import { router } from './trpc';
import { showsRouter } from './routers/shows';
import { venuesRouter } from './routers/venues';
import { performersRouter } from './routers/performers';
import { discoverRouter } from './routers/discover';
import { enrichmentRouter } from './routers/enrichment';
import { preferencesRouter } from './routers/preferences';
import { searchRouter } from './routers/search';
import { mediaRouter } from './routers/media';
import { spotifyImportRouter } from './routers/spotify-import';
import { appleMusicImportRouter } from './routers/apple-music-import';
import { adminRouter } from './routers/admin';
export const appRouter = router({
  shows: showsRouter,
  venues: venuesRouter,
  performers: performersRouter,
  discover: discoverRouter,
  enrichment: enrichmentRouter,
  preferences: preferencesRouter,
  search: searchRouter,
  media: mediaRouter,
  spotifyImport: spotifyImportRouter,
  appleMusicImport: appleMusicImportRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
