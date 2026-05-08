import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreEmailLikelyTicket,
  HEURISTIC_THRESHOLD,
} from '../email-heuristic';

const positiveSamples: Array<{ name: string; subject: string; body: string; from: string }> = [
  {
    name: 'Ticketmaster confirmation',
    subject: 'Your Ticketmaster Order Confirmation',
    from: 'customer_support@email.ticketmaster.com',
    body:
      'Order #12345. Phoebe Bridgers at The Greek Theatre. ' +
      'Sun, Aug 16, 2026 at 7:00 PM. Section A, Row 12, Seat 4. ' +
      'Quantity: 2. Total: $158.50.',
  },
  {
    name: 'AXS confirmation',
    subject: "You're going to the show!",
    from: 'order@axs.com',
    body:
      'Doors open at 7pm on March 15, 2026. The Fillmore, San Francisco. ' +
      'Section GA. 1 ticket. $45.00.',
  },
  {
    name: 'DICE ticket',
    subject: "Get ready for tonight",
    from: 'noreply@dice.fm',
    body:
      'Your e-ticket for Friday, May 10. Mercury Lounge. ' +
      'General admission. Booking confirmation #ABC123. $25',
  },
  {
    name: 'Telecharge theatre',
    subject: 'Order Confirmation - Hamilton',
    from: 'service@telecharge.com',
    body:
      'Thank you for your order. Performance: Wed, Jun 5, 2026 at 8:00 PM. ' +
      'Richard Rodgers Theater. Section: Orchestra. Row F, Seat 101. ' +
      'Quantity: 2. Total $498.',
  },
  {
    name: 'TodayTix booking',
    subject: 'Your booking is confirmed',
    from: 'no-reply@e.todaytix.com',
    body:
      'Booking confirmation for Wicked. Aug 22, 2026 at 7:00 PM. ' +
      'Gershwin Theatre. Section: Mezzanine, Row B. 1 ticket. $89',
  },
  {
    name: 'Indie venue',
    subject: 'Your tickets',
    from: 'tickets@bowery-ballroom.com',
    body:
      'Beach House at Bowery Ballroom. Tuesday, October 12, 2026, doors 8pm. ' +
      'Quantity: 2. $80.00',
  },
];

const negativeSamples: Array<{ name: string; subject: string; body: string; from: string }> = [
  {
    name: 'museum admission',
    subject: 'Your museum tickets',
    from: 'tickets@metmuseum.org',
    body:
      'Thank you for visiting. Your museum admission for two adults is confirmed.',
  },
  {
    name: 'parking pass',
    subject: 'Parking pass confirmation',
    from: 'parking@example.com',
    body: 'Your parking pass for lot 3 is ready. Valid Aug 16, 2026.',
  },
  {
    name: 'shipping notification',
    subject: 'Your order has shipped',
    from: 'shipping@store.com',
    body: 'Tracking number ABCD1234. Expected delivery March 1, 2026.',
  },
  {
    name: 'flight itinerary',
    subject: 'Flight confirmation - SFO to JFK',
    from: 'noreply@united.com',
    body:
      'Your flight itinerary. United 123. Departing March 15, 2026 at 8:00 AM.',
  },
  {
    name: 'hotel reservation',
    subject: 'Hotel reservation confirmed',
    from: 'reservations@hotels.com',
    body:
      'Your hotel reservation is confirmed for March 15-17, 2026. Marriott San Francisco.',
  },
  {
    name: 'newsletter',
    subject: 'This week in music',
    from: 'newsletter@example.com',
    body:
      'Hello music fan, here is our weekly newsletter. Unsubscribe from this list at any time.',
  },
];

describe('scoreEmailLikelyTicket', () => {
  it('threshold is 30 (calibration anchor)', () => {
    // Pinning the constant makes accidental changes show up in code review.
    assert.equal(HEURISTIC_THRESHOLD, 30);
  });

  for (const sample of positiveSamples) {
    it(`positive sample passes threshold: ${sample.name}`, () => {
      const score = scoreEmailLikelyTicket(sample);
      assert.ok(
        score >= HEURISTIC_THRESHOLD,
        `expected >= ${HEURISTIC_THRESHOLD}, got ${score} for ${sample.name}`,
      );
    });
  }

  for (const sample of negativeSamples) {
    it(`negative sample is below threshold: ${sample.name}`, () => {
      const score = scoreEmailLikelyTicket(sample);
      assert.ok(
        score < HEURISTIC_THRESHOLD,
        `expected < ${HEURISTIC_THRESHOLD}, got ${score} for ${sample.name}`,
      );
    });
  }

  it('is deterministic for the same input', () => {
    const sample = positiveSamples[0]!;
    const a = scoreEmailLikelyTicket(sample);
    const b = scoreEmailLikelyTicket(sample);
    assert.equal(a, b);
  });

  it('clamps to [0, 100]', () => {
    const huge = scoreEmailLikelyTicket({
      subject:
        'tickets confirmation order seat section row qty quantity venue e-ticket booking',
      body:
        'March 15, 2026. The Fillmore. Quantity: 2. $99.00. Section GA. Row 1.',
      from: 'tickets@venue.com',
    });
    assert.ok(huge <= 100);

    const empty = scoreEmailLikelyTicket({ subject: '', body: '', from: '' });
    assert.ok(empty >= 0);
    assert.ok(empty < HEURISTIC_THRESHOLD);
  });
});
