import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import UpcomingView from "./View.client";

export default async function UpcomingPage() {
  const caller = await getServerCaller();
  await prefetch("shows.list", {}, () => caller.shows.list({}));

  return (
    <Hydrate state={dehydrateState()}>
      <UpcomingView />
    </Hydrate>
  );
}
