import { Resend } from 'resend';
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
import { and, eq, gte, lte, sql, ne, inArray, or, asc } from 'drizzle-orm';

const FROM_ADDRESS = 'Showbook <digest@ethanasm.me>';

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(
      '[notifications/digest] RESEND_API_KEY not set — emails will be skipped'
    );
    return null;
  }
  return new Resend(key);
}

// ── Email template helpers ────────────────────────────────────────────

interface Announcement {
  headliner: string;
  venueName: string;
  showDate: string;
}

interface UpcomingShow {
  headliner: string;
  venueName: string;
  date: string;
  daysUntil: number;
}

interface TodayShow {
  headliner: string;
  venueName: string;
  seat: string | null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function buildDigestHtml(
  displayName: string,
  newAnnouncements: Announcement[],
  upcomingShows: UpcomingShow[],
  todayShows: TodayShow[]
): string {
  const sections: string[] = [];

  if (newAnnouncements.length > 0) {
    const items = newAnnouncements
      .map(
        (a) =>
          `<li><strong>${a.headliner}</strong> at ${a.venueName} &mdash; ${formatDate(a.showDate)}</li>`
      )
      .join('\n');
    sections.push(`<h2>New Announcements</h2>\n<ul>${items}</ul>`);
  }

  if (upcomingShows.length > 0) {
    const items = upcomingShows
      .map(
        (s) =>
          `<li><strong>${s.headliner}</strong> at ${s.venueName} &mdash; ${formatDate(s.date)} (in ${s.daysUntil} day${s.daysUntil === 1 ? '' : 's'})</li>`
      )
      .join('\n');
    sections.push(`<h2>Upcoming Shows</h2>\n<ul>${items}</ul>`);
  }

  if (todayShows.length > 0) {
    const items = todayShows
      .map(
        (s) =>
          `<li>${s.headliner} at ${s.venueName}${s.seat ? ` &mdash; Seat: ${s.seat}` : ''}</li>`
      )
      .join('\n');
    sections.push(`<h2>Today's Shows</h2>\n<ul>${items}</ul>`);
  }

  if (sections.length === 0) {
    return ''; // Nothing to send
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h1 style="font-size: 22px; margin-bottom: 24px;">Your Showbook Digest</h1>
  <p>Hey ${displayName},</p>
  ${sections.join('\n<hr style="border: none; border-top: 1px solid #e5e5e5; margin: 20px 0;">\n')}
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 20px 0;">
  <p style="font-size: 12px; color: #888;">You received this because you have digest notifications enabled in Showbook. Update your preferences in Settings.</p>
</body>
</html>`.trim();
}

function buildReminderHtml(
  displayName: string,
  todayShows: TodayShow[]
): string {
  const items = todayShows
    .map(
      (s) =>
        `<li><strong>${s.headliner}</strong> at ${s.venueName}${s.seat ? ` &mdash; Seat: ${s.seat}` : ''}</li>`
    )
    .join('\n');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h1 style="font-size: 22px; margin-bottom: 24px;">Show Day Reminder</h1>
  <p>Hey ${displayName}, you have ${todayShows.length > 1 ? 'shows' : 'a show'} today!</p>
  <ul>${items}</ul>
  <p style="font-size: 12px; color: #888;">You received this because show-day reminders are enabled in Showbook. Update your preferences in Settings.</p>
</body>
</html>`.trim();
}

// ── Headliner lookup helper ───────────────────────────────────────────

async function getHeadlinerForShow(
  showId: string
): Promise<string | null> {
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
      and(eq(showPerformers.showId, showId), eq(showPerformers.role, 'headliner'))
    )
    .limit(1);

  return rows[0]?.name ?? null;
}

// ── Main digest runner ────────────────────────────────────────────────

export async function runNotificationDigest(): Promise<{
  sent: number;
  skipped: number;
}> {
  const resend = getResend();
  let sent = 0;
  let skipped = 0;

  // Current hour in ET (the app is self-hosted, timezone-aware)
  const now = new Date();
  const etNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  );
  const currentHour = `${String(etNow.getHours()).padStart(2, '0')}:00`;
  const dayOfWeek = etNow.getDay(); // 0=Sun, 1=Mon

