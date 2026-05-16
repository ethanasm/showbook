/**
 * Show-tab view telemetry endpoint. Receives a `{ tab, showId, isPast }`
 * payload from the web client (best-effort `fetch` from
 * `useTrackTabView`) and logs it via the shared pino → Axiom pipeline.
 *
 * No DB write, no rate limit — Axiom can compress the volume after the
 * fact. Anonymous-friendly: the user id comes from the NextAuth
 * session if present but isn't required.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { child } from "@showbook/observability";
import { auth } from "@/auth";

const log = child({ component: "web.telemetry.show-tab" });

const schema = z.object({
  tab: z.enum(["overview", "setlist", "media", "notes"]),
  showId: z.string().uuid(),
  isPast: z.boolean(),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const session = await auth();
  log.info(
    {
      event: "setlist_intel.show_tab.viewed",
      tab: parsed.data.tab,
      showId: parsed.data.showId,
      isPast: parsed.data.isPast,
      userId: session?.user?.id ?? null,
    },
    "show tab viewed",
  );
  return NextResponse.json({ ok: true });
}
