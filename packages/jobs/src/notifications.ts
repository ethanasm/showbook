import { Resend } from 'resend';
import { createHash } from 'node:crypto';
import { db } from '@showbook/db';
import {
  users,
  userPreferences,
  userRegions,
  shows,
  showPerformers,
  performers,
  announcements,
  userVenueFollows,
  userPerformerFollows,
  venues,
} from '@showbook/db';
import { and, eq, gte, lte, isNotNull, inArray, asc } from 'drizzle-orm';
import { renderDailyDigest } from '@showbook/emails';
import {
  generateDigestPreamble,
  predictedSetlistCached,
  signUnsubscribeToken,
} from '@showbook/api';
import { child } from '@showbook/observability';
import {
  isPointInAnyRegion,
  type RegionBbox,
} from '@showbook/shared';

const log = child({ component: 'notifications' });

// Placeholder value — every prod deploy MUST override via EMAIL_FROM.
// CAN-SPAM requires a valid sender address; shipping with this default
// would put the digest in spam folders and trigger ESP rate-limits.
const DEFAULT_FROM_ADDRESS = 'Showbook <digest@example.com>';

// Regex anchored on `@example.com` followed by a word boundary or end-
// of-address. Matches the placeholder forms (`digest@example.com`,
// `Showbook <digest@example.com>`) without false-positiving on
// otherwise-legitimate hostnames that happen to contain the string
// "example.com" as a substring (CodeQL js/incomplete-url-substring-sanitization).
const PLACEHOLDER_SENDER_RE = /@example\.com\b/i;

function getFromAddress(): string {
  const candidate = process.env.EMAIL_FROM ?? DEFAULT_FROM_ADDRESS;
  // Fail loudly if a prod deploy was misconfigured with the placeholder.
  // Dev / test (NODE_ENV !== 'production') keeps the placeholder so
  // `pnpm email:smoke` and unit tests don't need the env var set.
  if (
    process.env.NODE_ENV === 'production' &&
    PLACEHOLDER_SENDER_RE.test(candidate)
  ) {
    throw new Error(
      'EMAIL_FROM is unset (or still points at example.com) — refusing to send daily digest with a non-routable sender. Set EMAIL_FROM in .env.prod (e.g. "Showbook <digest@showbook.app>").',
    );
  }
  return candidate;
}

function getPhysicalAddress(): string {
  // CAN-SPAM §7 requires a valid physical postal address in every
  // commercial-shaped email (the digest qualifies). The default is
  // deliberately obvious-looking so a misconfigured prod boot is
  // caught in the first test send.
  return (
    process.env.EMAIL_PHYSICAL_ADDRESS ??
    '123 Example St, City, State 00000 — set EMAIL_PHYSICAL_ADDRESS in .env.prod'
  );
}
const FALLBACK_CUTOFF_DAYS = 7;
const ANNOUNCEMENT_CAP = 50;

/**
 * Minimal subset of the Resend SDK that `runDailyDigest` calls into.
 * Defined as an interface so tests can inject a fake without leaning on
 * Node's experimental `mock.module` for the `resend` specifier — that
 * mock doesn't intercept reliably once another test file has already
 * imported the real SDK in the same `node --test` invocation (the module
 * cache wins).
 */
export interface ResendDigestClient {
  emails: {
    send(
      payload: {
        from: string;
        to: string;
        subject: string;
        html: string;
        headers?: Record<string, string>;
      },
      options?: { idempotencyKey?: string },
    ): Promise<{
      data: { id: string } | null;
      error: { name?: string; message: string } | null;
    }>;
  };
}

function getResend(): ResendDigestClient | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    log.warn(
      { event: 'notifications.digest.no_resend_key' },
      'RESEND_API_KEY not set — emails will be skipped',
    );
    return null;
  }
  return new Resend(key) as unknown as ResendDigestClient;
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://showbook.local';
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Calendar date a Date falls on in the America/New_York timezone, formatted
 * YYYY-MM-DD. Used by the per-user idempotency guard so a pg-boss retry of a
 * partially-failed digest run doesn't re-email users who already received
 * today's digest before the failure.
 */
