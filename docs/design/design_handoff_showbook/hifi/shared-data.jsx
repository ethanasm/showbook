// Shared sample data for all three hi-fi home directions.
// Dates are past/future relative to "today" = APR 20, 2026.

window.HIFI_TODAY = 'Apr 20, 2026';

window.HIFI_KINDS = {
  concert:  { label: 'concert',  ink: '#C4412A', paper: '#F5E8D8' },
  theatre: { label: 'theatre', ink: '#7A1F2B', paper: '#EFE4E0' },
  comedy:   { label: 'comedy',   ink: '#C88514', paper: '#F4E9D1' },
  festival: { label: 'festival', ink: '#2D5F3F', paper: '#E3EAD8' },
};

// Past shows (most recent first)
window.HIFI_PAST = [
  {
    id:'p1', kind:'concert',
    date:{ y:2026, m:'APR', d:'04', dow:'SAT' },
    headliner:'Fontaines D.C.',
    support:['Been Stellar'],
    venue:'Kings Theatre', neighborhood:'Flatbush', city:'Brooklyn, NY',
    seat:'ORCH L · 14', paid:78,
    tour:'Romance World Tour',
    setlistCount:21, encore:true,
    coverHue:210,
  },
  {
    id:'p2', kind:'theatre',
    date:{ y:2026, m:'MAR', d:'22', dow:'SUN' },
    headliner:'Hadestown',
    support:[],
    venue:'Walter Kerr Theatre', neighborhood:'Midtown', city:'New York, NY',
    seat:'MEZZ C · 108', paid:148,
    tour:'Broadway · 2,100th performance',
    cast:['Betty Who', 'Lillias White'],
    coverHue:38,
  },
  {
    id:'p3', kind:'concert',
    date:{ y:2026, m:'MAR', d:'08', dow:'SUN' },
    headliner:'Mitski',
    support:['Julia Jacklin'],
    venue:'Radio City Music Hall', neighborhood:'Midtown', city:'New York, NY',
    seat:'ORCH 2 · H 9', paid:120,
    tour:'The Land Is Inhospitable Tour',
    setlistCount:23,
    coverHue:350,
  },
  {
    id:'p4', kind:'comedy',
    date:{ y:2026, m:'FEB', d:'14', dow:'SAT' },
    headliner:'John Mulaney',
    support:[],
    venue:'Beacon Theatre', neighborhood:'Upper West Side', city:'New York, NY',
    seat:'ORCH B · 4', paid:95,
    tour:'From Scratch',
    coverHue:22,
  },
  {
    id:'p5', kind:'concert',
    date:{ y:2026, m:'FEB', d:'01', dow:'SUN' },
    headliner:'Slowdive',
    support:['Drab Majesty'],
    venue:'Brooklyn Steel', neighborhood:'East Williamsburg', city:'Brooklyn, NY',
    seat:'GA FLOOR',
    paid:65,
    tour:'everything is alive',
    setlistCount:14,
    coverHue:270,
  },
];

// Upcoming (nearest first)
window.HIFI_UPCOMING = [
  {
    id:'u1', kind:'concert',
    date:{ y:2026, m:'APR', d:'26', dow:'SUN' },
    countdown:'in 6 days',
    headliner:'Caroline Polachek',
    support:[],
    venue:'Knockdown Center', city:'Queens, NY',
    seat:'GA', paid:92, hasTix:true,
    coverHue:300,
  },
  {
    id:'u2', kind:'concert',
    date:{ y:2026, m:'MAY', d:'04', dow:'MON' },
    countdown:'in 2 weeks',
    headliner:'Big Thief',
    support:['Madi Diaz'],
    venue:'Forest Hills Stadium', city:'Queens, NY',
    seat:'SEC 104 · 12', paid:78, hasTix:true,
    coverHue:140,
  },
  {
    id:'u3', kind:'theatre',
    date:{ y:2026, m:'MAY', d:'12', dow:'TUE' },
    countdown:'in 3 weeks',
    headliner:'Oh, Mary!',
    support:[],
    venue:'Lyceum Theatre', city:'New York, NY',
    seat:'ORCH H · 7', paid:145, hasTix:true,
    coverHue:345,
  },
  {
    id:'u4', kind:'festival',
    date:{ y:2026, m:'MAY', d:'28', dow:'THU' },
    countdown:'in 5 weeks',
    headliner:'Governors Ball',
    support:['Olivia Rodrigo','Tyler, The Creator','+8 more'],
    venue:'Flushing Meadows', city:'Queens, NY',
    hasTix:false,
    coverHue:120,
  },
];

// Year rhythm · attended vs have-tix, by month (J..D)
window.HIFI_RHYTHM = [
  // {attended, tickets}
  {a:2, t:0}, {a:1, t:0}, {a:3, t:0}, {a:2, t:1}, // J F M A (A partial)
  {a:0, t:3}, {a:0, t:1}, {a:0, t:0}, {a:0, t:0}, // M J J A
  {a:0, t:0}, {a:0, t:0}, {a:0, t:0}, {a:0, t:0}, // S O N D
];

window.HIFI_TOTALS = {
  shows:14, spent:'$1,284', venues:9, artists:22,
};
