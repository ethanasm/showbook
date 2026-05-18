// Show Page Tabs — payload mirrors the No Doubt @ Sphere upcoming show
// from the screenshots. State = upcoming + has tickets.

window.SHOW = {
  kindKey: 'concert',
  kind: 'CONCERT',
  headliner: 'No Doubt',
  date: { y: 2026, m: 'May', d: 9, dow: 'Saturday', full: 'Saturday, May 9, 2026' },
  countdown: 'in 1 day',
  tour: 'Sphere Residency · Night 4',

  venue: 'Sphere',
  city: 'Las Vegas, NV',
  doors: '7:00 pm',
  showtime: '8:30 pm',

  seat: 'Section 404 Row 7',
  seatDetail: 'GA standing · 5 seats',
  paid: 1424,
  paidEach: 285,
  tickets: 5,
  state: 'tix',          // upcoming with tickets
  source: 'Ticketmaster',

  lineup: [
    { role: 'HEADLINER', name: 'No Doubt', detail: 'first since 2015 reunion · Coachella → Sphere' },
  ],

  // Setlist Intelligence — predicted (since show is upcoming + Stable artist)
  setlistMode: 'predicted',
  archetype: 'STABLE',
  confidence: 92,
  source: 'last 12 shows',
  predicted: [
    ['Spiderwebs',           true,  'opener · 12/12'],
    ["Hella Good",           false, '11/12'],
    ['Underneath It All',    false, '12/12'],
    ['Hey Baby',             false, '11/12'],
    ['Sunday Morning',       true,  '10/12'],
    ['Bathwater',            false, '8/12'],
    ['Just a Girl',          true,  '12/12 · always main-set close'],
    ['Simple Kind of Life',  false, '7/12'],
    ['Excuse Me Mr.',        false, '6/12'],
    ['Ex-Girlfriend',        false, '8/12'],
    ['Running',              false, '9/12'],
    ["Don't Speak",          true,  '12/12 · always encore'],
  ],
  encorePredicted: [
    ['Rock Steady',          false, '6/12'],
    ["It's My Life",         false, '11/12'],
  ],

  // Hype playlist artifact (not yet created)
  hypePlaylist: null,

  notes: null,
  media: [],

  // Stats for "your history" callouts
  artistHistory: { seen: 0, ordinal: '1st time seeing' },
  venueHistory: { seen: 1, ordinal: '2nd time at Sphere' },
};

// ─── Music layer payloads ─────────────────────────────────────
window.SHOW.musicLayer = {
  // Predicted vibe (averaged across predicted setlist)
  vibePredicted: { energy:.78, acoustic:.22, happiness:.62, danceability:.81, instrumental:.12, live:.55, speech:.18 },
  // Predicted energy arc (1 dot per song; encore at the end)
  energyPredicted: [.42,.71,.58,.83,.38,.55,.92,.35,.62,.74,.69,.95, .52,.88],
  encoreStart: 12,
  // Pre-show priming (off by default, but mocked here)
  priming: 'You\u2019ve played 4 No Doubt tracks in the last 24 hours. \u201cJust a Girl\u201d is on heavy rotation.',
  // Estimated set length from predicted tracks
  setLengthEst: '~1h 32m predicted',
};

// ─── Past show variant (same canvas, post-show state) ───────────
window.PAST_SHOW = {
  ...window.SHOW,
  state: 'past',
  countdown: '7 days ago',
  date: { y: 2026, m: 'May', d: 2, dow: 'Saturday', full: 'Saturday, May 2, 2026' },
  setlistMode: 'actual',
  confidence: 100,
  archetype: 'CONFIRMED',
  source: 'setlist.fm · 18 songs',
  // Actual setlist (with energy + library flag)
  actual: [
    ['Hella Good',           false, 0.71, true],
    ['Spiderwebs',           true,  0.82, true],
    ['Ex-Girlfriend',        false, 0.68, false],
    ['Underneath It All',    false, 0.55, true],
    ['Hey Baby',             false, 0.74, true],
    ['Bathwater',            false, 0.51, false],
    ['Excuse Me Mr.',        false, 0.62, false],
    ['Simple Kind of Life',  false, 0.38, true],
    ['Sunday Morning',       false, 0.58, true],
    ['New',                  false, 0.66, false],
    ['Running',              false, 0.45, true],
    ['Settle Down',          false, 0.79, false],
    ['Just a Girl',          true,  0.96, true],
  ],
  encoreActual: [
    ['Rock Steady',          false, 0.81, true],
    ["It\u2019s My Life",    false, 0.88, true],
    ["Don\u2019t Speak",     true,  0.62, true],
  ],
  setLengthActual: '1h 47m 22s on stage',
  musicLayer: {
    vibeActual: { energy:.83, acoustic:.18, happiness:.68, danceability:.84, instrumental:.10, live:.62, speech:.16 },
    energyActual: [.71,.82,.68,.55,.74,.51,.62,.38,.58,.66,.45,.79,.96, .81,.88,.62],
    encoreStart: 13,
    vibeLabel: 'high-energy · upbeat · danceable',
    priming: 'You played 6 No Doubt tracks in the 4 hours before the show.',
    libraryHave: 11,
    libraryTotal: 16,
    discovered: [
      { title:'New',         artist:'No Doubt', year:2003, length:'4:25' },
      { title:'Settle Down', artist:'No Doubt', year:1995, length:'4:22' },
      { title:'Excuse Me Mr.', artist:'No Doubt', year:1995, length:'3:04' },
    ],
    setLength: '1h 47m 22s on stage',
  },
};

// Helpers shared across viewports
window.SB_OK = window.SB || null;
