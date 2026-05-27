import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildGoogleMapsOpenPlan } from '../google-maps-deep-link';

describe('buildGoogleMapsOpenPlan', () => {
  it('prefers coords for both native and web when latitude/longitude are present', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Madison Square Garden',
      latitude: 40.7505,
      longitude: -73.9934,
      googlePlaceId: 'ChIJhRwB-yFawokR5Phil-QQ3zM',
      city: 'New York',
    });
    assert.ok(plan);
    assert.equal(plan.primary, 'comgooglemaps://?q=40.7505,-73.9934');
    // URLSearchParams uses `+` for spaces and encodes the comma — both
    // forms are accepted by Google Maps Search URL API.
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=40.7505%2C-73.9934&query_place_id=ChIJhRwB-yFawokR5Phil-QQ3zM',
    );
  });

  it('omits query_place_id when no place id is set', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'The Fillmore',
      latitude: 37.7841,
      longitude: -122.4327,
      googlePlaceId: null,
      city: 'San Francisco',
    });
    assert.ok(plan);
    assert.equal(plan.primary, 'comgooglemaps://?q=37.7841,-122.4327');
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=37.7841%2C-122.4327',
    );
  });

  it('falls back to the venue name + city when coords are missing', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'The Sinclair',
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      city: 'Cambridge',
    });
    assert.ok(plan);
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=The%20Sinclair%2C%20Cambridge',
    );
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=The+Sinclair%2C+Cambridge',
    );
  });

  it('still works when only a name is available', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Red Rocks Amphitheatre',
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      city: null,
    });
    assert.ok(plan);
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=Red%20Rocks%20Amphitheatre',
    );
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=Red+Rocks+Amphitheatre',
    );
  });

  it('uses query_place_id even when only the place id + name are known', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Royal Albert Hall',
      latitude: null,
      longitude: null,
      googlePlaceId: 'ChIJk_s92NyipBIRUMnDG8Kq2Js',
      city: null,
    });
    assert.ok(plan);
    assert.equal(
      plan.primary,
      'comgooglemaps://?q=Royal%20Albert%20Hall',
    );
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=Royal+Albert+Hall&query_place_id=ChIJk_s92NyipBIRUMnDG8Kq2Js',
    );
  });

  it('returns null when we have nothing to look up', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: '',
      latitude: null,
      longitude: null,
      googlePlaceId: null,
      city: null,
    });
    assert.equal(plan, null);
  });

  it('treats NaN coords as missing and falls back to name', () => {
    const plan = buildGoogleMapsOpenPlan({
      name: 'Mystery Venue',
      latitude: Number.NaN,
      longitude: Number.NaN,
      googlePlaceId: null,
      city: null,
    });
    assert.ok(plan);
    assert.equal(plan.primary, 'comgooglemaps://?q=Mystery%20Venue');
    assert.equal(
      plan.fallback,
      'https://www.google.com/maps/search/?api=1&query=Mystery+Venue',
    );
  });
});
