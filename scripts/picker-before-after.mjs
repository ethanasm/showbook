#!/usr/bin/env node
/**
 * For each of the curated Bay Area venues, resolve Google Places photos,
 * apply both the old picker (photos[0]) and the new picker
 * (pickBestPhotoName from packages/api/src/google-places.ts), download
 * both image bytes, and save side-by-side compositing input to
 * tmp/venue-picker-ba/.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=... node scripts/picker-before-after.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!KEY) {
  console.error('Set GOOGLE_PLACES_API_KEY before running');
  process.exit(1);
}

const OUT = 'tmp/venue-picker-ba';
const MAX_WIDTH = 1600;

const VENUES = [
  { name: 'The Fillmore', city: 'San Francisco' },
  { name: 'The Warfield', city: 'San Francisco' },
  { name: 'Great American Music Hall', city: 'San Francisco' },
  { name: 'Bill Graham Civic Auditorium', city: 'San Francisco' },
  { name: 'The Masonic', city: 'San Francisco' },
  { name: 'Castro Theatre', city: 'San Francisco' },
  { name: 'Chase Center', city: 'San Francisco' },
  { name: 'Fox Theater', city: 'Oakland' },
  { name: 'Paramount Theatre', city: 'Oakland' },
  { name: "Yoshi's", city: 'Oakland' },
];

const BASE = 'https://places.googleapis.com/v1';

// Inline copy of pickBestPhotoName from packages/api/src/google-places.ts.
function pickBestPhotoName(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const MIN_RATIO = 1.3;
  const MIN_W = 1600;
  for (const p of photos.slice(0, 5)) {
    const name = p?.name;
    const w = Number(p?.widthPx);
    const h = Number(p?.heightPx);
    if (!name || !Number.isFinite(w) || !Number.isFinite(h) || h <= 0) continue;
    if (w / h >= MIN_RATIO && w >= MIN_W) return name;
  }
  return photos[0]?.name ?? null;
}

async function resolvePlaceId(name, city) {
  const r = await fetch(`${BASE}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY },
    body: JSON.stringify({ input: `${name} ${city}` }),
  });
  if (!r.ok) throw new Error(`autocomplete ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.suggestions?.[0]?.placePrediction?.placeId ?? null;
}

async function fetchPhotos(placeId) {
  const r = await fetch(`${BASE}/places/${placeId}?languageCode=en`, {
    headers: {
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'displayName,photos',
    },
  });
  if (!r.ok) throw new Error(`details ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { displayName: j.displayName?.text ?? '', photos: j.photos ?? [] };
}

async function downloadPhoto(photoName, outPath) {
  const url = `${BASE}/${photoName}/media?maxWidthPx=${MAX_WIDTH}&key=${encodeURIComponent(KEY)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`media ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(outPath, buf);
  return buf.byteLength;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

await mkdir(OUT, { recursive: true });

const rows = [];
for (const v of VENUES) {
  try {
    const placeId = await resolvePlaceId(v.name, v.city);
    if (!placeId) {
      console.log(`SKIP ${v.name}: no placeId`);
      continue;
    }
    const { displayName, photos } = await fetchPhotos(placeId);
    if (!photos.length) {
      console.log(`SKIP ${v.name}: no photos`);
      continue;
    }
    const oldName = photos[0].name;
    const newName = pickBestPhotoName(photos);
    const oldIdx = 0;
    const newIdx = photos.findIndex((p) => p.name === newName);
    const oldDims = `${photos[0].widthPx}x${photos[0].heightPx}`;
    const newDims = `${photos[newIdx].widthPx}x${photos[newIdx].heightPx}`;
    const sl = slug(v.name);
    const beforeFile = `${sl}-before.jpg`;
    const afterFile = `${sl}-after.jpg`;
    await downloadPhoto(oldName, join(OUT, beforeFile));
    if (newIdx !== oldIdx) await downloadPhoto(newName, join(OUT, afterFile));
    const changed = newIdx !== oldIdx;
    rows.push({
      name: displayName || v.name,
      slug: sl,
      changed,
      oldIdx,
      newIdx,
      oldDims,
      newDims,
      beforeFile,
      afterFile: changed ? afterFile : beforeFile,
    });
    console.log(
      `${changed ? 'CHANGED' : 'same   '} ${v.name.padEnd(32)} old=#${oldIdx} ${oldDims}  new=#${newIdx} ${newDims}`,
    );
  } catch (err) {
    console.error(`FAIL ${v.name}:`, err.message);
  }
}

await writeFile(join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
console.log(`\nWrote ${rows.length} venues to ${OUT}/`);
