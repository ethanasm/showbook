/**
 * Unit tests for the pure helpers in routers/enrichment.ts. The router
 * itself is mostly orchestration around external services
 * (Ticketmaster, Setlist.fm, Groq, Gmail, Places); the cleanest seam to
 * test in-process is the helpers it composes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  correctExtractedYear,
  mapEventToResult,
} from '../routers/enrichment';
import type { TMEvent } from '../ticketmaster';

describe('correctExtractedYear', () => {
  const EMAIL_DATE = 'Wed, 03 May 2024 12:00:00 +0000';

  it('returns null when extractedDate is null', () => {
    assert.equal(correctExtractedYear(null, EMAIL_DATE), null);
  });

  it('returns extractedDate unchanged when emailDateHeader is empty', () => {
    assert.equal(correctExtractedYear('2024-06-01', ''), '2024-06-01');
  });

  it('returns extractedDate unchanged when emailDateHeader is unparseable', () => {
    assert.equal(
      correctExtractedYear('2024-06-01', 'not-a-date'),
      '2024-06-01',
    );
  });

  it('returns extractedDate unchanged when format does not match YYYY-MM-DD', () => {
    assert.equal(
      correctExtractedYear('June 1', EMAIL_DATE),
      'June 1',
    );
  });

  it('keeps the year when it equals the email year', () => {
    assert.equal(
      correctExtractedYear('2024-08-15', EMAIL_DATE),
      '2024-08-15',
    );
  });

  it('keeps the year when it equals the email year + 1', () => {
    assert.equal(
      correctExtractedYear('2025-08-15', EMAIL_DATE),
      '2025-08-15',
    );
  });

  it('corrects a too-old year to the email year when same-year date is after email', () => {
    // Email sent 2024-05-03; show extracted as 2023-08-15. Same-month-day in
    // 2024 (Aug 15) is after May 3, so corrected to 2024.
    assert.equal(
      correctExtractedYear('2023-08-15', EMAIL_DATE),
      '2024-08-15',
    );
  });

  it('corrects a wrong year to email-year+1 when the same-year date precedes the email', () => {
    // Email sent 2024-05-03; show extracted as 2099-04-15.
    // Same-day-month in 2024 (Apr 15) is BEFORE May 3, so it picks 2025.
    assert.equal(
      correctExtractedYear('2099-04-15', EMAIL_DATE),
      '2025-04-15',
    );
  });
});

function makeTMEvent(overrides: Partial<TMEvent> = {}): TMEvent {
  return {
    id: 'evt-1',
    name: 'Test Show',
    url: 'https://tm/example',
    dates: {
      start: { localDate: '2026-08-01', localTime: '20:00:00', dateTime: '2026-08-01T20:00:00Z' },
    },
    classifications: [
      { segment: { name: 'Music' }, genre: { name: 'Rock' }, subGenre: { name: 'Indie' } },
    ],
    sales: null,
    images: [],
    _embedded: {
      venues: [
        {
          id: 'v1',
          name: 'Test Hall',
          city: { name: 'NYC' },
          state: { stateCode: 'NY' },
          country: { countryCode: 'US' },
          location: { latitude: '40.7', longitude: '-74.0' },
        },
      ],
      attractions: [
        { id: 'a1', name: 'Headliner', images: [] },
        { id: 'a2', name: 'Support', images: [] },
      ],
    },
    ...overrides,
  } as unknown as TMEvent;
}

describe('mapEventToResult', () => {
  it('flattens the TM event into our result shape', () => {
    const result = mapEventToResult(makeTMEvent());
    assert.equal(result.tmEventId, 'evt-1');
    assert.equal(result.url, 'https://tm/example');
    assert.equal(result.name, 'Test Show');
    assert.equal(result.date, '2026-08-01');
    assert.equal(result.venueName, 'Test Hall');
    assert.equal(result.venueCity, 'NYC');
    assert.equal(result.venueState, 'NY');
    assert.equal(result.venueCountry, 'US');
    assert.equal(result.venueTmId, 'v1');
    assert.equal(result.venueLat, 40.7);
    assert.equal(result.venueLng, -74);
    assert.equal(result.performers.length, 2);
    assert.equal(result.performers[0].name, 'Headliner');
    assert.equal(result.performers[0].tmAttractionId, 'a1');
  });

  it('returns nulls for missing venue fields', () => {
    const result = mapEventToResult(
      makeTMEvent({ _embedded: { attractions: [], venues: [] } } as never),
    );
    assert.equal(result.venueName, null);
    assert.equal(result.venueCity, null);
    assert.equal(result.venueState, null);
    assert.equal(result.venueCountry, null);
    assert.equal(result.venueLat, null);
    assert.equal(result.venueLng, null);
    assert.deepEqual(result.performers, []);
  });

  it('falls back to null url when missing', () => {
    const evt = makeTMEvent();
    delete (evt as { url?: string | null }).url;
    const result = mapEventToResult(evt);
    assert.equal(result.url, null);
  });
});
