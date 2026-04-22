// Shared data for map view — NYC-centric venue pins + per-venue show log.
// Coordinates are positioned on a hand-drawn NYC outline (viewBox 0 0 500 400).
// Bigger dot = more visits.

window.HIFI_MAP_PINS = [
  // Brooklyn
  { id:'kings',    label:'Kings Theatre',        nbhd:'Flatbush',         x:315, y:240, count:12, kindMix:['concert'],            selected:true },
  { id:'bk-steel', label:'Brooklyn Steel',       nbhd:'East Williamsburg',x:290, y:195, count:8,  kindMix:['concert'] },
  { id:'warsaw',   label:'Warsaw',               nbhd:'Greenpoint',       x:280, y:170, count:3,  kindMix:['concert'] },
  { id:'bellhouse',label:'The Bell House',       nbhd:'Gowanus',          x:275, y:225, count:3,  kindMix:['comedy','concert'] },
  { id:'baam',     label:'BAM Harvey',           nbhd:'Fort Greene',      x:288, y:215, count:2,  kindMix:['theatre'] },

  // Manhattan — midtown cluster
  { id:'msg',      label:'Madison Square Garden',nbhd:'Midtown',          x:248, y:170, count:5,  kindMix:['concert'] },
  { id:'radio',    label:'Radio City Music Hall',nbhd:'Midtown',          x:254, y:160, count:7,  kindMix:['concert','comedy'] },
  { id:'beacon',   label:'Beacon Theatre',       nbhd:'Upper West Side',  x:245, y:145, count:6,  kindMix:['comedy','concert'] },
  { id:'walterkerr',label:'Walter Kerr Theatre', nbhd:'Theatre District', x:258, y:163, count:4,  kindMix:['theatre'] },
  { id:'lyceum',   label:'Lyceum Theatre',       nbhd:'Theatre District', x:261, y:166, count:3,  kindMix:['theatre'] },
  { id:'webster',  label:'Webster Hall',         nbhd:'East Village',     x:262, y:182, count:4,  kindMix:['concert'] },
  { id:'bowery',   label:'Bowery Ballroom',      nbhd:'LES',              x:265, y:188, count:3,  kindMix:['concert'] },
  { id:'village',  label:'Village Vanguard',     nbhd:'West Village',     x:252, y:185, count:2,  kindMix:['concert'] },

  // Queens
  { id:'knockdown',label:'Knockdown Center',     nbhd:'Maspeth',          x:320, y:175, count:4,  kindMix:['concert'] },
  { id:'foresthills',label:'Forest Hills Stadium',nbhd:'Forest Hills',    x:355, y:200, count:3,  kindMix:['concert'] },
  { id:'flushing', label:'Flushing Meadows',     nbhd:'Corona Park',      x:380, y:175, count:2,  kindMix:['festival'] },

  // Uptown + Bronx
  { id:'apollo',   label:'Apollo Theater',       nbhd:'Harlem',           x:232, y:120, count:2,  kindMix:['concert'] },
  { id:'unitedpalace',label:'United Palace',     nbhd:'Washington Heights',x:218,y:92,  count:1,  kindMix:['concert'] },

  // Out of town
  { id:'930',      label:'9:30 Club',            nbhd:'Washington DC',    x:120, y:340, count:2,  kindMix:['concert'] },
  { id:'fenway',   label:'MGM Music Hall',       nbhd:'Boston MA',        x:100, y:95,  count:1,  kindMix:['concert'] },
  { id:'uniont',   label:'Union Transfer',       nbhd:'Philadelphia PA',  x:110, y:260, count:1,  kindMix:['concert'] },
];

// Kings Theatre visit log — shown in the inspector.
window.HIFI_MAP_KINGS = [
  { d:{y:2026,m:'APR',day:'04'}, artist:'Fontaines D.C.',       kind:'concert', seat:'ORCH L · 14', paid:78 },
  { d:{y:2025,m:'OCT',day:'11'}, artist:'Japanese Breakfast',   kind:'concert', seat:'MEZZ A · 22', paid:62 },
  { d:{y:2025,m:'JUN',day:'02'}, artist:'Alvvays',              kind:'concert', seat:'ORCH K · 8',  paid:58 },
  { d:{y:2024,m:'OCT',day:'14'}, artist:'Big Thief',            kind:'concert', seat:'MEZZ B · 14', paid:72 },
  { d:{y:2024,m:'APR',day:'22'}, artist:'Waxahatchee',          kind:'concert', seat:'ORCH P · 3',  paid:54 },
  { d:{y:2023,m:'DEC',day:'18'}, artist:'Bright Eyes',          kind:'concert', seat:'ORCH G · 12', paid:68 },
  { d:{y:2023,m:'SEP',day:'09'}, artist:'Wilco',                kind:'concert', seat:'MEZZ C · 5',  paid:82 },
  { d:{y:2023,m:'APR',day:'30'}, artist:'black midi',           kind:'concert', seat:'ORCH R · 18', paid:44 },
  { d:{y:2022,m:'NOV',day:'06'}, artist:'Phoebe Bridgers',      kind:'concert', seat:'MEZZ A · 9',  paid:75 },
  { d:{y:2022,m:'JUN',day:'24'}, artist:'Mitski',               kind:'concert', seat:'ORCH H · 16', paid:65 },
  { d:{y:2021,m:'OCT',day:'02'}, artist:'The National',         kind:'concert', seat:'ORCH J · 4',  paid:88 },
  { d:{y:2019,m:'MAR',day:'16'}, artist:'Sharon Van Etten',     kind:'concert', seat:'ORCH M · 11', paid:48 },
];

window.HIFI_MAP_TOTALS = {
  venues: 24,
  shows: 87,
  cities: 4,
  primary: 'NYC',
};
