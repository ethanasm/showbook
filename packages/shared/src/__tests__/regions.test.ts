import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  regionBbox,
  isPointInRegion,
  isPointInAnyRegion,
} from '../utils/regions';

const SF = { latitude: 37.7749, longitude: -122.4194, radiusMiles: 25 };
const NYC = { latitude: 40.7128, longitude: -74.006, radiusMiles: 25 };

test('regionBbox centres the box on the region and expands by radius', () => {
  const bbox = regionBbox(SF);
  // 25mi ≈ 0.362° latitude. Just sanity-check bounds straddle the centre.
  assert.ok(bbox.minLat < SF.latitude);
  assert.ok(bbox.maxLat > SF.latitude);
  assert.ok(bbox.minLng < SF.longitude);
  assert.ok(bbox.maxLng > SF.longitude);
});

test('isPointInRegion: point at centre is inside', () => {
  assert.equal(isPointInRegion(SF.latitude, SF.longitude, SF), true);
});

test('isPointInRegion: point far away is outside', () => {
  assert.equal(isPointInRegion(NYC.latitude, NYC.longitude, SF), false);
});

test('isPointInRegion: just inside the radius is inside, just outside is outside', () => {
  // ~24mi north of centre = inside
  assert.equal(
    isPointInRegion(SF.latitude + 0.34, SF.longitude, SF),
    true,
  );
  // ~30mi north of centre = outside
  assert.equal(
    isPointInRegion(SF.latitude + 0.45, SF.longitude, SF),
    false,
  );
});

test('isPointInAnyRegion: matches any region in the list', () => {
  assert.equal(isPointInAnyRegion(NYC.latitude, NYC.longitude, [SF, NYC]), true);
  assert.equal(
    isPointInAnyRegion(SF.latitude, SF.longitude, [SF, NYC]),
    true,
  );
  // Cleveland is in neither
  assert.equal(isPointInAnyRegion(41.4993, -81.6944, [SF, NYC]), false);
});

test('isPointInAnyRegion: empty regions list returns false', () => {
  assert.equal(isPointInAnyRegion(0, 0, []), false);
});
