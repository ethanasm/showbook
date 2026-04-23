import { router } from './trpc';
import { showsRouter } from './routers/shows';
import { venuesRouter } from './routers/venues';
import { performersRouter } from './routers/performers';
import { discoverRouter } from './routers/discover';
import { enrichmentRouter } from './routers/enrichment';
import { preferencesRouter } from './routers/preferences';
import { photosRouter } from './routers/photos';

export const appRouter = router({
  shows: showsRouter,
  venues: venuesRouter,
  performers: performersRouter,
  discover: discoverRouter,
  enrichment: enrichmentRouter,
  preferences: preferencesRouter,
  photos: photosRouter,
});

export type AppRouter = typeof appRouter;
