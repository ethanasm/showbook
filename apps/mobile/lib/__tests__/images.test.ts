/**
 * Tests for the mobile image-source helpers. Each helper has three branches —
 * authenticated proxy, direct CDN URL, and null/no-image — which is the shape
 * the call sites (ShowCard, HeroShowCard, ShowDetail hero) rely on to decide
 * whether to render a real image or fall back to a monogram / empty slot.
 *
 * `API_URL` is read at module-eval, so we can't toggle it per test cleanly.
 * Tests assert on the branches that don't depend on it (showCoverImageSource
 * with null token and no coverImageUrl), plus the basic proxy URL shape when
 * the test env happens to set EXPO_PUBLIC_API_URL.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  showCoverImageSource,
  performerImageSource,
  venueImageSource,
  type ShowCoverInput,
} from '../images';
import { API_URL } from '../env';

describe('showCoverImageSource', () => {
  const TM_URL =
    'https://s1.ticketm.net/dam/a/ffc/6b65cdb5-d036-4f20-85be-9c9900751ffc_SOURCE';
  const baseShow: ShowCoverInput = {
    id: '11111111-1111-1111-1111-111111111111',
    coverImageUrl: TM_URL,
  };

  it('returns null when coverImageUrl is null — caller falls back to existing UX', () => {
    assert.equal(showCoverImageSource({ id: baseShow.id, coverImageUrl: null }, 'tok'), null);
    assert.equal(showCoverImageSource({ id: baseShow.id }, 'tok'), null);
  });

  it('returns null when coverImageUrl is an empty string', () => {
    assert.equal(showCoverImageSource({ id: baseShow.id, coverImageUrl: '' }, 'tok'), null);
  });

  it('routes through the show-cover proxy when a Bearer token is available', (t) => {
    if (!API_URL) {
      t.skip('EXPO_PUBLIC_API_URL not set in this test env');
      return;
    }
    const src = showCoverImageSource(baseShow, 'tok-abc');
    assert.ok(src, 'expected an ImageSource');
    assert.equal(src!.uri, `${API_URL}/api/show-cover/${baseShow.id}`);
    assert.deepEqual(src!.headers, { Authorization: 'Bearer tok-abc' });
  });

  it('falls back to the direct CDN URL when no token is available', () => {
    // When the token is null the helper bypasses the proxy and returns the
    // stored TM CDN URL directly — that's what protects offline / cold-start
    // renders before sign-in re-mints a bearer.
    const src = showCoverImageSource(baseShow, null);
    assert.deepEqual(src, { uri: TM_URL });
  });

  it('returns null when token is null AND coverImageUrl is not an absolute URL', () => {
    // Future-proofs against a non-HTTP value sneaking into coverImageUrl;
    // we never render such a value as a direct URI.
    const src = showCoverImageSource(
      { id: baseShow.id, coverImageUrl: 'places/CnRtAAAATLZNl354RwP_9' },
      null,
    );
    assert.equal(src, null);
  });
});

// Smoke-test that the other helpers in the file still expose the documented
// branches — keeps a regression net under the broader image-source module
// since this file is the first dedicated test for it.
describe('performerImageSource & venueImageSource (smoke)', () => {
  it('performerImageSource returns null when neither token nor imageUrl is available', () => {
    assert.equal(
      performerImageSource({ id: 'p1', imageUrl: null }, null),
      null,
    );
  });

  it('venueImageSource returns the direct URL when photoUrl is absolute', () => {
    const src = venueImageSource(
      { id: 'v1', photoUrl: 'https://example.cdn/photo.jpg' },
      null,
    );
    assert.deepEqual(src, { uri: 'https://example.cdn/photo.jpg' });
  });

  it('venueImageSource returns null when only a Places resource and no token', () => {
    assert.equal(
      venueImageSource(
        { id: 'v1', photoUrl: null, googlePlaceId: 'places/abc' },
        null,
      ),
      null,
    );
  });
});
