import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import PreferencesView from "./View.client";

export default async function PreferencesPage() {
  const caller = await getServerCaller();
  await Promise.all([
    prefetch("preferences.get", undefined, () => caller.preferences.get()),
    prefetch("venues.followed", undefined, () => caller.venues.followed()),
  ]);

  return (
    <Hydrate state={dehydrateState()}>
      <PreferencesView />
    </Hydrate>
  );
}