  const todayStr = etNow.toISOString().split('T')[0]; // YYYY-MM-DD
  const yesterdayDate = new Date(etNow);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

  const nextWeekDate = new Date(etNow);
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const nextWeekStr = nextWeekDate.toISOString().split('T')[0];

  // ── 1. Find eligible digest users ──────────────────────────────────
  // Users whose digestTime matches current hour AND frequency != 'off'
  // For weekly: only run on Monday
  const eligibleUsers = await db
    .select({
      userId: userPreferences.userId,
      digestFrequency: userPreferences.digestFrequency,
      emailNotifications: userPreferences.emailNotifications,
      showDayReminder: userPreferences.showDayReminder,
      email: users.email,
      displayName: users.name,
    })
    .from(userPreferences)
    .innerJoin(users, eq(userPreferences.userId, users.id))
    .where(
      and(
        eq(userPreferences.digestTime, currentHour),
        ne(userPreferences.digestFrequency, 'off')
      )
    );

  for (const user of eligibleUsers) {
    // Weekly users only get digests on Monday
    if (user.digestFrequency === 'weekly' && dayOfWeek !== 1) {
      skipped++;
      continue;
    }

    // Skip if email notifications disabled
    if (!user.emailNotifications) {
      skipped++;
      continue;
    }

    try {
      // New-announcement discovery moved to runWeeklyDiscoveryDigest, which
      // fires once per ingestion run on Monday morning. The hourly digest
      // here only covers the user's own ticketed shows.
      const newAnnouncements: Announcement[] = [];

      // ── 2b. Upcoming ticketed shows in next 7 days ─────────────────
      const upcomingRows = await db
        .select({
          id: shows.id,
          date: shows.date,
          venueName: venues.name,
          seat: shows.seat,
        })
        .from(shows)
        .innerJoin(venues, eq(shows.venueId, venues.id))
        .where(
          and(
            eq(shows.userId, user.userId),
            eq(shows.state, 'ticketed'),
            gte(shows.date, todayStr),
            lte(shows.date, nextWeekStr)
          )
        )
        .orderBy(shows.date);

      const upcomingShows: UpcomingShow[] = [];
      for (const row of upcomingRows) {
        // gte(shows.date, todayStr) above filters out NULL dates, but TS
        // can't narrow drizzle's column types — guard explicitly.
        if (row.date === null) continue;
        const headliner = await getHeadlinerForShow(row.id);
        const showDate = new Date(row.date + 'T00:00:00');
        const daysUntil = Math.round(
          (showDate.getTime() - new Date(todayStr + 'T00:00:00').getTime()) /
            (1000 * 60 * 60 * 24)
        );
        upcomingShows.push({
          headliner: headliner ?? 'Unknown Artist',
          venueName: row.venueName,
          date: row.date,
          daysUntil,
        });
      }

      // ── 2c. Today's shows ──────────────────────────────────────────
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
            eq(shows.date, todayStr)
          )
        );

      const todayShows: TodayShow[] = [];
      for (const row of todayRows) {
        const headliner = await getHeadlinerForShow(row.id);
        todayShows.push({
          headliner: headliner ?? 'Unknown Artist',
          venueName: row.venueName,
          seat: row.seat,
        });
      }

      // ── 2d. Build and send digest email ────────────────────────────
      const html = buildDigestHtml(
        user.displayName ?? 'there',
        newAnnouncements,
        upcomingShows,
        todayShows
      );

      if (!html) {
        skipped++;
        continue;
      }

      if (!resend) {
        console.log(
          `[notifications/digest] Would send digest to ${user.email} (${newAnnouncements.length} announcements, ${upcomingShows.length} upcoming, ${todayShows.length} today)`
        );
        skipped++;
        continue;
      }

      if (!user.email) {
        skipped++;
        continue;
      }

      await resend.emails.send({
        from: FROM_ADDRESS,
        to: user.email,
        subject: todayShows.length > 0
          ? `Show day! ${todayShows.map((s) => s.headliner).join(', ')}`
          : 'Your Showbook Digest',
        html,
      });

