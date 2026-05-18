// Upcoming — richer dataset for the Upcoming/Calendar page.
// "Today" = Mon Apr 20, 2026.
// Each show: kind, date{y,m,d,dow}, weekday offset (for calendar positioning),
// countdown, headliner, support, venue, city, seat/price, hasTix, src, onSale.

window.HIFI_UP_FULL = [
  {
    id:'u1', kind:'concert',
    date:{ y:2026, m:'APR', d:'26', dow:'SUN', iso:'2026-04-26' },
    countdown:'6 days',
    headliner:'Caroline Polachek',
    support:[],
    tour:'Desire, I Want To Turn Into You',
    venue:'Knockdown Center', neighborhood:'Maspeth', city:'Queens, NY',
    seat:'GA FLOOR', paid:92, hasTix:true,
    doors:'8:00 pm',
    src:'Ticketmaster',
  },
  {
    id:'u2', kind:'concert',
    date:{ y:2026, m:'MAY', d:'04', dow:'MON', iso:'2026-05-04' },
    countdown:'2 weeks',
    headliner:'Big Thief',
    support:['Madi Diaz'],
    tour:'Double Infinity Tour',
    venue:'Forest Hills Stadium', neighborhood:'Forest Hills', city:'Queens, NY',
    seat:'SEC 104 · 12', paid:78, hasTix:true,
    doors:'7:00 pm',
    src:'AXS',
  },
  {
    id:'u3', kind:'theatre',
    date:{ y:2026, m:'MAY', d:'12', dow:'TUE', iso:'2026-05-12' },
    countdown:'3 weeks',
    headliner:'Oh, Mary!',
    support:[],
    venue:'Lyceum Theatre', neighborhood:'Midtown', city:'New York, NY',
    seat:'ORCH H · 7', paid:145, hasTix:true,
    doors:'7:00 pm',
    src:'Telecharge',
  },
  {
    id:'u4', kind:'festival',
    date:{ y:2026, m:'MAY', d:'28', dow:'THU', iso:'2026-05-28' },
    countdown:'5 weeks',
    headliner:'Governors Ball',
    support:['Olivia Rodrigo','Tyler, The Creator','Hozier','+8 more'],
    venue:'Flushing Meadows', neighborhood:'Corona Park', city:'Queens, NY',
    hasTix:false,
    src:'watching',
    onSale:null,
  },
  {
    id:'u5', kind:'comedy',
    date:{ y:2026, m:'JUN', d:'07', dow:'SUN', iso:'2026-06-07' },
    countdown:'7 weeks',
    headliner:'Matt Rife',
    support:[],
    venue:'Beacon Theatre', neighborhood:'Upper West Side', city:'New York, NY',
    hasTix:false,
    src:'wishlist',
  },
  {
    id:'u6', kind:'theatre',
    date:{ y:2026, m:'JUN', d:'15', dow:'MON', iso:'2026-06-15' },
    countdown:'8 weeks',
    headliner:'& Juliet',
    support:[],
    venue:'Stephen Sondheim Theatre', neighborhood:'Midtown', city:'New York, NY',
    hasTix:false,
    src:'wishlist',
  },
  {
    id:'u7', kind:'concert',
    date:{ y:2026, m:'JUL', d:'12', dow:'SUN', iso:'2026-07-12' },
    countdown:'12 weeks',
    headliner:'Phoebe Bridgers',
    support:['Claud'],
    venue:'Forest Hills Stadium', neighborhood:'Forest Hills', city:'Queens, NY',
    seat:'SEC 201 · 4', paid:110, hasTix:true,
    doors:'7:00 pm',
    src:'Ticketmaster',
  },
  {
    id:'u8', kind:'concert',
    date:{ y:2026, m:'AUG', d:'03', dow:'MON', iso:'2026-08-03' },
    countdown:'15 weeks',
    headliner:'Hozier',
    support:[],
    tour:'Unreal Unearth Tour',
    venue:'Madison Square Garden', neighborhood:'Midtown', city:'New York, NY',
    hasTix:false,
    src:'on sale fri',
    onSale:'FRI APR 25',
  },
];

// Group by venue for the right-rail venue lens
window.HIFI_UP_BY_VENUE = (() => {
  const acc = {};
  window.HIFI_UP_FULL.forEach(s => {
    (acc[s.venue] = acc[s.venue] || { name:s.venue, neighborhood:s.neighborhood, shows:[] })
      .shows.push(s);
  });
  return Object.values(acc).sort((a,b)=>b.shows.length - a.shows.length);
})();

// Totals
window.HIFI_UP_TOTALS = (() => {
  const tix = window.HIFI_UP_FULL.filter(s=>s.hasTix);
  const watching = window.HIFI_UP_FULL.filter(s=>!s.hasTix);
  const next90 = window.HIFI_UP_FULL.filter(s => {
    // crude: all within range for demo
    const m = {APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9}[s.date.m];
    return m >= 4 && m <= 7; // through July
  });
  return {
    total: window.HIFI_UP_FULL.length,
    ticketed: tix.length,
    watching: watching.length,
    paid: tix.reduce((a,s)=>a+(s.paid||0),0),
    next90: next90.length,
  };
})();

// Calendar model — each month: name, year, firstDow (0=Sun), daysInMonth.
// Shows indexed by iso date.
window.HIFI_UP_CAL = (() => {
  const months = [
    { m:'APR', long:'April',     y:2026, firstDow:3, days:30 }, // Apr 1, 2026 = Wed (3)
    { m:'MAY', long:'May',       y:2026, firstDow:5, days:31 },
    { m:'JUN', long:'June',      y:2026, firstDow:1, days:30 },
    { m:'JUL', long:'July',      y:2026, firstDow:3, days:31 },
    { m:'AUG', long:'August',    y:2026, firstDow:6, days:31 },
  ];
  const byIso = {};
  window.HIFI_UP_FULL.forEach(s => {
    (byIso[s.date.iso] = byIso[s.date.iso] || []).push(s);
  });
  return { months, byIso };
})();
