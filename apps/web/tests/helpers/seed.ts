// Seed data helper - will use DB client when available (T06)
// For now, defines the test dataset structure

export interface TestDataSet {
  venues: Array<{
    name: string;
    city: string;
    stateRegion: string;
    country: string;
    latitude: number;
    longitude: number;
  }>;
  performers: Array<{
    name: string;
    ticketmasterAttractionId?: string;
  }>;
  shows: Array<{
    kind: 'concert' | 'theatre' | 'comedy' | 'festival';
    state: 'past' | 'ticketed' | 'watching';
    headliner: string;
    venue: string;
    date: string;
    seat?: string;
    pricePaid?: string;
    ticketCount?: number;
  }>;
}

export const TEST_DATA: TestDataSet = {
  venues: [
    { name: 'Madison Square Garden', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7505, longitude: -73.9934 },
    { name: 'Radio City Music Hall', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7600, longitude: -73.9800 },
    { name: 'Brooklyn Steel', city: 'Brooklyn', stateRegion: 'NY', country: 'US', latitude: 40.7122, longitude: -73.9413 },
    { name: 'Gershwin Theatre', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7621, longitude: -73.9854 },
    { name: 'The Comedy Cellar', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7304, longitude: -74.0005 },
    { name: 'Randalls Island Park', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7932, longitude: -73.9212 },
    { name: 'The Beacon Theatre', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7785, longitude: -73.9810 },
    { name: 'Irving Plaza', city: 'New York', stateRegion: 'NY', country: 'US', latitude: 40.7349, longitude: -73.9883 },
  ],
  performers: [
    { name: 'Radiohead', ticketmasterAttractionId: 'K8vZ91713wV' },
    { name: 'LCD Soundsystem' },
    { name: 'Massive Attack' },
    { name: 'Wicked' },
    { name: 'Cynthia Erivo' },
    { name: 'Kristin Chenoweth' },
    { name: 'John Mulaney' },
    { name: 'Taylor Swift' },
    { name: 'Metallica' },
    { name: 'Phoebe Bridgers' },
    { name: 'Japanese Breakfast' },
    { name: 'The National' },
    { name: 'Dave Chappelle' },
    { name: 'Hamilton' },
    { name: 'Lin-Manuel Miranda' },
  ],
  shows: [
    // Past concerts
    { kind: 'concert', state: 'past', headliner: 'Radiohead', venue: 'Madison Square Garden', date: '2024-06-15', seat: 'FLOOR B · 12', pricePaid: '185.00' },
    { kind: 'concert', state: 'past', headliner: 'LCD Soundsystem', venue: 'Brooklyn Steel', date: '2024-08-22', seat: 'GA', pricePaid: '75.00' },
    { kind: 'concert', state: 'past', headliner: 'The National', venue: 'The Beacon Theatre', date: '2024-09-10', seat: 'MEZZ · H22', pricePaid: '95.00' },
    { kind: 'concert', state: 'past', headliner: 'Japanese Breakfast', venue: 'Irving Plaza', date: '2024-11-03', seat: 'GA', pricePaid: '45.00' },
    { kind: 'concert', state: 'past', headliner: 'Phoebe Bridgers', venue: 'Radio City Music Hall', date: '2025-01-18', seat: 'ORCH · F14', pricePaid: '120.00' },

    // Past theatre
    { kind: 'theatre', state: 'past', headliner: 'Wicked', venue: 'Gershwin Theatre', date: '2024-07-20', seat: 'ORCH L · 14', pricePaid: '250.00' },
    { kind: 'theatre', state: 'past', headliner: 'Hamilton', venue: 'Radio City Music Hall', date: '2024-12-28', seat: 'MEZZ · A8', pricePaid: '350.00' },

    // Past comedy
    { kind: 'comedy', state: 'past', headliner: 'John Mulaney', venue: 'The Beacon Theatre', date: '2024-10-15', seat: 'ORCH · J18', pricePaid: '85.00' },
    { kind: 'comedy', state: 'past', headliner: 'Dave Chappelle', venue: 'Madison Square Garden', date: '2025-02-14', seat: 'SEC 108 · R5', pricePaid: '150.00' },

    // Past festival
    { kind: 'festival', state: 'past', headliner: 'Governors Ball', venue: 'Randalls Island Park', date: '2024-06-07', seat: 'GA 3-DAY', pricePaid: '375.00' },

    // Ticketed (future shows)
    { kind: 'concert', state: 'ticketed', headliner: 'Taylor Swift', venue: 'Madison Square Garden', date: '2026-06-20', seat: 'FLOOR A · 8', pricePaid: '450.00' },
    { kind: 'concert', state: 'ticketed', headliner: 'Radiohead', venue: 'The Beacon Theatre', date: '2026-07-15', seat: 'ORCH · C5', pricePaid: '195.00' },
    { kind: 'theatre', state: 'ticketed', headliner: 'Wicked', venue: 'Gershwin Theatre', date: '2026-05-10', seat: 'FRONT MEZZ · B12', pricePaid: '275.00' },
    { kind: 'comedy', state: 'ticketed', headliner: 'John Mulaney', venue: 'Radio City Music Hall', date: '2026-08-01', seat: 'ORCH · G22', pricePaid: '110.00' },

    // Watching
    { kind: 'concert', state: 'watching', headliner: 'Massive Attack', venue: 'Brooklyn Steel', date: '2026-09-12' },
    { kind: 'concert', state: 'watching', headliner: 'Metallica', venue: 'Madison Square Garden', date: '2026-10-05' },
    { kind: 'festival', state: 'watching', headliner: 'Governors Ball 2026', venue: 'Randalls Island Park', date: '2026-06-05' },

    // More past for variety
    { kind: 'concert', state: 'past', headliner: 'Massive Attack', venue: 'Brooklyn Steel', date: '2023-11-20', seat: 'GA', pricePaid: '65.00' },
    { kind: 'comedy', state: 'past', headliner: 'John Mulaney', venue: 'The Comedy Cellar', date: '2023-08-05', pricePaid: '25.00' },
    { kind: 'concert', state: 'past', headliner: 'Metallica', venue: 'Madison Square Garden', date: '2023-12-01', seat: 'SEC 224 · R12', pricePaid: '175.00' },
  ],
};

export async function seedTestData() {
  // Will be implemented when DB client is available
  console.log('Seed data: DB client not yet available, using mock data');
}

export async function cleanTestData() {
  console.log('Clean data: DB client not yet available');
}