      sent++;
      console.log(`[notifications/digest] Sent digest to ${user.email}`);
    } catch (err) {
      console.error(
        `[notifications/digest] Failed for user ${user.userId}:`,
        err
      );
      skipped++;
    }
  }

  // ── 3. Show-day reminders (separate from digest) ────────────────────
  // Find users with showDayReminder=true who have ticketed shows today
  // but were NOT already covered by a digest email above
  const digestUserIds = new Set(eligibleUsers.map((u) => u.userId));

  const reminderUsers = await db
    .select({
      userId: userPreferences.userId,
      showDayReminder: userPreferences.showDayReminder,
      emailNotifications: userPreferences.emailNotifications,
      email: users.email,
      displayName: users.name,
    })
    .from(userPreferences)
    .innerJoin(users, eq(userPreferences.userId, users.id))
    .where(
      and(
        eq(userPreferences.showDayReminder, true),
        eq(userPreferences.emailNotifications, true)
      )
    );

  for (const user of reminderUsers) {
    // Skip if already sent a digest this hour (which includes today's shows)
    if (digestUserIds.has(user.userId)) continue;

    // Only send show-day reminders at a reasonable hour (check if current hour is their digestTime)
    // For simplicity, send reminders at the user's digestTime too — but since we
    // already handled digest users, we check if their digestFrequency='off' but
    // they still want reminders
    const prefs = await db
      .select({ digestTime: userPreferences.digestTime })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.userId))
      .limit(1);

    if (!prefs[0] || prefs[0].digestTime !== currentHour) continue;

    try {
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
            eq(shows.date, todayStr)
          )
        );

      if (todayRows.length === 0) continue;

      const todayShows: TodayShow[] = [];
      for (const row of todayRows) {
        const headliner = await getHeadlinerForShow(row.id);
        todayShows.push({
          headliner: headliner ?? 'Unknown Artist',
          venueName: row.venueName,
          seat: row.seat,
        });
      }

      if (!resend) {
        console.log(
          `[notifications/digest] Would send show-day reminder to ${user.email} (${todayShows.length} shows)`
        );
        skipped++;
        continue;
      }

      if (!user.email) {
        skipped++;
        continue;
      }

      const html = buildReminderHtml(user.displayName ?? 'there', todayShows);
      await resend.emails.send({
        from: FROM_ADDRESS,
        to: user.email,
        subject: `Show day! ${todayShows.map((s) => s.headliner).join(', ')}`,
        html,
      });

      sent++;
      console.log(
        `[notifications/digest] Sent show-day reminder to ${user.email}`
      );
    } catch (err) {
      console.error(
        `[notifications/digest] Reminder failed for user ${user.userId}:`,
        err
      );
      skipped++;
    }
  }

  return { sent, skipped };
}

// ===========================================================================
// Weekly discovery digest — chained immediately after runDiscoverIngest
// ===========================================================================

interface DigestAnnouncement {
  headliner: string;
  venueName: string;
  /** Single date OR run window like "Aug 1 – Dec 15 (90 dates)". */
  whenLabel: string;
  /** Either 'venue' (followed venue) or 'artist' (followed artist) — drives sectioning. */
  reason: 'venue' | 'artist';
  /** Unix ms for sorting the email. */
  showDateMs: number;
  onSaleSoon: boolean;
}

const WEEKLY_DIGEST_CAP = 50;

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

