import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import {
  db,
  shows,
  showPerformers,
  performers,
  venues,
  mediaAssets,
  userVenueFollows,
  userPerformerFollows,
  userRegions,
  userPreferences,
  showSpotifyPlaylists,
  userSpotifyTokens,
} from "@showbook/db";
import { child } from "@showbook/observability";

const log = child({ component: "api.account.export" });

/**
 * GET /api/account/export
 *
 * GDPR Art. 20 / CCPA §1798.100 portability — returns the authenticated
 * user's full data set as a JSON download. Includes everything they
 * authored (shows, follows, preferences, media metadata, playlists)
 * plus minimal "is this integration connected" markers for the
 * Spotify token row (never the encrypted token bytes themselves, even
 * to the owner — the symmetric key is shared across all users).
 *
 * Implemented as a REST endpoint rather than tRPC because tRPC wraps
 * the payload in superjson + envelope metadata that bloats the
 * download and prevents the browser's native `Save as…` flow.
 */

// REST routes that touch the DB must be node-runtime (postgres-js is
// not edge-compatible).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Walk the user-owned tables. Sequential awaits are fine here — a
  // typical user has < 1 k shows and a handful of follows; even at
  // the upper end this completes in a few hundred ms. Parallelising
  // would just add Promise.all noise without moving p95.
  const userShows = await db
    .select()
    .from(shows)
    .where(eq(shows.userId, userId));

  const showIds = userShows.map((s) => s.id);
  const showPerformerRows =
    showIds.length === 0
      ? []
      : await db
          .select()
          .from(showPerformers)
          .where(inArray(showPerformers.showId, showIds));

  // Resolve referenced venue + performer rows so the export is
  // self-contained — the consumer doesn't have to cross-reference
  // a separate venues file to know where a show was.
  const venueIds = Array.from(
    new Set(userShows.map((s) => s.venueId).filter(Boolean) as string[]),
  );
  const venueRows =
    venueIds.length === 0
      ? []
      : await db.select().from(venues).where(inArray(venues.id, venueIds));

  const performerIds = Array.from(
    new Set(showPerformerRows.map((sp) => sp.performerId)),
  );
  const performerRows =
    performerIds.length === 0
      ? []
      : await db
          .select()
          .from(performers)
          .where(inArray(performers.id, performerIds));

  const media = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.userId, userId));

  const venueFollows = await db
    .select()
    .from(userVenueFollows)
    .where(eq(userVenueFollows.userId, userId));

  const performerFollows = await db
    .select()
    .from(userPerformerFollows)
    .where(eq(userPerformerFollows.userId, userId));

  const regions = await db
    .select()
    .from(userRegions)
    .where(eq(userRegions.userId, userId));

  const prefsRows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  const playlists = await db
    .select()
    .from(showSpotifyPlaylists)
    .where(eq(showSpotifyPlaylists.userId, userId));

  // Spotify tokens are user-owned but never shipped raw — the AES-256
  // ciphertext is sealed with a process-wide key, and exporting the
  // ciphertext would let any user who exports re-import their own
  // tokens against a different deployment. Surface only the
  // connection metadata.
  const spotifyTokenRows = await db
    .select({
      connectedAt: userSpotifyTokens.createdAt,
      updatedAt: userSpotifyTokens.updatedAt,
    })
    .from(userSpotifyTokens)
    .where(eq(userSpotifyTokens.userId, userId))
    .limit(1);

  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user: {
      id: userId,
      email: session.user?.email ?? null,
      name: session.user?.name ?? null,
    },
    shows: userShows,
    showPerformers: showPerformerRows,
    venues: venueRows,
    performers: performerRows,
    media,
    venueFollows,
    performerFollows,
    regions,
    preferences: prefsRows[0] ?? null,
    spotifyPlaylists: playlists,
    integrations: {
      spotify:
        spotifyTokenRows.length > 0
          ? {
              connected: true,
              connectedAt: spotifyTokenRows[0].connectedAt,
              updatedAt: spotifyTokenRows[0].updatedAt,
            }
          : { connected: false },
    },
  };

  log.info(
    {
      event: "account.export.requested",
      userId,
      rowCounts: {
        shows: userShows.length,
        media: media.length,
        venueFollows: venueFollows.length,
        performerFollows: performerFollows.length,
        regions: regions.length,
        playlists: playlists.length,
      },
    },
    "Account export served",
  );

  const ymd = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="showbook-export-${userId}-${ymd}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}

