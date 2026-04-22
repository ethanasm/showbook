// Shared sample data for all three hi-fi home directions.
// Dates are past/future relative to "today" = APR 20, 2026.

window.HIFI_TODAY = 'Apr 20, 2026';

window.HIFI_KINDS = {
  concert:  { label: 'concert',  ink: '#C4412A', paper: '#F5E8D8' },
  theatre: { label: 'theatre', ink: '#7A1F2B', paper: '#EFE4E0' },
  comedy:   { label: 'comedy',   ink: '#C88514', paper: '#F4E9D1' },
  festival: { label: 'festival', ink: '#2D5F3F', paper: '#E3EAD8' },
};

// Every show has a derived `state`:
//   past     — already happened
//   tix      — future + user has tickets
//   watching — future + on watchlist, no tickets yet

// Past shows (most recent first) — all `state:'past'`
window.HIFI_PAST = [
  {
    id:'p1', kind:'concert', state:'past',
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
    id:'p2', kind:'theatre', state:'past',
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
    id:'p3', kind:'concert', state:'past',
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
    id:'p4', kind:'comedy', state:'past',
    date:{ y:2026, m:'FEB', d:'14', dow:'SAT' },
    headliner:'John Mulaney',
    support:[],
    venue:'Beacon Theatre', neighborhood:'Upper West Side', city:'New York, NY',
    seat:'ORCH B · 4', paid:95,
    tour:'From Scratch',
    coverHue:22,
  },
  {
    id:'p5', kind:'concert', state:'past',
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

// Upcoming (nearest first) — each has state `tix` or `watching`
window.HIFI_UPCOMING = [
  {
    id:'u1', kind:'concert', state:'tix',
    date:{ y:2026, m:'APR', d:'26', dow:'SUN' },
    countdown:'in 6 days',
    headliner:'Caroline Polachek',
    support:[],
    venue:'Knockdown Center', city:'Queens, NY',
    seat:'GA', paid:92, hasTix:true,
    coverHue:300,
  },
  {
    id:'u2', kind:'concert', state:'tix',
    date:{ y:2026, m:'MAY', d:'04', dow:'MON' },
    countdown:'in 2 weeks',
    headliner:'Big Thief',
    support:['Madi Diaz'],
    venue:'Forest Hills Stadium', city:'Queens, NY',
    seat:'SEC 104 · 12', paid:78, hasTix:true,
    coverHue:140,
  },
  {
    id:'u3', kind:'theatre', state:'tix',
    date:{ y:2026, m:'MAY', d:'12', dow:'TUE' },
    countdown:'in 3 weeks',
    headliner:'Oh, Mary!',
    support:[],
    venue:'Lyceum Theatre', city:'New York, NY',
    seat:'ORCH H · 7', paid:145, hasTix:true,
    coverHue:345,
  },
  {
    id:'u4', kind:'festival', state:'watching',
    date:{ y:2026, m:'MAY', d:'28', dow:'THU' },
    countdown:'in 5 weeks',
    headliner:'Governors Ball',
    support:['Olivia Rodrigo','Tyler, The Creator','+8 more'],
    venue:'Flushing Meadows', city:'Queens, NY',
    hasTix:false,
    coverHue:120,
  },
];

// Watchlist — future shows the user is watching (no tickets yet).
// These render alongside `tix` items in the Shows list.
window.HIFI_WATCHING = [
  {
    id:'w1', kind:'concert', state:'watching',
    date:{ y:2026, m:'JUN', d:'07', dow:'SUN' },
    countdown:'in 7 weeks',
    headliner:'Yo La Tengo',
    support:[],
    venue:'Music Hall of Williamsburg', city:'Brooklyn, NY',
    hasTix:false,
  },
  {
    id:'w2', kind:'comedy', state:'watching',
    date:{ y:2026, m:'JUN', d:'19', dow:'FRI' },
    countdown:'in 9 weeks',
    headliner:'Nikki Glaser',
    support:[],
    venue:'Beacon Theatre', city:'New York, NY',
    hasTix:false,
  },
  {
    id:'w3', kind:'concert', state:'watching',
    date:{ y:2027, m:'FEB', d:'14', dow:'SUN' },
    countdown:'next year',
    headliner:'Wednesday',
    support:[],
    venue:'Bowery Ballroom', city:'New York, NY',
    hasTix:false,
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

// ─── Discover feed · announcements ──────────────────────────────
// These are venue/artist drops the user hasn't acted on yet.
// `reason` says why it surfaced; `watchlisted:true` promotes it to the
// Shows list with state `watching`.
// Followed venues user cares about — shown as filter chips in Discover.
window.HIFI_FOLLOWED_VENUES = [
  { id:'bk-steel',    name:'Brooklyn Steel',         nbhd:'East Williamsburg' },
  { id:'kings',       name:'Kings Theatre',          nbhd:'Flatbush' },
  { id:'knockdown',   name:'Knockdown Center',       nbhd:'Maspeth' },
  { id:'beacon',      name:'Beacon Theatre',         nbhd:'Upper West Side' },
  { id:'walterkerr',  name:'Walter Kerr Theatre',    nbhd:'Theatre District' },
  { id:'foresthills', name:'Forest Hills Stadium',   nbhd:'Forest Hills' },
];

// Helper to keep the list compact.
const _ann = (id, venueId, venue, venueNbhd, kind, headliner, support, y, m, d, dow, onSaleDate, status, reason, discoveredAt, extra={}) => ({
  id, venueId, venue, venueNbhd, kind, headliner, support,
  showDate:{y,m,d,dow}, onSaleDate, status, watchlisted:false, reason, discoveredAt, ...extra,
});

window.HIFI_ANNOUNCEMENTS = [
  // ── Brooklyn Steel (followed) — 9 upcoming
  _ann('a1',  'bk-steel','Brooklyn Steel','East Williamsburg','concert','Japanese Breakfast',['Ratboys'],       2026,'JUL','18','SAT','Apr 25 · 10am','announced','followed-venue','2h ago'),
  _ann('a1b', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','IDLES',['LAMBRINI GIRLS'],             2026,'SEP','12','SAT','Apr 26 · 10am','announced','followed-venue','2h ago'),
  _ann('a1c', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','Turnstile',[],                          2026,'OCT','03','SAT','May 02 · 10am','announced','followed-venue','1 day ago'),
  _ann('a1d', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','Mannequin Pussy',['Soul Glo'],          2026,'NOV','15','SUN','May 09 · 10am','announced','followed-venue','1 day ago'),
  _ann('a1e', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','Snail Mail',['Hotline TNT'],            2026,'DEC','05','SAT','on sale now','on-sale','followed-venue','3 days ago'),
  _ann('a1f', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','Alvvays',[],                            2027,'JAN','24','SAT','Jun 06 · 10am','announced','followed-venue','3 days ago'),
  _ann('a1g', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','DIIV',['Wishy'],                        2027,'FEB','19','FRI','Jun 13 · 10am','announced','followed-venue','4 days ago'),
  _ann('a1h', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','Fontaines D.C.',[],                     2027,'MAR','06','SAT','Jul 11 · 10am','announced','followed-venue','5 days ago'),
  _ann('a1i', 'bk-steel','Brooklyn Steel','East Williamsburg','concert','Sprints',['Been Stellar'],              2027,'APR','10','SAT','Aug 01 · 10am','announced','followed-venue','1 week ago'),

  // ── Kings Theatre (followed) — 8 upcoming
  _ann('a2',  'kings','Kings Theatre','Flatbush','concert','Waxahatchee',['MJ Lenderman'],                       2026,'AUG','02','SUN','May 03 · 10am','announced','followed-venue','5h ago'),
  _ann('a2b', 'kings','Kings Theatre','Flatbush','concert','Father John Misty',[],                               2026,'SEP','19','SAT','Apr 28 · 10am','announced','followed-venue','1 day ago'),
  _ann('a2c', 'kings','Kings Theatre','Flatbush','comedy','Tig Notaro',[],                                       2026,'OCT','04','SUN','on sale now','on-sale','followed-venue','2 days ago'),
  _ann('a2d', 'kings','Kings Theatre','Flatbush','concert','Angel Olsen',[],                                     2026,'OCT','28','WED','May 16 · 10am','announced','followed-venue','3 days ago'),
  _ann('a2e', 'kings','Kings Theatre','Flatbush','concert','Sharon Van Etten',['+ guest'],                       2026,'NOV','22','SUN','May 23 · 10am','announced','followed-venue','4 days ago'),
  _ann('a2f', 'kings','Kings Theatre','Flatbush','concert','The National',[],                                    2027,'FEB','06','SAT','Jun 20 · 10am','announced','followed-venue','6 days ago'),
  _ann('a2g', 'kings','Kings Theatre','Flatbush','concert','Sufjan Stevens',['orchestra'],                       2027,'MAR','20','SAT','Jul 18 · 10am','announced','followed-venue','1 week ago'),
  _ann('a2h', 'kings','Kings Theatre','Flatbush','comedy','John Mulaney',[],                                     2027,'APR','17','SAT','Aug 15 · 10am','announced','followed-venue','1 week ago'),

  // ── Knockdown Center (followed) — 6 upcoming
  _ann('a3',  'knockdown','Knockdown Center','Maspeth','festival','Sustain-Release 2026',['weekend pass · 3 days'], 2026,'SEP','11','FRI','Jun 01 · noon','on-sale','followed-venue','yesterday'),
  _ann('a3b', 'knockdown','Knockdown Center','Maspeth','concert','DJ Seinfeld',[],                                  2026,'JUL','26','SUN','on sale now','on-sale','followed-venue','1 day ago'),
  _ann('a3c', 'knockdown','Knockdown Center','Maspeth','concert','Caroline Polachek',[],                            2026,'AUG','14','FRI','May 09 · noon','announced','followed-venue','2 days ago'),
  _ann('a3d', 'knockdown','Knockdown Center','Maspeth','concert','Yaeji',['DJ Python'],                             2026,'OCT','10','SAT','May 30 · noon','announced','followed-venue','3 days ago'),
  _ann('a3e', 'knockdown','Knockdown Center','Maspeth','festival','Sustain-Release 2027',['weekend pass'],          2027,'SEP','10','FRI','Jun 05 · noon','announced','followed-venue','1 week ago'),
  _ann('a3f', 'knockdown','Knockdown Center','Maspeth','concert','Arca',[],                                         2027,'JAN','30','SAT','Aug 22 · noon','announced','followed-venue','1 week ago'),

  // ── Beacon Theatre (followed) — 7 upcoming
  _ann('a4',  'beacon','Beacon Theatre','Upper West Side','comedy','Maria Bamford',[],                              2026,'JUN','28','SUN','Apr 22 · 10am','announced','followed-venue','yesterday'),
  _ann('a4b', 'beacon','Beacon Theatre','Upper West Side','comedy','Nikki Glaser',[],                               2026,'AUG','19','WED','on sale now','on-sale','followed-venue','1 day ago'),
  _ann('a4c', 'beacon','Beacon Theatre','Upper West Side','concert','Jeff Tweedy',['solo'],                         2026,'SEP','26','SAT','May 02 · 10am','announced','followed-venue','2 days ago'),
  _ann('a4d', 'beacon','Beacon Theatre','Upper West Side','comedy','Hannibal Buress',[],                            2026,'OCT','17','SAT','May 14 · 10am','announced','followed-venue','3 days ago'),
  _ann('a4e', 'beacon','Beacon Theatre','Upper West Side','concert','Andrew Bird',['string quartet'],               2026,'DEC','12','SAT','Jun 04 · 10am','announced','followed-venue','5 days ago'),
  _ann('a4f', 'beacon','Beacon Theatre','Upper West Side','comedy','Jerrod Carmichael',[],                          2027,'FEB','13','SAT','Jun 27 · 10am','announced','followed-venue','1 week ago'),
  _ann('a4g', 'beacon','Beacon Theatre','Upper West Side','concert','Fleet Foxes',[],                               2027,'MAR','27','SAT','Jul 25 · 10am','announced','followed-venue','1 week ago'),

  // ── Walter Kerr Theatre (followed) — 4 upcoming
  _ann('a5',  'walterkerr','Walter Kerr Theatre','Theatre District','theatre','Hadestown',['new cast · Reeve Carney returning'], 2026,'OCT','14','WED','on sale now','on-sale','followed-venue','2 days ago'),
  _ann('a5b', 'walterkerr','Walter Kerr Theatre','Theatre District','theatre','Hadestown',['matinee block'],                     2026,'NOV','21','SAT','on sale now','on-sale','followed-venue','3 days ago'),
  _ann('a5c', 'walterkerr','Walter Kerr Theatre','Theatre District','theatre','Maybe Happy Ending',['press opening'],            2027,'JAN','16','SAT','Jul 09 · 10am','announced','followed-venue','1 week ago'),
  _ann('a5d', 'walterkerr','Walter Kerr Theatre','Theatre District','theatre','Maybe Happy Ending',[],                           2027,'FEB','27','SAT','Jul 09 · 10am','announced','followed-venue','1 week ago'),

  // ── Forest Hills Stadium (followed) — 5 upcoming
  _ann('a6',  'foresthills','Forest Hills Stadium','Forest Hills','concert','Big Thief',['+ guest TBA'],            2026,'SEP','05','SAT','Apr 24 · 10am','announced','followed-venue','3 days ago'),
  _ann('a6b', 'foresthills','Forest Hills Stadium','Forest Hills','concert','The War on Drugs',['Lucinda Williams'], 2026,'JUN','20','SAT','on sale now','on-sale','followed-venue','2 days ago'),
  _ann('a6c', 'foresthills','Forest Hills Stadium','Forest Hills','concert','Vampire Weekend',[],                   2026,'JUL','25','SAT','May 16 · 10am','announced','followed-venue','4 days ago'),
  _ann('a6d', 'foresthills','Forest Hills Stadium','Forest Hills','concert','Weezer',['Dinosaur Jr.'],              2026,'AUG','08','SAT','May 23 · 10am','announced','followed-venue','5 days ago'),
  _ann('a6e', 'foresthills','Forest Hills Stadium','Forest Hills','concert','Hozier',[],                            2027,'MAY','15','SAT','Sep 12 · 10am','announced','followed-venue','1 week ago'),

  // ── Near-you (not followed) — 10 items
  _ann('a7',  'warsaw','Warsaw','Greenpoint','concert','Faye Webster',['Indigo De Souza'],                          2026,'JUN','22','MON','Apr 26 · 10am','announced','nearby','3h ago'),
  _ann('a8',  'bowery','Bowery Ballroom','Lower East Side','concert','Horsegirl',['Lifeguard'],                     2026,'MAY','30','SAT','on sale now','on-sale','nearby','1 day ago'),
  _ann('a9',  'webster','Webster Hall','East Village','concert','Geese',[],                                         2026,'JUL','11','SAT','May 02 · 10am','announced','nearby','2 days ago'),
  _ann('a10', 'bellhouse','The Bell House','Gowanus','comedy','Catherine Cohen',[],                                 2026,'JUN','14','SUN','on sale now','on-sale','nearby','4 days ago'),
  _ann('a11', 'elsewhere','Elsewhere','Bushwick','concert','Jessica Pratt',[],                                      2026,'JUL','02','THU','Apr 29 · noon','announced','nearby','4h ago'),
  _ann('a12', 'pianos','Pianos','Lower East Side','concert','Been Stellar',[],                                      2026,'JUN','06','SAT','on sale now','on-sale','nearby','1 day ago'),
  _ann('a13', 'bklynsteel2','Music Hall of Williamsburg','Williamsburg','concert','Wednesday',[],                   2026,'AUG','22','SAT','May 06 · 10am','announced','nearby','2 days ago'),
  _ann('a14', 'villagevan','Village Vanguard','West Village','concert','Brad Mehldau Trio',[],                       2026,'MAY','26','TUE','on sale now','on-sale','nearby','2 days ago'),
  _ann('a15', 'sony','Sony Hall','Midtown','concert','Aldous Harding',[],                                            2026,'SEP','08','TUE','May 09 · 10am','announced','nearby','3 days ago'),
  _ann('a16', 'littlefield','Littlefield','Gowanus','comedy','Sam Jay',[],                                           2026,'JUN','05','FRI','on sale now','on-sale','nearby','5 days ago'),
];