function etDateString(d: Date): string {
  const local = new Date(
    d.toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );
  return local.toISOString().split('T')[0]!;
}

export function whenLabel(row: {
  showDate: string;
  runStartDate: string | null;
  runEndDate: string | null;
  performanceDates: string[] | null;
}): string {
  const start = row.runStartDate ?? row.showDate;
  const end = row.runEndDate ?? row.showDate;
  const count = row.performanceDates?.length ?? 1;
  if (start === end) return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)} (${count} dates)`;
}

/**
 * Resolve the headliner label for a batch of shows in two queries total
 * (one for show kind/productionName, one for the headliner performer rows).
 * The previous per-show variant fanned out 2 queries per show inside a
 * Promise.all; for a user with 50 shows that's 100 unbounded parallel
 * queries that starve the connection pool.
 */
async function getHeadlinersForShows(
  showIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (showIds.length === 0) return out;

  const showRows = await db
    .select({
      id: shows.id,
      kind: shows.kind,
      productionName: shows.productionName,
    })
    .from(shows)
    .where(inArray(shows.id, showIds));

  const performerLookupIds: string[] = [];
  for (const row of showRows) {
    // Theatre + festival both carry their display title on
    // production_name (the play title / festival name). For festivals
    // we previously read a synthetic headliner performer row instead,
    // which was retired in migration 0052.
    if (
      (row.kind === 'theatre' || row.kind === 'festival') &&
      row.productionName
    ) {
      out.set(row.id, row.productionName);
    } else {
      performerLookupIds.push(row.id);
    }
  }

  if (performerLookupIds.length === 0) return out;

  const performerRows = await db
    .select({ showId: showPerformers.showId, name: performers.name })
    .from(showPerformers)
    .innerJoin(performers, eq(showPerformers.performerId, performers.id))
    .where(
      and(
        inArray(showPerformers.showId, performerLookupIds),
        eq(showPerformers.role, 'headliner'),
      ),
    );

  // First headliner wins, matching the prior limit(1) behaviour. Festivals
  // without a production_name fall through here too (legacy data).
  for (const row of performerRows) {
    if (!out.has(row.showId)) out.set(row.showId, row.name);
  }

  return out;
}

// ── Pure helper exposed for tests ──────────────────────────────────────

export interface AnnouncementInput {
  id: string;
  headliner: string;
  venueId: string;
  venueName: string;
  /** Venue coordinates, used for the region-filter step. Null when the
   *  venue has no geocoded location — those announcements can only enter
   *  the digest via an explicit venue follow. */
  venueLat: number | null;
  venueLng: number | null;
  headlinerPerformerId: string | null;
  showDate: string;
  runStartDate: string | null;
  runEndDate: string | null;
  performanceDates: string[] | null;
  onSaleDate: Date | null;
}

export interface BucketedAnnouncement {
  headliner: string;
  venueName: string;
  whenLabel: string;
  /**
   * Why this announcement made the digest:
   *   - `venue`: headliner is playing a venue the user follows.
   *   - `artist`: headliner is an artist the user follows (the venue
   *     also has to fall inside an active region when one is set).
   *   - `region`: neither follow matched, but the venue sits inside one
   *     of the user's active regions — this is what surfaces "what's
   *     happening near me" content for region-only opt-ins.
   */
  reason: 'venue' | 'artist' | 'region';
  onSaleSoon: boolean;
}

export interface BucketCounts {
  droppedArtistMatches: number;
  droppedOnSale: number;
}

/**
 * Bucket new announcements for a single user, given their follows.
 * Match precedence is `venue` > `artist` > `region` — the most specific
 * follow wins so the dedupe keeps the right reason on the row.
 * - Venue follow: always kept (an explicit venue follow is itself a
 *   geographic signal we respect, so it overrides region filtering).
 * - Artist follow: kept; when `activeRegions` is non-empty the venue
 *   lat/lng must fall inside one of the bboxes, otherwise the row is
 *   dropped and counted as `droppedArtistMatches`.
 * - Region-only: when `activeRegions` is non-empty, any announcement at
 *   a venue inside an active region is kept with reason `region`, even
 *   if neither follow set matches. This is what lets region-only
 *   opt-ins receive a digest — without it the empty-follows branch
 *   above would skip them entirely.
 * - Sort: by (reason priority, show date asc). Priority keeps venue /
 *   artist rows above region rows, so when the caller applies a cap the
 *   most specific matches survive.
 * - Dedupe: by (headliner, venue, whenLabel) after the priority sort,
 *   so an announcement that hit multiple buckets keeps its strongest
 *   reason.
 */
export function bucketAnnouncementsForUser(
  newAnnouncements: ReadonlyArray<AnnouncementInput>,
  followedVenueIds: ReadonlySet<string>,
  followedPerformerIds: ReadonlySet<string>,
  todayStr: string,
  sevenDaysOutStr: string,
  activeRegions: ReadonlyArray<RegionBbox> = [],
  counts?: BucketCounts,
): BucketedAnnouncement[] {
  const matched: Array<BucketedAnnouncement & { showDateMs: number; priority: number }> = [];
  const filterByRegion = activeRegions.length > 0;

  function venueInAnyRegion(a: AnnouncementInput): boolean {
    if (a.venueLat == null || a.venueLng == null) return false;
    return isPointInAnyRegion(a.venueLat, a.venueLng, activeRegions);
  }

  for (const a of newAnnouncements) {
    const matchVenue = followedVenueIds.has(a.venueId);
    const matchArtist =
      a.headlinerPerformerId !== null &&
      followedPerformerIds.has(a.headlinerPerformerId);
    const inRegion = filterByRegion && venueInAnyRegion(a);

    // Artist-only matches still respect the region filter — without an
    // active region the artist hit is kept verbatim, but with one set
    // it must fall inside the user's geography.
    if (filterByRegion && !matchVenue && matchArtist && !inRegion) {
      if (counts) counts.droppedArtistMatches += 1;
      continue;
    }

    if (!matchVenue && !matchArtist && !inRegion) continue;

    const reason: BucketedAnnouncement['reason'] = matchVenue
      ? 'venue'
      : matchArtist
        ? 'artist'
        : 'region';
    const priority = reason === 'venue' ? 0 : reason === 'artist' ? 1 : 2;

    const showDateMs = new Date(a.showDate + 'T00:00:00').getTime();
    const onSaleSoon =
      a.onSaleDate !== null &&
      a.onSaleDate >= new Date(todayStr + 'T00:00:00') &&
      a.onSaleDate <= new Date(sevenDaysOutStr + 'T23:59:59');

    matched.push({
      headliner: a.headliner,
      venueName: a.venueName,
      whenLabel: whenLabel(a),
      reason,
      showDateMs,
      onSaleSoon,
      priority,
    });
  }

  const seen = new Set<string>();
  return matched
    .sort((a, b) => a.priority - b.priority || a.showDateMs - b.showDateMs)
    .filter((a) => {
      const key = `${a.headliner}::${a.venueName}::${a.whenLabel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ showDateMs: _, priority: __, ...rest }) => rest);
}

