import { notFound } from "next/navigation";
import { isFeatureOn } from "@showbook/shared";
import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import EvalView from "./View.client";

export default async function AdminEvalPage() {
  const caller = await getServerCaller();
  // Two gates: the existing ADMIN_EMAILS allowlist AND the
  // SetlistIntelEvalHarness flag. Either one missing → notFound() so the
  // page is indistinguishable from a 404 to non-admins and to users on
  // builds where the flag is OFF.
  const { isAdmin } = await caller.admin.amIAdmin();
  if (!isAdmin) notFound();
  if (!isFeatureOn("SetlistIntelEvalHarness")) notFound();

  await Promise.all([
    prefetch("admin.amIAdmin", undefined, () => caller.admin.amIAdmin()),
    prefetch("eval.summary", { days: 30 }, () => caller.eval.summary({ days: 30 })),
    prefetch("eval.latest", undefined, () => caller.eval.latest()),
    prefetch("eval.recentShows", { limit: 25 }, () =>
      caller.eval.recentShows({ limit: 25 }),
    ),
  ]);

  return (
    <Hydrate state={dehydrateState()}>
      <EvalView />
    </Hydrate>
  );
}
