import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import HomeView from "./View.client";

export default async function HomePage() {
  const caller = await getServerCaller();
  await prefetch("shows.list", {}, () => caller.shows.list({}));

  return (
    <Hydrate state={dehydrateState()}>
      <HomeView />
    </Hydrate>
  );
}