function buildWeeklyDigestHtml(
  displayName: string,
  byVenue: DigestAnnouncement[],
  byArtist: DigestAnnouncement[],
  onSaleSoon: DigestAnnouncement[],
  totalCount: number,
  truncated: boolean,
): string {
  function section(title: string, items: DigestAnnouncement[]): string {
    if (items.length === 0) return '';
    const lis = items
      .map(
        (a) =>
          `<li><strong>${escapeHtml(a.headliner)}</strong> at ${escapeHtml(a.venueName)} &mdash; ${escapeHtml(a.whenLabel)}</li>`,
      )
      .join('\n');
    return `<h2 style="font-size: 16px; margin-top: 24px;">${title}</h2>\n<ul>${lis}</ul>`;
  }

  const sections = [
    section('At venues you follow', byVenue),
    section('By artists you follow', byArtist),
    section('On sale this week', onSaleSoon),
  ]
    .filter(Boolean)
    .join('\n');

  const moreLine = truncated
    ? `<p><a href="https://showbook.local/discover">View all ${totalCount} new shows in Showbook &rarr;</a></p>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
  <h1 style="font-size: 22px; margin-bottom: 8px;">${totalCount} new show${totalCount === 1 ? '' : 's'} you might want</h1>
  <p style="color: #666;">Hi ${escapeHtml(displayName)} — here's what we found this week at the venues and artists you follow.</p>
  ${sections}
  ${moreLine}
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;">
  <p style="font-size: 12px; color: #888;">We check for new shows once a week. To stop these emails, change your preferences in Showbook.</p>
</body>
</html>`.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * For each user with email_notifications=true, collect announcements newly
 * discovered during this ingestion run that match their followed venues or
 * artists. Send exactly one email per user with non-empty content.
 *
 * Called immediately after runDiscoverIngest from the job handler.
 */
export async function runWeeklyDiscoveryDigest(args: {
  ingestionRunStart: Date;
}): Promise<{ sent: number; skipped: number }> {
  const resend = getResend();
  let sent = 0;
  let skipped = 0;

  const todayStr = new Date().toISOString().split('T')[0]!;
  const sevenDaysOut = new Date();
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const sevenDaysOutStr = sevenDaysOut.toISOString().split('T')[0]!;

  // Fetch all the new announcements from this run once, then bucket per user.
  const newAnnouncements = await db
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
    })
    .from(announcements)
    .innerJoin(venues, eq(announcements.venueId, venues.id))
    .where(gte(announcements.discoveredAt, args.ingestionRunStart))
    .orderBy(asc(announcements.showDate));

  if (newAnnouncements.length === 0) {
    return { sent: 0, skipped: 0 };
  }

  const eligibleUsers = await db
    .select({
      userId: userPreferences.userId,
      emailNotifications: userPreferences.emailNotifications,
      email: users.email,
      displayName: users.name,
    })
    .from(userPreferences)
    .innerJoin(users, eq(userPreferences.userId, users.id))
    .where(eq(userPreferences.emailNotifications, true));

  for (const user of eligibleUsers) {
    if (!user.email) {
      skipped++;
      continue;
    }
    try {
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

      if (followedVenueIds.size === 0 && followedPerformerIds.size === 0) {
        skipped++;
        continue;
      }

      const matched: DigestAnnouncement[] = [];
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
          // Venue match wins over artist match in the bucketing — most
          // specific to "where I'd see it."
          reason: matchVenue ? 'venue' : 'artist',
          showDateMs,
          onSaleSoon,
        });
      }

      if (matched.length === 0) {
        skipped++;
        continue;
      }

      // Sort by show date ascending, dedup by (headliner, venue, when) so a
      // run announcement matching both venue+artist follows isn't doubled.
      const seen = new Set<string>();
      const sorted = matched
        .sort((a, b) => a.showDateMs - b.showDateMs)
        .filter((a) => {
          const key = `${a.headliner}::${a.venueName}::${a.whenLabel}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

      const totalCount = sorted.length;
      const capped = sorted.slice(0, WEEKLY_DIGEST_CAP);
      const truncated = sorted.length > WEEKLY_DIGEST_CAP;

      const byVenue = capped.filter((a) => a.reason === 'venue');
      const byArtist = capped.filter((a) => a.reason === 'artist');
      const onSaleSoon = capped.filter((a) => a.onSaleSoon);

      const html = buildWeeklyDigestHtml(
        user.displayName ?? 'there',
        byVenue,
        byArtist,
        onSaleSoon,
        totalCount,
        truncated,
      );

      if (!resend) {
        console.log(
          `[notifications/weekly-digest] Would send to ${user.email} (${totalCount} matches, ${capped.length} in body)`,
        );
        skipped++;
        continue;
      }

      await resend.emails.send({
        from: FROM_ADDRESS,
        to: user.email,
        subject: `${totalCount} new show${totalCount === 1 ? '' : 's'} you might want`,
        html,
      });
      sent++;
      console.log(
        `[notifications/weekly-digest] Sent to ${user.email} (${totalCount} matches)`,
      );
    } catch (err) {
      console.error(
        `[notifications/weekly-digest] Failed for user ${user.userId}:`,
        err,
      );
      skipped++;
    }
  }

  // Quiet unused imports — kept for future use in this file.
  void sql;
  void or;

  return { sent, skipped };
}
