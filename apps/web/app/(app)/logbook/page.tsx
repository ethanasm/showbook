import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import LogbookView from "./View.client";

export default async function LogbookPage() {
  const caller = await getServerCaller();
  await prefetch("shows.list", {}, () => caller.shows.list({}));

  return (
    <Hydrate state={dehydrateState()}>
      <LogbookView />
    </Hydrate>
  );
}
