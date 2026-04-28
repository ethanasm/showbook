import { NextResponse } from 'next/server';
import {
  db,
  eq,
  users,
  venues,
  performers,
  shows,
  showPerformers,
  announcements,
  showAnnouncementLinks,
  userVenueFollows,
  userRegions,
  userPreferences,
} from '@showbook/db';

const TEST_EMAIL = 'test@showbook.dev';

const VENUES = [
  { name: 'Madison Square Garden', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7505, longitude: -73.9934, ticketmasterVenueId: 'KovZpZA7AAEA', googlePlaceId: 'ChIJhRwB-yFawokR5Phil-QQ3zM' },
  { name: 'Radio City Music Hall', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.76, longitude: -73.98, googlePlaceId: 'ChIJpVoj4WdZwokR9lNbEqR_3iA' },
  { name: 'Brooklyn Steel', city: 'Brooklyn', stateRegion: 'NY', country: 'US', latitude: 40.7122, longitude: -73.9413 },
  { name: 'Gershwin Theatre', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7621, longitude: -73.9854, ticketmasterVenueId: 'KovZpZAFkF7A' },
  { name: 'The Comedy Cellar', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7304, longitude: -74.0005 },
  { name: 'Randalls Island Park', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7932, longitude: -73.9212 },
  { name: 'The Beacon Theatre', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7785, longitude: -73.981 },
  { name: 'Irving Plaza', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7349, longitude: -73.9883 },
] as const;

const PERFORMERS = [
  { name: 'Radiohead', ticketmasterAttractionId: 'K8vZ91713wV' },
  { name: 'LCD Soundsystem' },
  { name: 'Massive Attack' },
  { name: 'Cynthia Erivo' },
  { name: 'Kristin Chenoweth' },
  { name: 'John Mulaney' },
  { name: 'Taylor Swift' },
  { name: 'Metallica' },
  { name: 'Phoebe Bridgers' },
  { name: 'Japanese Breakfast' },
  { name: 'The National' },
  { name: 'Dave Chappelle' },
  { name: 'Lin-Manuel Miranda' },
  { name: 'Sam Morril' },
  { name: 'Mark Normand' },
] as const;

interface ShowSeed {
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  state: 'past' | 'ticketed' | 'watching';
  headliner: string;
  support?: string[];
  venueName: string;
  date: string;
  endDate?: string;
  seat?: string;
  pricePaid?: string;
  ticketCount?: number;
  tourName?: string;
  productionName?: string;
  setlist?: string[];
}

