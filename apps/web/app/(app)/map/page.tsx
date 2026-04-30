import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import MapPageView from "./View.client";

export default async function MapPage() {
  const caller = await getServerCaller();
  await Promise.all([
    prefetch("shows.listForMap", undefined, () => caller.shows.listForMap()),
    prefetch("venues.followed", undefined, () => caller.venues.followed()),
  ]);

  return (
    <Hydrate state={dehydrateState()}>
      <MapPageView />
    </Hydrate>
  );
}