// ── Main runner ────────────────────────────────────────────────────────

export interface RunDailyDigestOptions {
  /** Override the Resend client for tests. When unset the runner
   *  constructs one from `RESEND_API_KEY`; when null is supplied, email
   *  sending falls back to the dry-run branch. */
  resend?: ResendDigestClient | null;
}

export async function runDailyDigest(
  opts: RunDailyDigestOptions = {},
): Promise<{
  sent: number;
  skipped: number;
}> {
  const resend = opts.resend !== undefined ? opts.resend : getResend();
  const appUrl = getAppUrl();
  let sent = 0;
  let skipped = 0;

  const now = new Date();
  const etNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );
  const todayStr = etNow.toISOString().split('T')[0]!;
  const nextWeekDate = new Date(etNow);
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const nextWeekStr = nextWeekDate.toISOString().split('T')[0]!;

  // Fetch all current announcements once; per-user filtering happens in memory.
  // This stays cheap because the daily ingest caps inserts and old rows are pruned.
  const allRecentAnnouncements = await db
    .select({
      id: announcements.id,
      headliner: announcements.headliner,
      venueId: announcements.venueId,
      venueName: venues.name,
      venueLat: venues.latitude,
      venueLng: venues.longitude,
      headlinerPerformerId: announcements.headlinerPerformerId,
      showDate: announcements.showDate,
      runStartDate: announcements.runStartDate,
      runEndDate: announcements.runEndDate,
      performanceDates: announcements.performanceDates,
      onSaleDate: announcements.onSaleDate,
      discoveredAt: announcements.discoveredAt,
    })
    .from(announcements)
    .innerJoin(venues, eq(announcements.venueId, venues.id))
    .orderBy(asc(announcements.showDate));

  const eligibleUsers = await db
    .select({
      userId: userPreferences.userId,
      email: users.email,
      displayName: users.name,
      lastDigestSentAt: userPreferences.lastDigestSentAt,
      // Phase 11 §15o — spoiler-blur preference applied to the
      // PredictedSetlistTile in the "Tonight" section.
      setlistSpoilers: userPreferences.setlistSpoilers,
    })
    .from(userPreferences)
    .innerJoin(users, eq(userPreferences.userId, users.id))
    .where(
      and(
        eq(userPreferences.emailNotifications, true),
        isNotNull(users.email),
      ),
    );

  for (const user of eligibleUsers) {
    if (!user.email) {
      skipped++;
      continue;
    }

    // Idempotency guard: pg-boss retries (retryLimit=3) a failed run, and
    // the eligibleUsers query has no per-day filter — so without this check
    // every user already processed before the failure would receive a
    // duplicate email on retry. Compare lastDigestSentAt's ET calendar
    // date against todayStr; if they match, today's send already happened.
    if (
      user.lastDigestSentAt &&
      etDateString(user.lastDigestSentAt) === todayStr
    ) {
      log.info(
        {
          event: 'notifications.digest.already_sent_today',
          userId: user.userId,
        },
        'Skipping user: already received today\'s digest',
      );
      skipped++;
      continue;
    }

    try {
      const cutoff =
        user.lastDigestSentAt ??
        new Date(Date.now() - FALLBACK_CUTOFF_DAYS * 24 * 60 * 60 * 1000);

      // Today's ticketed shows
      const todayRows = await db
        .select({
          id: shows.id,
          venueName: venues.name,
          seat: shows.seat,
        })
        .from(shows)
        .innerJoin(venues, eq(shows.venueId, venues.id))
        .where(
          and(
            eq(shows.userId, user.userId),
            eq(shows.state, 'ticketed'),
            eq(shows.date, todayStr),
          ),
        );

      const todayHeadliners = await getHeadlinersForShows(
        todayRows.map((r) => r.id),
      );

      // Phase 11 §15o — prefetch the predicted setlist for each
      // today show so the PredictedSetlistTile can render top-5 (or
      // blur with count + "tap to reveal") respecting the user's
      // setlistSpoilers preference. Falls through silently on
      // prediction failure so the digest still ships.
      const todayPredictions = await buildTodayPredictions({
        showIds: todayRows.map((r) => r.id),
        targetDate: todayStr,
      });

      const todayShows = todayRows.map((row) => {
        const prediction = todayPredictions.get(row.id);
        const tile = prediction
          ? renderPredictedSetlistTile({
              prediction,
              setlistSpoilers: user.setlistSpoilers ?? 'style_default',
            })
          : null;
        return {
          headliner: todayHeadliners.get(row.id) ?? 'Unknown Artist',
          venueName: row.venueName,
          seat: row.seat,
          predictedSetlistTile: tile,
        };
      });

      // Upcoming ticketed shows (next 7 days, excluding today)
      const upcomingRows = await db
        .select({
          id: shows.id,
          date: shows.date,
          venueName: venues.name,
        })
        .from(shows)
        .innerJoin(venues, eq(shows.venueId, venues.id))
        .where(
          and(
            eq(shows.userId, user.userId),
            eq(shows.state, 'ticketed'),
            gte(shows.date, todayStr),
            lte(shows.date, nextWeekStr),
          ),
        )
        .orderBy(shows.date);

      const upcomingFiltered = upcomingRows.filter(
        (row) => row.date !== null && row.date !== todayStr,
      );
      const upcomingHeadliners = await getHeadlinersForShows(
        upcomingFiltered.map((r) => r.id),
      );
      const upcomingShows = upcomingFiltered.map((row) => {
        const showDate = new Date(row.date! + 'T00:00:00');
        const daysUntil = Math.round(
          (showDate.getTime() - new Date(todayStr + 'T00:00:00').getTime()) /
            (1000 * 60 * 60 * 24),
        );
        return {
          headliner: upcomingHeadliners.get(row.id) ?? 'Unknown Artist',
          venueName: row.venueName,
          dateLabel: formatDate(row.date!),
          daysUntil,
        };
      });

      // New announcements since last digest, matching follows
      const venueRows = await db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, user.userId));
      const performerRows = await db
        .select({ performerId: userPerformerFollows.performerId })
        .from(userPerformerFollows)
        .where(eq(userPerformerFollows.userId, user.userId));

      // Active regions narrow the artist-follow and on-sale buckets to the
      // user's geographic interests, mirroring the Discover near-you feed.
      // Zero active regions = filter is a no-op so existing users without
      // regions keep getting today's global digest.
      const activeRegionRows = await db
        .select({
          latitude: userRegions.latitude,
          longitude: userRegions.longitude,
          radiusMiles: userRegions.radiusMiles,
        })
        .from(userRegions)
        .where(
          and(
            eq(userRegions.userId, user.userId),
            eq(userRegions.active, true),
          ),
        );

      const followedVenueIds = new Set(venueRows.map((r) => r.venueId));
      const followedPerformerIds = new Set(
        performerRows.map((r) => r.performerId),
      );

      const newSinceCutoff = allRecentAnnouncements.filter(
        (a) => a.discoveredAt !== null && a.discoveredAt >= cutoff,
      );

      const filterCounts: BucketCounts = {
        droppedArtistMatches: 0,
        droppedOnSale: 0,
      };
      // Bucket if the user has at least one signal we can match against:
      // a followed venue, a followed performer, or an active region. The
      // region path is what lets users who've drawn a region but haven't
      // followed anything yet still receive a "what's happening near
      // you" digest — without it the empty-content skip below would
      // silently drop them every day.
      const hasFollowSignal =
        followedVenueIds.size > 0 ||
        followedPerformerIds.size > 0 ||
        activeRegionRows.length > 0;
      const newAnnouncements = hasFollowSignal
        ? bucketAnnouncementsForUser(
            newSinceCutoff,
            followedVenueIds,
            followedPerformerIds,
            todayStr,
            nextWeekStr,
            activeRegionRows,
            filterCounts,
          ).slice(0, ANNOUNCEMENT_CAP)
        : [];

      if (
        activeRegionRows.length > 0 &&
        filterCounts.droppedArtistMatches > 0
      ) {
        log.info(
          {
            event: 'notifications.digest.region_filtered',
            userId: user.userId,
            droppedArtistMatches: filterCounts.droppedArtistMatches,
            activeRegionCount: activeRegionRows.length,
          },
          'Region filter dropped artist-only announcements outside active regions',
        );
      }

      if (
        todayShows.length === 0 &&
        upcomingShows.length === 0 &&
        newAnnouncements.length === 0
      ) {
        skipped++;
        continue;
      }

      const displayName = user.displayName ?? 'there';
      let preamble: string | null = null;
      try {
        preamble = await generateDigestPreamble({
          displayName,
          todayShows,
          upcomingShows,
          newAnnouncements,
        });
      } catch (err) {
        log.warn(
          { err, event: 'notifications.digest.preamble_failed', userId: user.userId },
          'Preamble generation failed; falling back to static greeting',
        );
      }

      // Pre-mint the signed token so both the in-body unsubscribe
      // link and the List-Unsubscribe header point at the same URL.
      // Token is an HMAC over userId (see packages/api/src/unsubscribe-token.ts).
      const unsubscribeToken = signUnsubscribeToken(user.userId);
      const unsubscribeUrl = `${appUrl}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken)}`;
      const physicalAddress = getPhysicalAddress();

      const html = await renderDailyDigest({
        displayName,
        todayShows,
        upcomingShows,
        newAnnouncements,
        preamble,
        appUrl,
        noRegionNudge: activeRegionRows.length === 0,
        unsubscribeUrl,
        physicalAddress,
      });

      const subject =
        todayShows.length > 0
          ? `Show day! ${todayShows.map((s) => s.headliner).join(', ')}`
          : newAnnouncements.length > 0
            ? `${newAnnouncements.length} new show${newAnnouncements.length === 1 ? '' : 's'} you might want`
            : 'Your Showbook digest';

      const idempotencyKey = createHash('sha256')
        .update(`${user.userId}:${todayStr}`)
        .digest('hex')
        .slice(0, 32);

      if (!resend) {
        log.info(
          {
            event: 'notifications.digest.dry_run',
            userId: user.userId,
            todayShows: todayShows.length,
            upcomingShows: upcomingShows.length,
            newAnnouncements: newAnnouncements.length,
          },
          'Would send digest (no Resend key)',
        );
        skipped++;
        continue;
      }

      // Resend's SDK resolves successfully even when the API rejects the
      // send (bounce, unverified domain, rate limit, …) — failure is signalled
      // via `result.error`, not by throwing. Without this guard we'd count
      // rejects as sent, update lastDigestSentAt, and the per-user
      // idempotency check above would then block tomorrow's send too.
      //
      // `idempotencyKey` is the second-arg option that Resend honours
      // for cross-request dedup (the prior `X-Entity-Ref-ID` header
      // was ignored — see `packages/jobs/src/health-check.ts:261` for
      // the same pattern). With it placed correctly, Resend dedupes
      // within a 24 h window even if pg-boss retries the digest job.
      //
      // List-Unsubscribe + List-Unsubscribe-Post is CAN-SPAM and
      // RFC 8058 one-click: Gmail / Apple Mail / Outlook surface the
      // "Unsubscribe" chip above the email body and POST the URL on
      // tap. See `apps/web/app/api/unsubscribe/route.ts`.
      const sendResult = await resend.emails.send(
        {
          from: getFromAddress(),
          to: user.email,
          subject,
          html,
          headers: {
            'List-Unsubscribe': `<mailto:unsubscribe@${(getFromAddress().match(/@([^>]+)/) ?? [, 'showbook.app'])[1]}?subject=unsubscribe>, <${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        },
        { idempotencyKey },
      );

      if (sendResult.error) {
        log.error(
          {
            event: 'notifications.digest.send_failed',
            userId: user.userId,
            resendErrorName: sendResult.error.name,
            resendErrorMessage: sendResult.error.message,
          },
          'Resend rejected the digest send',
        );
        skipped++;
        continue;
      }

      await db
        .update(userPreferences)
        .set({ lastDigestSentAt: new Date() })
        .where(eq(userPreferences.userId, user.userId));

      sent++;
      log.info(
        {
          event: 'notifications.digest.sent',
          userId: user.userId,
          todayShows: todayShows.length,
          upcomingShows: upcomingShows.length,
          newAnnouncements: newAnnouncements.length,
          resendId: sendResult.data?.id ?? null,
        },
        'Digest sent',
      );
    } catch (err) {
      log.error(
        { err, event: 'notifications.digest.failed', userId: user.userId },
        'Digest failed for user',
      );
      skipped++;
    }
  }

  return { sent, skipped };
}

// ── Phase 11 §15o — PredictedSetlistTile prefetch + spoiler-aware shape ──

interface DigestPrediction {
  /** Total predicted song count surfaced in the tile summary line. */
  songCount: number;
  /** 0-1 confidence — rendered as a percentage in the summary. */
  confidence: number;
  /** First 5 predicted song titles for the reveal path. */
  topTitles: string[];
  /** True when the algorithm flags the style as spoiler-prone (stable
   *  + theatrical). Honored when `setlistSpoilers === 'style_default'`. */
  spoilerBlurDefault: boolean;
}

export type SetlistSpoilersPref = 'always_blur' | 'never_blur' | 'style_default';

export interface PredictedSetlistTile {
  /** Summary line: "{N} song setlist predicted ({P}%)". Always shown. */
  summary: string;
  /** Reveal payload — empty when blur is on. */
  topTitles: string[];
  /** True when the tile shows the blur curtain instead of titles. */
  blurred: boolean;
}

/**
 * For each of today's shows, prefetch the stable predicted setlist so
 * the PredictedSetlistTile in the digest can render counts + top-5
 * (or blur the titles per the user's preference). Failures are
 * silent — the digest still ships with the standard headliner row.
 */
async function buildTodayPredictions(opts: {
  showIds: string[];
  targetDate: string;
}): Promise<Map<string, DigestPrediction>> {
  const out = new Map<string, DigestPrediction>();
  if (opts.showIds.length === 0) return out;

  const headlinerRows = await db
    .select({
      showId: showPerformers.showId,
      performerId: showPerformers.performerId,
    })
    .from(showPerformers)
    .where(
      and(
        inArray(showPerformers.showId, opts.showIds),
        eq(showPerformers.role, 'headliner'),
      ),
    );
  const headlinerByShow = new Map<string, string>();
  for (const row of headlinerRows) {
    if (!headlinerByShow.has(row.showId)) {
      headlinerByShow.set(row.showId, row.performerId);
    }
  }

  for (const [showId, performerId] of headlinerByShow) {
    try {
      const result = await predictedSetlistCached({
        performerId,
        targetDate: opts.targetDate,
      });
      if (result.style === 'cold') continue;
      const top = result.core.slice(0, 5).map((s) => s.title);
      out.set(showId, {
        songCount: result.core.length + result.likely.length,
        confidence: result.confidence,
        topTitles: top,
        spoilerBlurDefault: result.spoilerBlurDefault,
      });
    } catch (err) {
      log.warn(
        {
          event: 'notifications.digest.prediction_failed',
          err,
          showId,
          performerId,
        },
        'prediction prefetch failed; digest tile skipped for this show',
      );
    }
  }
  return out;
}

/**
 * Apply the user's `setlistSpoilers` preference to a prediction and
 * produce the tile payload that renders in the digest. The renderer
 * always shows the summary line; only the title list is conditional.
 */
export function renderPredictedSetlistTile(opts: {
  prediction: DigestPrediction;
  setlistSpoilers: SetlistSpoilersPref;
}): PredictedSetlistTile {
  const { prediction, setlistSpoilers } = opts;
  const pct = Math.round(prediction.confidence * 100);
  const summary = `${prediction.songCount} song setlist predicted (${pct}%)`;
  const blurred =
    setlistSpoilers === 'always_blur' ||
    (setlistSpoilers === 'style_default' && prediction.spoilerBlurDefault);
  return {
    summary,
    topTitles: blurred ? [] : prediction.topTitles,
    blurred,
  };
}
