import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import SongsView from "./View.client";

export default async function SongsPage() {
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
