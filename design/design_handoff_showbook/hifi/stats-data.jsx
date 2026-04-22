// Stats · year-in-review shared data.
// All-time across 8 years (since 2019). "Today" = APR 20, 2026.

window.STATS_TOTALS = {
  shows: 87,
  artists: 142,
  venues: 34,
  spent: '$7,482',
  years: 8,
  hoursLive: 198,
  miles: 2840,
};

// Per-year breakdown by kind
window.STATS_YEARS = [
  { y:'2019', c:12, f:1, b:2, co:1 },
  { y:'2020', c:0,  f:0, b:0, co:0 },
  { y:'2021', c:3,  f:0, b:1, co:1 },
  { y:'2022', c:11, f:1, b:1, co:1 },
  { y:'2023', c:7,  f:1, b:1, co:0 },
  { y:'2024', c:14, f:2, b:1, co:1 },
  { y:'2025', c:16, f:2, b:3, co:1 },
  { y:'2026', c:8,  f:0, b:3, co:3 },
];

window.STATS_VENUES = [
  { name:'Kings Theatre',        count:12, hood:'Flatbush',          city:'Brooklyn' },
  { name:'Brooklyn Steel',       count:8,  hood:'East Williamsburg', city:'Brooklyn' },
  { name:'Beacon Theatre',       count:6,  hood:'Upper West Side',   city:'Manhattan' },
  { name:'Madison Square Garden',count:5,  hood:'Midtown',           city:'Manhattan' },
  { name:'Forest Hills Stadium', count:4,  hood:'Forest Hills',      city:'Queens' },
  { name:'Radio City Music Hall',count:4,  hood:'Midtown',           city:'Manhattan' },
  { name:'Bowery Ballroom',      count:3,  hood:'Lower East Side',   city:'Manhattan' },
  { name:'Knockdown Center',     count:3,  hood:'Maspeth',           city:'Queens' },
];

window.STATS_ARTISTS = [
  { name:'Big Thief',        count:6, kind:'concert' },
  { name:'Mitski',           count:4, kind:'concert' },
  { name:'Fontaines D.C.',   count:3, kind:'concert' },
  { name:'Vampire Weekend',  count:3, kind:'concert' },
  { name:'Phoebe Bridgers',  count:3, kind:'concert' },
  { name:'John Mulaney',     count:2, kind:'comedy'  },
  { name:'Hadestown',        count:2, kind:'theatre'},
  { name:'Slowdive',         count:2, kind:'concert' },
];

window.STATS_KIND_TOTALS = [
  { k:'concert',  v:71 },
  { k:'theatre', v:12 },
  { k:'comedy',   v:8  },
  { k:'festival', v:7  },
];

window.STATS_SPEND = [
  { y:'2019', v:812  },
  { y:'2020', v:0    },
  { y:'2021', v:230  },
  { y:'2022', v:682  },
  { y:'2023', v:910  },
  { y:'2024', v:1140 },
  { y:'2025', v:2204 },
  { y:'2026', v:1504 }, // ytd
];

// Day-of-week distribution, Mon→Sun
window.STATS_DOW = [
  { d:'M', v:4  },
  { d:'T', v:6  },
  { d:'W', v:8  },
  { d:'T', v:11 },
  { d:'F', v:22 },
  { d:'S', v:24 },
  { d:'S', v:12 },
];

// Month distribution Jan→Dec (all-time)
window.STATS_MONTH = [5, 6, 8, 9, 10, 11, 5, 4, 9, 10, 6, 4];

// Superlatives for a year-in-review feel
window.STATS_SUPERLATIVES = [
  { label:'longest show',    value:'Springsteen',   detail:'3h 42m · MSG · 2024' },
  { label:'furthest',        value:'New Orleans',   detail:'Jazz Fest · 1,305 mi' },
  { label:'shortest notice', value:'Slowdive',      detail:'bought ticket 2h before' },
  { label:'most expensive',  value:'$340',          detail:'Hadestown · MEZZ C' },
  { label:'smallest room',   value:'Union Pool',    detail:'cap. 200 · sweating' },
  { label:'most repeat',     value:'Kings Theatre', detail:'12 visits · home base' },
];

window.STATS_STREAKS = {
  currentMonth: 4,     // shows this month
  longestStreak: 9,    // consecutive months with ≥1 show
  currentStreak: 4,
  droughtLongest: 14,  // 2020–2021
  genreSpread: 4,      // kinds attended
};
