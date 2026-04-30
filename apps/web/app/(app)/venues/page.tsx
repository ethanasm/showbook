import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import VenuesView from "./View.client";

export default async function VenuesPage() {
  const caller = await getServerCaller();
  await prefetch("venues.list", undefined, () => caller.venues.list());

  return (
    <Hydrate state={dehydrateState()}>
      <VenuesView />
    </Hydrate>
  );
}
