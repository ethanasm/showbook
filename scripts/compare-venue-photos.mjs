#!/usr/bin/env node
/**
 * Compare Ticketmaster venue images vs Google Places photos for a curated
 * list of Bay Area venues. Writes an HTML report with side-by-side images
 * (including Places photos[0..4] so we can see if our current "photos[0]"
 * picker is what's bad, or if Places as a source is just worse).
 *
 * Usage:
 *   TICKETMASTER_API_KEY=... GOOGLE_PLACES_API_KEY=... \
 *     node scripts/compare-venue-photos.mjs
 *
 * Output:
 *   tmp/venue-photo-compare/index.html  — open in a browser
 *   tmp/venue-photo-compare/*.jpg       — saved image bytes (so the report
 *                                          is standalone, no API keys in
 *                                          the HTML, safe to share)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TM_KEY = process.env.TICKETMASTER_API_KEY;
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!TM_KEY || !PLACES_KEY) {
  console.error(
    'Set TICKETMASTER_API_KEY and GOOGLE_PLACES_API_KEY before running',
  );
  process.exit(1);
}

const OUT_DIR = 'tmp/venue-photo-compare';
const PLACES_PHOTO_COUNT = 5; // how many Places photos to compare per venue
const MAX_WIDTH = 1200;

// Curated list — well-known venues across SF, Oakland, San Jose. Mix of
// theatre, music, arena so we see source quality across categories.
const VENUES = [
  // San Francisco
  { name: 'The Fillmore', city: 'San Francisco', state: 'CA' },
  { name: 'Bill Graham Civic Auditorium', city: 'San Francisco', state: 'CA' },
  { name: 'The Warfield', city: 'San Francisco', state: 'CA' },
  { name: 'Great American Music Hall', city: 'San Francisco', state: 'CA' },
  { name: 'The Independent', city: 'San Francisco', state: 'CA' },
  { name: 'Chase Center', city: 'San Francisco', state: 'CA' },
  { name: 'The Masonic', city: 'San Francisco', state: 'CA' },
  { name: 'Castro Theatre', city: 'San Francisco', state: 'CA' },
  // Oakland
  { name: 'Fox Theater', city: 'Oakland', state: 'CA' },
  { name: 'Paramount Theatre', city: 'Oakland', state: 'CA' },
  { name: 'Oakland Arena', city: 'Oakland', state: 'CA' },
  { name: "Yoshi's", city: 'Oakland', state: 'CA' },
  // San Jose
  { name: 'SAP Center', city: 'San Jose', state: 'CA' },
  { name: 'San Jose Civic', city: 'San Jose', state: 'CA' },
  { name: 'City National Civic', city: 'San Jose', state: 'CA' },
];

// ---------------------------------------------------------------------------
// Ticketmaster
// ---------------------------------------------------------------------------

async function findTmVenue({ name, city, state }) {
  const url = new URL('https://app.ticketmaster.com/discovery/v2/venues.json');
  url.searchParams.set('apikey', TM_KEY);
  url.searchParams.set('keyword', name);
  url.searchParams.set('stateCode', state);
  url.searchParams.set('size', '10');
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = await res.json();
  const venues = data?._embedded?.venues ?? [];
  // Prefer exact city match, fall back to first result
  const cityNorm = city.toLowerCase();
  const exact = venues.find(
    (v) => v?.city?.name?.toLowerCase() === cityNorm,
  );
  return exact ?? venues[0] ?? null;
}

// Same logic as packages/api/src/ticketmaster.ts selectBestImage
function selectBestTmImage(images) {
  if (!images || images.length === 0) return null;
  const valid = images.filter((img) => !img.fallback);
  if (valid.length === 0) return null;
  const preferred = valid.filter((img) => img.ratio === '3_2');
  const pool = preferred.length > 0 ? preferred : valid;
  pool.sort((a, b) => b.width - a.width);
  return pool[0];
}

// ---------------------------------------------------------------------------
// Google Places
// ---------------------------------------------------------------------------

async function findPlace({ name, city }) {
  const res = await fetch(
    'https://places.googleapis.com/v1/places:autocomplete',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': PLACES_KEY,
      },
      body: JSON.stringify({
        input: `${name} ${city}`,
        includedPrimaryTypes: ['establishment'],
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const first = (data.suggestions ?? []).find((s) => s.placePrediction);
  return first?.placePrediction?.placeId ?? null;
}

async function getPlacePhotos(placeId) {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}?languageCode=en`,
    {
      headers: {
        'X-Goog-Api-Key': PLACES_KEY,
        'X-Goog-FieldMask': 'displayName,formattedAddress,photos',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!res.ok) return { name: null, photos: [] };
  const data = await res.json();
  return {
    name: data?.displayName?.text ?? null,
    photos: data?.photos ?? [],
  };
}

function placePhotoMediaUrl(photoResourceName) {
  return `https://places.googleapis.com/v1/${photoResourceName}/media?maxWidthPx=${MAX_WIDTH}&key=${encodeURIComponent(PLACES_KEY)}`;
}

// ---------------------------------------------------------------------------
// Image download
// ---------------------------------------------------------------------------

async function saveImage(url, filename) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(join(OUT_DIR, filename), buf);
    return filename;
  } catch (err) {
    console.error(`  ! failed to fetch ${filename}: ${err.message}`);
    return null;
  }
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function compareOne(venue, idx) {
  const label = `[${idx + 1}/${VENUES.length}] ${venue.name} (${venue.city})`;
  console.log(label);
  const slugBase = slug(`${venue.name}-${venue.city}`);

  const [tm, placeId] = await Promise.all([
    findTmVenue(venue).catch((e) => {
      console.error(`  ! TM lookup failed: ${e.message}`);
      return null;
    }),
    findPlace(venue).catch((e) => {
      console.error(`  ! Places lookup failed: ${e.message}`);
      return null;
    }),
  ]);

  const tmImage = selectBestTmImage(tm?.images);
  const placeData = placeId ? await getPlacePhotos(placeId) : { name: null, photos: [] };

  // Download TM image
  let tmFile = null;
  if (tmImage?.url) {
    tmFile = await saveImage(tmImage.url, `${slugBase}-tm.jpg`);
  }

  // Download top N Places photos
  const placeFiles = [];
  for (let i = 0; i < Math.min(PLACES_PHOTO_COUNT, placeData.photos.length); i++) {
    const p = placeData.photos[i];
    const mediaUrl = placePhotoMediaUrl(p.name);
    const file = await saveImage(mediaUrl, `${slugBase}-place-${i}.jpg`);
    placeFiles.push({
      file,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
      ratio: p.widthPx && p.heightPx ? (p.widthPx / p.heightPx).toFixed(2) : '?',
    });
  }

  return {
    venue,
    tm: tm
      ? {
          name: tm.name,
          city: tm.city?.name,
          imageFile: tmFile,
          ratio: tmImage?.ratio,
          width: tmImage?.width,
          height: tmImage?.height,
        }
      : null,
    place: placeId
      ? {
          name: placeData.name,
          placeId,
          photos: placeFiles,
        }
      : null,
  };
}

function renderHtml(results) {
  const total = results.length;
  const tmHit = results.filter((r) => r.tm?.imageFile).length;
  const placeHit = results.filter((r) => r.place?.photos.some((p) => p.file)).length;

  const rows = results.map((r, i) => {
    const v = r.venue;
    const tmCell = r.tm?.imageFile
      ? `<div class="cell"><img src="${r.tm.imageFile}" loading="lazy" /><div class="meta">TM · ${r.tm.ratio} · ${r.tm.width}×${r.tm.height}</div></div>`
      : `<div class="cell empty">no TM image</div>`;
    const placeCells = (r.place?.photos ?? [])
      .map((p, idx) =>
        p.file
          ? `<div class="cell"><img src="${p.file}" loading="lazy" /><div class="meta">Places[${idx}] · ${p.ratio} · ${p.widthPx}×${p.heightPx}</div></div>`
          : `<div class="cell empty">Places[${idx}] failed</div>`,
      )
      .join('');
    const placesEmpty = !r.place?.photos.length
      ? `<div class="cell empty">no Places photos</div>`
      : '';
    return `
      <section class="venue">
        <h2>${i + 1}. ${escapeHtml(v.name)} <span class="city">${escapeHtml(v.city)}</span></h2>
        <div class="row">
          ${tmCell}
          ${placeCells}
          ${placesEmpty}
        </div>
      </section>
    `;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Venue photo comparison — TM vs Google Places</title>
<style>
  body { background:#0a0a0b; color:#eaeaea; font:14px/1.4 system-ui,sans-serif; margin:24px; }
  h1 { font-size:18px; margin:0 0 8px; }
  .summary { color:#888; margin-bottom:24px; }
  .venue { margin-bottom:36px; }
  h2 { font-size:15px; margin:0 0 8px; font-weight:600; }
  h2 .city { color:#888; font-weight:400; margin-left:8px; }
  .row { display:grid; grid-template-columns: repeat(6, 1fr); gap:10px; }
  .cell { background:#141416; border:1px solid #232327; border-radius:6px; overflow:hidden; min-height:120px; display:flex; flex-direction:column; }
  .cell img { width:100%; aspect-ratio: 16/9; object-fit: cover; object-position: center 45%; display:block; }
  .cell .meta { padding:4px 6px; font-size:11px; color:#888; font-family:ui-monospace,monospace; }
  .cell.empty { color:#666; padding:12px; text-align:center; align-items:center; justify-content:center; font-style:italic; }
</style>
</head>
<body>
<h1>Venue photo comparison — TM vs Google Places</h1>
<div class="summary">
  ${total} venues · TM image found for ${tmHit} · Places photos found for ${placeHit} ·
  Images rendered in a 16:9 box matching the venue hero (object-position: center 45%)
</div>
${rows}
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

await mkdir(OUT_DIR, { recursive: true });

const results = [];
for (let i = 0; i < VENUES.length; i++) {
  results.push(await compareOne(VENUES[i], i));
}

const html = renderHtml(results);
await writeFile(join(OUT_DIR, 'index.html'), html);

console.log('');
console.log(`Wrote ${OUT_DIR}/index.html (${results.length} venues)`);
console.log(`Open in a browser to evaluate.`);
