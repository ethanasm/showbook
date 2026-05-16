import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import { isFeatureOn } from "@showbook/shared";
import { notFound } from "next/navigation";
import SongsView from "./View.client";

export default async function SongsPage() {
  if (!isFeatureOn("SetlistIntelSongs")) {
    // Hide the route entirely when the Phase 2 surface is off so the
    // legacy footprint stays clean — the sidebar item is also gated.
    notFound();
  }

  const caller = await getServerCaller();
  await prefetch(
    "songs.list",
    { firstHeardOnly: false, tourDebutOnly: false, limit: 200 },
    () =>
      caller.songs.list({
        firstHeardOnly: false,
        tourDebutOnly: false,
        limit: 200,
      }),
  );

  return (
    <Hydrate state={dehydrateState()}>
      <SongsView />
    </Hydrate>
  );
}
