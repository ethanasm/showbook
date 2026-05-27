import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTicketmasterNativeDeepLink,
  buildTicketmasterOpenPlan,
  extractTicketmasterEventId,
  openTicketmasterUrl,
} from '../ticketmaster-deep-link';

describe('extractTicketmasterEventId', () => {
  it('parses the canonical www.ticketmaster.com/event/{id} shape', () => {
    assert.equal(
      extractTicketmasterEventId(
        'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B',
      ),
      '0F005EE5C0EA9F7B',
    );
  });

  it('parses a slugged path like /artist-slug/event/{id}', () => {
    assert.equal(
      extractTicketmasterEventId(
        'https://www.ticketmaster.com/taylor-swift-the-eras-tour-foxborough/event/01005D4C8E041F3D',
      ),
      '01005D4C8E041F3D',
    );
  });

  it('tolerates a trailing query string', () => {
    assert.equal(
      extractTicketmasterEventId(
        'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B?utm_source=showbook',
      ),
      '0F005EE5C0EA9F7B',
    );
  });

  it('tolerates a trailing slash', () => {
    assert.equal(
      extractTicketmasterEventId(
        'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B/',
      ),
      '0F005EE5C0EA9F7B',
    );
  });

  it('parses international TLDs (.ca / .co.uk)', () => {
    assert.equal(
      extractTicketmasterEventId('https://www.ticketmaster.ca/event/ABC123'),
      'ABC123',
    );
    assert.equal(
      extractTicketmasterEventId('https://www.ticketmaster.co.uk/event/DEF456'),
      'DEF456',
    );
  });

  it('parses alternate subdomains (concerts.)', () => {
    assert.equal(
      extractTicketmasterEventId(
        'https://concerts.ticketmaster.com/event/Z7r9jZ1AdaA0u',
      ),
      'Z7r9jZ1AdaA0u',
    );
  });

  it('trims surrounding whitespace', () => {
    assert.equal(
      extractTicketmasterEventId(
        '  https://www.ticketmaster.com/event/0F005EE5C0EA9F7B  ',
      ),
      '0F005EE5C0EA9F7B',
    );
  });

  it('returns null for affiliate / non-TM URLs', () => {
    assert.equal(
      extractTicketmasterEventId('https://on.fgtix.com/trk/sILM'),
      null,
    );
    assert.equal(
      extractTicketmasterEventId('https://concerts.livenation.com/foo/bar'),
      null,
    );
  });

  it('returns null for TM URLs without an /event/ segment', () => {
    assert.equal(
      extractTicketmasterEventId(
        'https://www.ticketmaster.com/checkout/sale/123',
      ),
      null,
    );
  });

  it('returns null for null / undefined / empty', () => {
    assert.equal(extractTicketmasterEventId(null), null);
    assert.equal(extractTicketmasterEventId(undefined), null);
    assert.equal(extractTicketmasterEventId(''), null);
  });
});

describe('buildTicketmasterNativeDeepLink', () => {
  it('round-trips from id', () => {
    assert.equal(
      buildTicketmasterNativeDeepLink('0F005EE5C0EA9F7B'),
      'ticketmaster://event/0F005EE5C0EA9F7B',
    );
  });
});

describe('buildTicketmasterOpenPlan', () => {
  it('prefers the native deep link with the raw URL as fallback', () => {
    const plan = buildTicketmasterOpenPlan(
      'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B',
    );
    assert.equal(plan.primary, 'ticketmaster://event/0F005EE5C0EA9F7B');
    assert.equal(
      plan.fallback,
      'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B',
    );
  });

  it('uses the raw URL on both sides when the URL is not a TM event', () => {
    const plan = buildTicketmasterOpenPlan('https://on.fgtix.com/trk/sILM');
    assert.equal(plan.primary, 'https://on.fgtix.com/trk/sILM');
    assert.equal(plan.fallback, 'https://on.fgtix.com/trk/sILM');
  });

  it('returns empty strings for null/empty input', () => {
    const plan = buildTicketmasterOpenPlan(null);
    assert.equal(plan.primary, '');
    assert.equal(plan.fallback, '');
  });
});

describe('openTicketmasterUrl', () => {
  it('opens the native deep link when the URL is a TM event', async () => {
    const calls: string[] = [];
    const openURL = async (target: string): Promise<void> => {
      calls.push(target);
    };
    await openTicketmasterUrl(
      'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B',
      openURL,
    );
    assert.deepEqual(calls, ['ticketmaster://event/0F005EE5C0EA9F7B']);
  });

  it('falls back to the web URL when the native scheme rejects', async () => {
    const calls: string[] = [];
    const openURL = async (target: string): Promise<void> => {
      calls.push(target);
      if (target.startsWith('ticketmaster://')) {
        throw new Error('no handler');
      }
    };
    await openTicketmasterUrl(
      'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B',
      openURL,
    );
    assert.deepEqual(calls, [
      'ticketmaster://event/0F005EE5C0EA9F7B',
      'https://www.ticketmaster.com/event/0F005EE5C0EA9F7B',
    ]);
  });

  it('opens the raw URL directly when not a TM event', async () => {
    const calls: string[] = [];
    const openURL = async (target: string): Promise<void> => {
      calls.push(target);
    };
    await openTicketmasterUrl('https://on.fgtix.com/trk/sILM', openURL);
    assert.deepEqual(calls, ['https://on.fgtix.com/trk/sILM']);
  });

  it('propagates rejection from the web fallback', async () => {
    const openURL = async (): Promise<void> => {
      throw new Error('boom');
    };
    await assert.rejects(() =>
      openTicketmasterUrl('https://on.fgtix.com/trk/sILM', openURL),
    );
  });
});
