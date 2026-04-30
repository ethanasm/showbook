import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import DiscoverView from "./View.client";

export default async function DiscoverPage() {
  const caller = await getServerCaller();
  await Promise.all([
    prefetch("discover.followedFeed", { limit: 100 }, () =>
      caller.discover.followedFeed({ limit: 100 }),
    ),
    prefetch("discover.followedArtistsFeed", { limit: 100 }, () =>
      caller.discover.followedArtistsFeed({ limit: 100 }),
    ),
    prefetch("discover.nearbyFeed", {}, () => caller.discover.nearbyFeed({})),
    prefetch("venues.followed", undefined, () => caller.venues.followed()),
    prefetch("preferences.get", undefined, () => caller.preferences.get()),
  ]);

  return (
    <Hydrate state={dehydrateState()}>
      <DiscoverView />
    </Hydrate>
  );
}
