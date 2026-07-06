/**
 * Songs-surface view telemetry. Receives a `{ surface: 'detail',
 * songId }` payload from the web client and emits `songs.detail.viewed`
 * via the shared pino → Axiom pipeline. Best-effort: any malformed
 * body returns 400 silently and the client's keepalive fetch swallows
 * the failure. (The `page` surface went away with the standalone
 * /songs index page, removed 2026-07.)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { child } from "@showbook/observability";
import { auth } from "@/auth";

const log = child({ component: "web.telemetry.songs" });

const schema = z.object({
  surface: z.literal("detail"),
  songId: z.string().uuid(),
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
  const userId = session?.user?.id ?? null;
  log.info(
    {
      event: "songs.detail.viewed",
      userId,
      songId: parsed.data.songId,
    },
    "song detail viewed",
  );
  return NextResponse.json({ ok: true });
}
