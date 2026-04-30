import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import ArtistsView from "./View.client";

export default async function ArtistsPage() {
  const caller = await getServerCaller();
  await Promise.all([
    prefetch("performers.list", undefined, () => caller.performers.list()),
    prefetch("shows.list", {}, () => caller.shows.list({})),
  ]);

  return (
    <Hydrate state={dehydrateState()}>
      <ArtistsView />
    </Hydrate>
  );
}
