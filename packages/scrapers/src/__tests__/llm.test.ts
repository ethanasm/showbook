/**
 * Unit tests for scrapers/llm.ts. We swap the Groq client through the
 * `__test` seam and validate the prompt + Zod + anti-hallucination
 * pipeline without making real LLM calls.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractEventsFromPage, __test, type LlmExtractInput } from '../llm';

interface FakeCompletion {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { total_tokens?: number };
}

function makeClient(impl: () => Promise<FakeCompletion>) {
  return { chat: { completions: { create: impl } } };
}

const baseInput: LlmExtractInput = {
  pageText: 'The Phoebe Bridgers tour kicks off Aug 15 2026 at the Greek Theater.',
  pageTitle: 'Phoebe Bridgers Tour',
  pageUrl: 'https://example.com/tour',
  venueName: 'Greek Theater',
  venueCity: 'Berkeley',
  venueRegion: 'California',
  venueDescriptor: 'concerts',
  todayISO: '2026-04-30',
};

beforeEach(() => {
  __test.setClient(null);
});

describe('buildSystemPrompt', () => {
  it('mentions venue name + city + region + descriptor', () => {
    const prompt = __test.buildSystemPrompt(baseInput);
    assert.match(prompt, /Greek Theater/);
    assert.match(prompt, /Berkeley/);
    assert.match(prompt, /California/);
    assert.match(prompt, /concerts/);
    assert.match(prompt, /2026-04-30/);
  });

  it('omits region when null', () => {
    const prompt = __test.buildSystemPrompt({ ...baseInput, venueRegion: null });
    assert.doesNotMatch(prompt, /Berkeley,/);
  });
});

describe('normalizeForQuoteMatch', () => {
  it('lowercases and collapses whitespace', () => {
    assert.equal(__test.normalizeForQuoteMatch('  Hello   World\n\t!  '), 'hello world !');
  });
});

describe('extractEventsFromPage', () => {
  it('accepts events whose sourceQuote appears in the page', async () => {
    const eventJson = JSON.stringify({
      events: [
        {
          title: 'Phoebe Bridgers',
          startDate: '2026-08-15',
          sourceQuote: 'Phoebe Bridgers tour',
        },
      ],
    });
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: eventJson } }],
        usage: { total_tokens: 123 },
      })),
    );
    const result = await extractEventsFromPage(baseInput);
    assert.equal(result.events.length, 1);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.tokensUsed, 123);
  });

  it('rejects events whose sourceQuote is not in the page', async () => {
    const eventJson = JSON.stringify({
      events: [
        {
          title: 'Made up',
          startDate: '2026-08-15',
          sourceQuote: 'this text is nowhere on the page',
        },
      ],
    });
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: eventJson } }],
        usage: { total_tokens: 50 },
      })),
    );
    const result = await extractEventsFromPage(baseInput);
    assert.equal(result.events.length, 0);
    assert.equal(result.rejected.length, 1);
  });

  it('returns empty when JSON is malformed', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: '<not json>' } }],
      })),
    );
    const result = await extractEventsFromPage(baseInput);
    assert.equal(result.events.length, 0);
    assert.equal(result.rejected.length, 0);
  });

  it('returns empty when schema invalid', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: '{"events":[{"title":""}]}' } }],
      })),
    );
    const result = await extractEventsFromPage(baseInput);
    assert.equal(result.events.length, 0);
  });

  it('handles missing content gracefully', async () => {
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: null } }],
      })),
    );
    const result = await extractEventsFromPage(baseInput);
    assert.equal(result.events.length, 0);
    assert.equal(result.tokensUsed, 0);
  });

  it('partitions accepted vs rejected when mixed', async () => {
    const eventJson = JSON.stringify({
      events: [
        {
          title: 'Real',
          startDate: '2026-08-15',
          sourceQuote: 'Greek Theater',
        },
        {
          title: 'Fake',
          startDate: '2026-09-01',
          sourceQuote: 'totally not in the page text 12345',
        },
      ],
    });
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: eventJson } }],
      })),
    );
    const result = await extractEventsFromPage(baseInput);
    assert.equal(result.events.length, 1);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.events[0]?.title, 'Real');
    assert.equal(result.rejected[0]?.title, 'Fake');
  });

  it('rejects when sourceQuote is too short', async () => {
    const eventJson = JSON.stringify({
      events: [
        {
          title: 'Short',
          startDate: '2026-08-15',
          sourceQuote: 'ab',
        },
      ],
    });
    __test.setClient(
      makeClient(async () => ({
        choices: [{ message: { content: eventJson } }],
      })),
    );
    const result = await extractEventsFromPage(baseInput);
    assert.equal(result.events.length, 0);
    assert.equal(result.rejected.length, 0); // failed schema (min 3)
  });
});
