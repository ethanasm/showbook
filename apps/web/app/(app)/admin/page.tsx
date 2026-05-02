import { notFound } from "next/navigation";
import { Hydrate } from "@/lib/hydrate";
import {
  dehydrateState,
  getServerCaller,
  prefetch,
} from "@/lib/trpc-server";
import AdminView from "./View.client";

export default async function AdminPage() {
  const caller = await getServerCaller();
  // Server-side gate. tRPC `amIAdmin` re-derives admin status from the user
  // row + ADMIN_EMAILS allowlist, so a removed admin can't reach this page
  // via a stale cookie. We `notFound()` (rather than redirect) so the route
  // is indistinguishable from non-existent for non-admins.
  const { isAdmin } = await caller.admin.amIAdmin();
  if (!isAdmin) notFound();

  await prefetch("admin.amIAdmin", undefined, () => caller.admin.amIAdmin());

  return (
    <Hydrate state={dehydrateState()}>
      <AdminView />
    </Hydrate>
  );
}