const SHOWS: ShowSeed[] = [
  // Past concerts (5)
  { kind: 'concert', state: 'past', headliner: 'Radiohead', support: ['LCD Soundsystem'], venueName: 'Madison Square Garden', date: '2024-06-15', seat: 'FLOOR B · 12', pricePaid: '370.00', ticketCount: 2, tourName: 'In Rainbows Anniversary', setlist: ['15 Step', 'Bodysnatchers', 'Nude', 'Weird Fishes/Arpeggi', 'All I Need', 'Faust Arp', 'Reckoner', 'House of Cards', 'Jigsaw Falling into Place', 'Videotape'] },
  { kind: 'concert', state: 'past', headliner: 'LCD Soundsystem', venueName: 'Brooklyn Steel', date: '2024-08-22', seat: 'GA', pricePaid: '75.00' },
  { kind: 'concert', state: 'past', headliner: 'The National', venueName: 'The Beacon Theatre', date: '2024-09-10', seat: 'MEZZ · H22', pricePaid: '95.00' },
  { kind: 'concert', state: 'past', headliner: 'Japanese Breakfast', support: ['Phoebe Bridgers'], venueName: 'Irving Plaza', date: '2024-11-03', seat: 'GA', pricePaid: '45.00' },
  { kind: 'concert', state: 'past', headliner: 'Phoebe Bridgers', venueName: 'Radio City Music Hall', date: '2025-01-18', seat: 'ORCH · F14', pricePaid: '120.00' },

  // Past theatre (2)
  { kind: 'theatre', state: 'past', headliner: 'Wicked', productionName: 'Wicked', venueName: 'Gershwin Theatre', date: '2024-07-20', seat: 'ORCH L · 14', pricePaid: '500.00', ticketCount: 2 },
  { kind: 'theatre', state: 'past', headliner: 'Hamilton', productionName: 'Hamilton', venueName: 'Radio City Music Hall', date: '2024-12-28', seat: 'MEZZ · A8', pricePaid: '700.00', ticketCount: 2 },

  // Past comedy (2)
  { kind: 'comedy', state: 'past', headliner: 'John Mulaney', support: ['Sam Morril'], venueName: 'The Beacon Theatre', date: '2024-10-15', seat: 'ORCH · J18', pricePaid: '85.00' },
  { kind: 'comedy', state: 'past', headliner: 'Dave Chappelle', support: ['Mark Normand'], venueName: 'Madison Square Garden', date: '2025-02-14', seat: 'SEC 108 · R5', pricePaid: '150.00' },

  // Past festival (1)
  { kind: 'festival', state: 'past', headliner: 'Radiohead', support: ['LCD Soundsystem', 'Japanese Breakfast'], venueName: 'Randalls Island Park', date: '2024-06-07', endDate: '2024-06-09', seat: 'GA 3-DAY', pricePaid: '375.00', productionName: 'Governors Ball' },

  // Extra past for repeat stats (3)
  { kind: 'concert', state: 'past', headliner: 'Massive Attack', venueName: 'Brooklyn Steel', date: '2023-11-20', seat: 'GA', pricePaid: '65.00' },
  { kind: 'comedy', state: 'past', headliner: 'John Mulaney', venueName: 'The Comedy Cellar', date: '2023-08-05', pricePaid: '25.00' },
  { kind: 'concert', state: 'past', headliner: 'Metallica', venueName: 'Madison Square Garden', date: '2023-12-01', seat: 'SEC 224 · R12', pricePaid: '175.00' },

  // Ticketed (4)
  { kind: 'concert', state: 'ticketed', headliner: 'Taylor Swift', venueName: 'Madison Square Garden', date: '2026-06-20', seat: 'FLOOR A · 8', pricePaid: '900.00', ticketCount: 2 },
  { kind: 'concert', state: 'ticketed', headliner: 'Radiohead', venueName: 'The Beacon Theatre', date: '2026-07-15', seat: 'ORCH · C5', pricePaid: '195.00' },
  { kind: 'theatre', state: 'ticketed', headliner: 'Wicked', productionName: 'Wicked', venueName: 'Gershwin Theatre', date: '2026-05-10', seat: 'FRONT MEZZ · B12', pricePaid: '275.00' },
  { kind: 'comedy', state: 'ticketed', headliner: 'John Mulaney', venueName: 'Radio City Music Hall', date: '2026-08-01', seat: 'ORCH · G22', pricePaid: '110.00' },

  // Watching (3)
  { kind: 'concert', state: 'watching', headliner: 'Massive Attack', venueName: 'Brooklyn Steel', date: '2026-09-12' },
  { kind: 'concert', state: 'watching', headliner: 'Metallica', venueName: 'Madison Square Garden', date: '2026-10-05' },
  { kind: 'festival', state: 'watching', headliner: 'The National', support: ['Japanese Breakfast', 'Phoebe Bridgers'], venueName: 'Randalls Island Park', date: '2026-06-05', endDate: '2026-06-07', productionName: 'Panorama Festival' },
];

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  try {
    // Auto-create the test user if missing so tests can call /api/test/seed
    // before /api/test/login. Login is idempotent, so the order no longer
    // matters in test setup.
    let user = await db.query.users.findFirst({
      where: eq(users.email, TEST_EMAIL),
    });

    if (!user) {
      const [created] = await db
        .insert(users)
        .values({ email: TEST_EMAIL, name: 'Test User' })
        .returning();
      user = created!;
    }

    // Clean existing test user data in FK order. Announcements must be
    // deleted BEFORE shows because the cleanup_orphaned_venue trigger fires
    // on show delete and tries to drop venues with no shows — which would
    // fail FK if announcements still reference them.
    const userShows = await db.query.shows.findMany({ where: eq(shows.userId, user.id) });
    for (const s of userShows) {
      await db.delete(showPerformers).where(eq(showPerformers.showId, s.id));
      await db.delete(showAnnouncementLinks).where(eq(showAnnouncementLinks.showId, s.id));
    }
    await db.delete(userVenueFollows).where(eq(userVenueFollows.userId, user.id));
    await db.delete(userRegions).where(eq(userRegions.userId, user.id));
    await db.delete(announcements);
    await db.delete(shows).where(eq(shows.userId, user.id));

    // Insert venues
    const venueMap = new Map<string, string>();
    for (const v of VENUES) {
      const [inserted] = await db.insert(venues).values(v).onConflictDoNothing().returning();
      if (inserted) {
        venueMap.set(v.name, inserted.id);
      } else {
        const existing = await db.query.venues.findFirst({
          where: eq(venues.name, v.name),
        });
        if (existing) venueMap.set(v.name, existing.id);
      }
    }

    // Insert performers
    const performerMap = new Map<string, string>();
    for (const p of PERFORMERS) {
      const [inserted] = await db.insert(performers).values(p).onConflictDoNothing().returning();
      if (inserted) {
        performerMap.set(p.name, inserted.id);
      } else {
        const existing = await db.query.performers.findFirst({
          where: eq(performers.name, p.name),
        });
        if (existing) performerMap.set(p.name, existing.id);
      }
    }

    // Insert shows with performers
    let showCount = 0;
    for (const s of SHOWS) {
      const venueId = venueMap.get(s.venueName);
      if (!venueId) continue;

      const productionName =
        s.kind === 'theatre' ? s.productionName ?? s.headliner : s.productionName ?? null;

      const [show] = await db.insert(shows).values({
        userId: user.id,
        kind: s.kind,
        state: s.state,
        venueId,
        date: s.date,
        endDate: s.endDate ?? null,
        seat: s.seat ?? null,
        pricePaid: s.pricePaid ?? null,
        ticketCount: s.ticketCount ?? 1,
        tourName: s.tourName ?? null,
        productionName,
        setlist: s.setlist ?? null,
      }).returning();

      if (!show) continue;
      showCount++;

      // Headliner — skipped for theatre (production goes on shows.productionName)
      if (s.kind !== 'theatre') {
        const headlinerId = performerMap.get(s.headliner);
        if (headlinerId) {
          await db.insert(showPerformers).values({
            showId: show.id,
            performerId: headlinerId,
            role: 'headliner',
            sortOrder: 0,
          }).onConflictDoNothing();
        }
      }

      // Support acts
      if (s.support) {
        for (let i = 0; i < s.support.length; i++) {
          const supportId = performerMap.get(s.support[i]!);
          if (supportId) {
            await db.insert(showPerformers).values({
              showId: show.id,
              performerId: supportId,
              role: s.kind === 'theatre' ? 'cast' : 'support',
              sortOrder: i + 1,
            }).onConflictDoNothing();
          }
        }
      }
    }

    // Insert preferences
    await db.insert(userPreferences).values({
      userId: user.id,
      theme: 'dark',
      compactMode: false,
      digestFrequency: 'weekly',
      digestTime: '09:00',
      emailNotifications: true,
      pushNotifications: true,
      showDayReminder: true,
    }).onConflictDoNothing();

    // Insert regions
    await db.insert(userRegions).values([
      { userId: user.id, cityName: 'New York', latitude: 40.7128, longitude: -74.006, radiusMiles: 30, active: true },
      { userId: user.id, cityName: 'Brooklyn', latitude: 40.6782, longitude: -73.9442, radiusMiles: 10, active: true },
    ]);

    // Follow 3 venues
    const followVenues = ['Madison Square Garden', 'Brooklyn Steel', 'The Beacon Theatre', 'Radio City Music Hall'];
    for (const name of followVenues) {
      const vid = venueMap.get(name);
      if (vid) {
        await db.insert(userVenueFollows).values({ userId: user.id, venueId: vid }).onConflictDoNothing();
      }
    }

    // Insert announcements at followed venues
    const msgId = venueMap.get('Madison Square Garden')!;
    const bsId = venueMap.get('Brooklyn Steel')!;
    const btId = venueMap.get('The Beacon Theatre')!;

    // Build a 90-night Hamilton run for testing run-card rendering.
    const hamiltonDates: string[] = [];
    const hamStart = new Date('2026-08-01');
    for (let i = 0; i < 90; i++) {
      const d = new Date(hamStart);
      d.setDate(hamStart.getDate() + i);
      hamiltonDates.push(d.toISOString().slice(0, 10));
    }
    const radioCityId = venueMap.get('Radio City Music Hall')!;

    await db.insert(announcements).values([
      { venueId: msgId, kind: 'concert', headliner: 'Bon Iver', support: ['Big Thief'], showDate: '2026-08-15', runStartDate: '2026-08-15', runEndDate: '2026-08-15', performanceDates: ['2026-08-15'], onSaleStatus: 'on_sale', source: 'ticketmaster' },
      { venueId: msgId, kind: 'comedy', headliner: 'Trevor Noah', showDate: '2026-09-01', runStartDate: '2026-09-01', runEndDate: '2026-09-01', performanceDates: ['2026-09-01'], onSaleStatus: 'announced', source: 'ticketmaster' },
      { venueId: bsId, kind: 'concert', headliner: 'Alvvays', support: ['Men I Trust'], showDate: '2026-07-22', runStartDate: '2026-07-22', runEndDate: '2026-07-22', performanceDates: ['2026-07-22'], onSaleStatus: 'on_sale', source: 'ticketmaster' },
      { venueId: btId, kind: 'concert', headliner: 'Fleet Foxes', showDate: '2026-08-30', runStartDate: '2026-08-30', runEndDate: '2026-08-30', performanceDates: ['2026-08-30'], onSaleStatus: 'sold_out', source: 'ticketmaster' },
      { venueId: btId, kind: 'concert', headliner: 'Big Thief', support: ['Adrianne Lenker'], showDate: '2026-10-18', runStartDate: '2026-10-18', runEndDate: '2026-10-18', performanceDates: ['2026-10-18'], onSaleStatus: 'announced', source: 'ticketmaster' },
      // Multi-night theatre run — exercises the run-card UI path
      {
        venueId: radioCityId,
        kind: 'theatre',
        headliner: 'Hamilton',
        productionName: 'Hamilton',
        showDate: hamiltonDates[0]!,
        runStartDate: hamiltonDates[0]!,
        runEndDate: hamiltonDates[hamiltonDates.length - 1]!,
        performanceDates: hamiltonDates,
        onSaleStatus: 'on_sale',
        source: 'ticketmaster',
      },
    ]);

    return NextResponse.json({
      ok: true,
      seeded: {
        venues: venueMap.size,
        performers: performerMap.size,
        shows: showCount,
        announcements: 6,
        regions: 2,
        followedVenues: followVenues.length,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
