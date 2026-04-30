import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import ShowsView from "./View.client";

export default async function ShowsPage() {
  const caller = await getServerCaller();
  // Initial render uses selectedYear="All" → year filter undefined, which
  // hashes identically to the unfiltered { } query React Query also issues.
  await prefetch("shows.list", {}, () => caller.shows.list({}));

  return (
    <Hydrate state={dehydrateState()}>
      <ShowsView />
    </Hydrate>
  );
}
