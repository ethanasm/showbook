import { Resend } from 'resend';
import { createHash } from 'node:crypto';
import { db } from '@showbook/db';
import {
  users,
  userPreferences,
  shows,
  showPerformers,
  performers,
  announcements,
  userVenueFollows,
  userPerformerFollows,
  venues,
} from '@showbook/db';
import { and, eq, gte, lte, isNotNull, asc } from 'drizzle-orm';
import { renderDailyDigest } from '@showbook/emails';

const DEFAULT_FROM_ADDRESS = 'Showbook <digest@ethanasm.me>';

function getFromAddress(): string {
  return process.env.EMAIL_FROM ?? DEFAULT_FROM_ADDRESS;
}
const FALLBACK_CUTOFF_DAYS = 7;
const ANNOUNCEMENT_CAP = 50;

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(
      '[notifications/daily-digest] RESEND_API_KEY not set — emails will be skipped',
    );
    return null;
  }
  return new Resend(key);
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

function whenLabel(row: {
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

async function getHeadlinerForShow(showId: string): Promise<string | null> {
  const [showRow] = await db
    .select({ kind: shows.kind, productionName: shows.productionName })
    .from(shows)
    .where(eq(shows.id, showId))
    .limit(1);

  if (showRow?.kind === 'theatre') {
    return showRow.productionName ?? null;
  }

  const rows = await db
    .select({ name: performers.name })
    .from(showPerformers)
    .innerJoin(performers, eq(showPerformers.performerId, performers.id))
    .where(
      and(
        eq(showPerformers.showId, showId),
        eq(showPerformers.role, 'headliner'),
      ),
    )
    .limit(1);

  return rows[0]?.name ?? null;
}

// ── Pure helper exposed for tests ──────────────────────────────────────

export interface AnnouncementInput {
  id: string;
  headliner: string;
  venueId: string;
  venueName: string;
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
  reason: 'venue' | 'artist';
  onSaleSoon: boolean;
}

/**
 * Bucket new announcements for a single user, given their follows.
 * - Drops announcements that match neither a followed venue nor a followed artist.
 * - Venue match wins over artist match (more specific to "where I'd see it").
 * - Dedupes by (headliner, venue, when) so an announcement matching both
 *   follows isn't doubled.
 * - Sorts by show date ascending. Caller decides on the cap.
 */
export function bucketAnnouncementsForUser(
  newAnnouncements: ReadonlyArray<AnnouncementInput>,
  followedVenueIds: ReadonlySet<string>,
  followedPerformerIds: ReadonlySet<string>,
  todayStr: string,
  sevenDaysOutStr: string,
): BucketedAnnouncement[] {
  const matched: Array<BucketedAnnouncement & { showDateMs: number }> = [];

  for (const a of newAnnouncements) {
    const matchVenue = followedVenueIds.has(a.venueId);
    const matchArtist =
      a.headlinerPerformerId !== null &&
      followedPerformerIds.has(a.headlinerPerformerId);
    if (!matchVenue && !matchArtist) continue;

    const showDateMs = new Date(a.showDate + 'T00:00:00').getTime();
    const onSaleSoon =
      a.onSaleDate !== null &&
      a.onSaleDate >= new Date(todayStr + 'T00:00:00') &&
      a.onSaleDate <= new Date(sevenDaysOutStr + 'T23:59:59');

    matched.push({
      headliner: a.headliner,
      venueName: a.venueName,
      whenLabel: whenLabel(a),
      reason: matchVenue ? 'venue' : 'artist',
      showDateMs,
      onSaleSoon,
    });
  }

  const seen = new Set<string>();
  return matched
    .sort((a, b) => a.showDateMs - b.showDateMs)
    .filter((a) => {
      const key = `${a.headliner}::${a.venueName}::${a.whenLabel}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ showDateMs: _, ...rest }) => rest);
}

// ── Main runner ────────────────────────────────────────────────────────

export async function runDailyDigest(): Promise<{
  sent: number;
  skipped: number;
}> {
  const resend = getResend();
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

      const todayShows = await Promise.all(
        todayRows.map(async (row) => ({
          headliner: (await getHeadlinerForShow(row.id)) ?? 'Unknown Artist',
          venueName: row.venueName,
          seat: row.seat,
        })),
      );

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

      const upcomingShows = (
        await Promise.all(
          upcomingRows.map(async (row) => {
            if (row.date === null || row.date === todayStr) return null;
            const headliner = await getHeadlinerForShow(row.id);
            const showDate = new Date(row.date + 'T00:00:00');
            const daysUntil = Math.round(
              (showDate.getTime() -
                new Date(todayStr + 'T00:00:00').getTime()) /
                (1000 * 60 * 60 * 24),
            );
            return {
              headliner: headliner ?? 'Unknown Artist',
              venueName: row.venueName,
              dateLabel: formatDate(row.date),
              daysUntil,
            };
          }),
        )
      ).filter(<T,>(x: T | null): x is T => x !== null);

      // New announcements since last digest, matching follows
      const venueRows = await db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, user.userId));
      const performerRows = await db
        .select({ performerId: userPerformerFollows.performerId })
        .from(userPerformerFollows)
        .where(eq(userPerformerFollows.userId, user.userId));

      const followedVenueIds = new Set(venueRows.map((r) => r.venueId));
      const followedPerformerIds = new Set(
        performerRows.map((r) => r.performerId),
      );

      const newSinceCutoff = allRecentAnnouncements.filter(
        (a) => a.discoveredAt !== null && a.discoveredAt >= cutoff,
      );

      const newAnnouncements =
        followedVenueIds.size === 0 && followedPerformerIds.size === 0
          ? []
          : bucketAnnouncementsForUser(
              newSinceCutoff,
              followedVenueIds,
              followedPerformerIds,
              todayStr,
              nextWeekStr,
            ).slice(0, ANNOUNCEMENT_CAP);

      if (
        todayShows.length === 0 &&
        upcomingShows.length === 0 &&
        newAnnouncements.length === 0
      ) {
        skipped++;
        continue;
      }

      const html = await renderDailyDigest({
        displayName: user.displayName ?? 'there',
        todayShows,
        upcomingShows,
        newAnnouncements,
        appUrl,
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
        console.log(
          `[notifications/daily-digest] Would send to ${user.email} (${todayShows.length} today, ${upcomingShows.length} upcoming, ${newAnnouncements.length} new)`,
        );
        skipped++;
        continue;
      }

      await resend.emails.send({
        from: getFromAddress(),
        to: user.email,
        subject,
        html,
        headers: { 'X-Entity-Ref-ID': idempotencyKey },
      });

      await db
        .update(userPreferences)
        .set({ lastDigestSentAt: new Date() })
        .where(eq(userPreferences.userId, user.userId));

      sent++;
      console.log(
        `[notifications/daily-digest] Sent to ${user.email} (${todayShows.length} today, ${upcomingShows.length} upcoming, ${newAnnouncements.length} new)`,
      );
    } catch (err) {
      console.error(
        `[notifications/daily-digest] Failed for user ${user.userId}:`,
        err,
      );
      skipped++;
    }
  }

  return { sent, skipped };
}
