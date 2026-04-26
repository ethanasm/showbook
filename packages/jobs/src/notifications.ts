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
  venues,
} from '@showbook/db';
import { and, eq, gte, lte, sql, ne, inArray } from 'drizzle-orm';

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
      // ── 2a. New announcements at followed venues (since yesterday) ──
      const followedVenueIds = await db
        .select({ venueId: userVenueFollows.venueId })
        .from(userVenueFollows)
        .where(eq(userVenueFollows.userId, user.userId));

      let newAnnouncements: Announcement[] = [];

      if (followedVenueIds.length > 0) {
        const venueIds = followedVenueIds.map((f) => f.venueId);
        const announcementRows = await db
          .select({
            headliner: announcements.headliner,
            showDate: announcements.showDate,
            venueName: venues.name,
          })
          .from(announcements)
          .innerJoin(venues, eq(announcements.venueId, venues.id))
          .where(
            and(
              inArray(announcements.venueId, venueIds),
              gte(announcements.discoveredAt, new Date(yesterdayStr + 'T00:00:00'))
            )
          );

        newAnnouncements = announcementRows.map((r) => ({
          headliner: r.headliner,
          venueName: r.venueName,
          showDate: r.showDate,
        }));
      }

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
