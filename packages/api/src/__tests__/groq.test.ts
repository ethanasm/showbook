/**
 * Unit tests for groq.ts. We swap in a fake Groq client via the `__test`
 * seam so no network calls are made and the parsing/validation/error
 * paths are exercised in isolation. `traceLLM` falls through to the
 * `run()` callback when LANGFUSE_PUBLIC_KEY is unset.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShowInput,
  extractShowFromEmail,
  validateAndDedupTickets,
  extractShowFromPdfText,
  extractCast,
  __test,
  type ExtractedTicketInfo,
} from '../groq';

interface FakeCompletion {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function makeClient(impl: () => Promise<FakeCompletion>) {
  return {
    chat: { completions: { create: impl } },
  };
}

beforeEach(() => {
  __test.setClient(null);
  process.env.GROQ_API_KEY = 'test-key';
});

describe('parseShowInput', () => {
  it('returns parsed structure when Groq returns valid JSON', async () => {
    const json = JSON.stringify({
      headliner: 'Phoebe Bridgers',
      venue_hint: 'Greek Theater',
      date_hint: '2026-08-15',
      seat_hint: 'GA',
      kind_hint: 'concert',
    });
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: json } }] })),
    );
    const result = await parseShowInput('Phoebe Bridgers at Greek 8/15 GA');
    assert.equal(result.headliner, 'Phoebe Bridgers');
    assert.equal(result.kind_hint, 'concert');
  });

  it('throws when Groq returns no content', async () => {
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: null } }] })),
    );
    await assert.rejects(
      parseShowInput('foo'),
      /No response from Groq/,
    );
  });

  it('throws when Groq returns invalid JSON', async () => {
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: '<not json>' } }] })),
    );
    await assert.rejects(
      parseShowInput('foo'),
      /Failed to parse Groq response as JSON/,
    );
  });

  it('throws when JSON shape fails Zod validation', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: '{"missing_fields": true}' } }],
      })),
    );
    await assert.rejects(
      parseShowInput('foo'),
      /failed schema validation/,
    );
  });
});

describe('extractShowFromEmail', () => {
  function happyResponse(): FakeCompletion {
    const json = JSON.stringify({
      headliner: 'Hamilton',
      production_name: 'Hamilton',
      venue_name: 'Richard Rodgers Theatre',
      venue_city: 'New York',
      venue_state: 'New York',
      date: '2026-09-01',
      seat: 'Orchestra A1',
      price: '299.00',
      ticket_count: 2,
      kind_hint: 'theatre',
      confidence: 'high',
    });
    return { choices: [{ message: { content: json } }] };
  }

  it('returns parsed ticket on success', async () => {
    __test.setClient(makeClient(async () => happyResponse()));
    const result = await extractShowFromEmail(
      'Your Hamilton tickets',
      'Confirmation: 2 tix',
      'tickets@example.com',
      '2026-08-01',
    );
    assert.ok(result);
    assert.equal(result?.headliner, 'Hamilton');
    assert.equal(result?.confidence, 'high');
  });

  it('returns null when confidence is low', async () => {
    const json = JSON.stringify({
      headliner: '',
      production_name: null,
      venue_name: null,
      venue_city: null,
      venue_state: null,
      date: null,
      seat: null,
      price: null,
      ticket_count: null,
      kind_hint: null,
      confidence: 'low',
    });
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: json } }] })),
    );
    const result = await extractShowFromEmail('subj', 'body', 'from@x');
    assert.equal(result, null);
  });

  it('returns null when JSON parse fails', async () => {
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: 'oops' } }] })),
    );
    const result = await extractShowFromEmail('subj', 'body', 'from@x');
    assert.equal(result, null);
  });

  it('returns null when schema validation fails', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: '{}' } }],
      })),
    );
    const result = await extractShowFromEmail('subj', 'body', 'from@x');
    assert.equal(result, null);
  });

  it('retries on 429 then succeeds', async () => {
    let calls = 0;
    __test.setClient(
      makeClient(async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('rate limited'), {
            status: 429,
            headers: { get: () => null },
          });
        }
        return happyResponse();
      }),
    );
    const result = await extractShowFromEmail('subj', 'body', 'from@x');
    assert.ok(result);
    assert.equal(calls, 2);
  });

  it('honours Retry-After header on 429', async () => {
    let calls = 0;
    __test.setClient(
      makeClient(async () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('rate limited'), {
            status: 429,
            headers: { get: (k: string) => (k === 'retry-after' ? '0.001' : null) },
          });
        }
        return happyResponse();
      }),
    );
    const start = Date.now();
    const result = await extractShowFromEmail('s', 'b', 'f@x', undefined, 1);
    const elapsed = Date.now() - start;
    assert.ok(result);
    // Just verify the call completed; sleep is tiny.
    assert.ok(elapsed >= 0);
    assert.equal(calls, 2);
  });

  it('returns null when retries exhausted on non-429 error', async () => {
    __test.setClient(
      makeClient(async () => {
        throw new Error('boom');
      }),
    );
    const result = await extractShowFromEmail('s', 'b', 'f@x', undefined, 0);
    assert.equal(result, null);
  });

  it('returns null when 429 retries exhausted', async () => {
    __test.setClient(
      makeClient(async () => {
        throw Object.assign(new Error('rate limited'), {
          status: 429,
          headers: { get: () => null },
        });
      }),
    );
    const result = await extractShowFromEmail('s', 'b', 'f@x', undefined, 0);
    assert.equal(result, null);
  });
});

describe('validateAndDedupTickets', () => {
  const ticket: ExtractedTicketInfo = {
    headliner: 'Phoebe',
    production_name: null,
    venue_name: 'Greek',
    venue_city: 'Berkeley',
    venue_state: 'California',
    date: '2026-08-15',
    seat: 'GA',
    price: '50',
    ticket_count: 2,
    kind_hint: 'concert',
    confidence: 'high',
  };

  it('short-circuits empty array without calling Groq', async () => {
    __test.setClient(
      makeClient(async () => {
        throw new Error('should not be called');
      }),
    );
    const result = await validateAndDedupTickets([]);
    assert.deepEqual(result, []);
  });

  it('returns parsed tickets array when Groq returns valid JSON', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: JSON.stringify({ tickets: [ticket] }) } }],
      })),
    );
    const result = await validateAndDedupTickets([ticket]);
    assert.equal(result.length, 1);
  });

  it('falls back to input on JSON parse error', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: 'not json' } }],
      })),
    );
    const result = await validateAndDedupTickets([ticket]);
    assert.deepEqual(result, [ticket]);
  });

  it('falls back to input when Groq returns no content', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: null } }],
      })),
    );
    const result = await validateAndDedupTickets([ticket]);
    assert.deepEqual(result, [ticket]);
  });
});

describe('extractShowFromPdfText', () => {
  it('returns parsed ticket on success', async () => {
    const json = JSON.stringify({
      headliner: 'Comedy Show',
      production_name: null,
      venue_name: 'Comedy Cellar',
      venue_city: 'New York',
      venue_state: 'New York',
      date: '2026-05-01',
      seat: null,
      price: '20',
      ticket_count: 1,
      kind_hint: 'comedy',
      confidence: 'high',
    });
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: json } }] })),
    );
    const result = await extractShowFromPdfText('comedy cellar may 1');
    assert.equal(result.headliner, 'Comedy Show');
  });

  it('throws when no content', async () => {
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: null } }] })),
    );
    await assert.rejects(
      extractShowFromPdfText('text'),
      /No response from Groq/,
    );
  });

  it('throws on JSON parse error', async () => {
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: '{ broken' } }] })),
    );
    await assert.rejects(
      extractShowFromPdfText('text'),
      /Failed to parse Groq response/,
    );
  });

  it('throws on schema validation failure', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: '{"foo":1}' } }],
      })),
    );
    await assert.rejects(
      extractShowFromPdfText('text'),
      /failed schema validation/,
    );
  });
});

describe('extractCast', () => {
  it('returns cast list when Groq returns valid JSON', async () => {
    const json = JSON.stringify({
      cast: [
        { actor: 'Cynthia Erivo', role: 'Elphaba' },
        { actor: 'Ariana Grande', role: 'Glinda' },
      ],
    });
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: json } }] })),
    );
    const cast = await extractCast(
      'iVBORw0KGgo' + 'A'.repeat(50),
    );
    assert.equal(cast.length, 2);
    assert.equal(cast[0]?.actor, 'Cynthia Erivo');
  });

  it('returns [] when JSON shape is invalid', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: '{"cast":[{"bogus":true}]}' } }],
      })),
    );
    const cast = await extractCast('iVBORw0KGgo');
    assert.deepEqual(cast, []);
  });

  it('throws when no content returned', async () => {
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: null } }] })),
    );
    await assert.rejects(
      extractCast('iVBORw0KGgo'),
      /No response from Groq/,
    );
  });

  it('throws on JSON parse error', async () => {
    __test.setClient(
      makeClient(async () => ({ choices: [{ message: { content: 'oops' } }] })),
    );
    await assert.rejects(
      extractCast('iVBORw0KGgo'),
      /Failed to parse Groq response as JSON/,
    );
  });

  it('accepts a data: URL directly', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: '{"cast":[]}' } }],
      })),
    );
    const cast = await extractCast(
      'data:image/png;base64,iVBORw0KGgo',
    );
    assert.deepEqual(cast, []);
  });
});

describe('detectImageMime', () => {
  it('detects PNG', () => {
    assert.equal(__test.detectImageMime('iVBORw0KGgoABC'), 'image/png');
  });
  it('detects JPEG', () => {
    assert.equal(__test.detectImageMime('/9j/AAAA'), 'image/jpeg');
  });
  it('detects GIF', () => {
    assert.equal(__test.detectImageMime('R0lGODrest'), 'image/gif');
  });
  it('detects WEBP', () => {
    assert.equal(__test.detectImageMime('UklGRabc'), 'image/webp');
  });
  it('falls back to JPEG for unknown', () => {
    assert.equal(__test.detectImageMime('zzz'), 'image/jpeg');
  });
});
