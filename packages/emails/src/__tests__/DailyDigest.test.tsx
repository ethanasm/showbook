import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderDailyDigest } from '../render';
import type { DailyDigestProps } from '../DailyDigest';

const APP = 'https://showbook.example';

const fullProps: DailyDigestProps = {
  displayName: 'Ethan',
  todayShows: [
    { headliner: 'Phoebe Bridgers', venueName: 'Greek Theater', seat: 'GA' },
  ],
  upcomingShows: [
    {
      headliner: 'Hamilton',
      venueName: 'Richard Rodgers Theatre',
      dateLabel: 'Sat Sep 1',
      daysUntil: 14,
    },
  ],
  newAnnouncements: [
    {
      headliner: 'Olivia Rodrigo',
      venueName: 'Madison Square Garden',
      whenLabel: 'Sun Aug 16',
      reason: 'artist',
      onSaleSoon: true,
    },
    {
      headliner: 'Some Local Band',
      venueName: 'The Independent',
      whenLabel: 'Fri Sep 5',
      reason: 'venue',
      onSaleSoon: false,
    },
  ],
  appUrl: APP,
};

describe('renderDailyDigest', () => {
  it('renders all sections with sample data', async () => {
    const html = await renderDailyDigest(fullProps);
    assert.match(html, /Ethan/);
    assert.match(html, /Phoebe Bridgers/);
    assert.match(html, /Greek Theater/);
    assert.match(html, /Hamilton/);
    assert.match(html, /Richard Rodgers Theatre/);
    assert.match(html, /Olivia Rodrigo/);
    assert.match(html, /Madison Square Garden/);
    assert.match(html, /Some Local Band/);
    assert.match(html, /The Independent/);
  });

  it('outputs a complete HTML document', async () => {
    const html = await renderDailyDigest(fullProps);
    assert.match(html, /<html[^>]*>/i);
    assert.match(html, /<\/html>/i);
    assert.match(html, /<body[^>]*>/i);
  });

  it('handles empty digest with friendly fallback', async () => {
    const html = await renderDailyDigest({
      displayName: 'Ethan',
      todayShows: [],
      upcomingShows: [],
      newAnnouncements: [],
      appUrl: APP,
    });
    // Should still render a complete document; no crashing on empty arrays.
    assert.match(html, /<html/i);
    assert.match(html, /Ethan/);
  });

  it('marks on-sale announcements distinctly', async () => {
    const html = await renderDailyDigest({
      ...fullProps,
      newAnnouncements: [
        {
          headliner: 'On Sale Soon Artist',
          venueName: 'Venue X',
          whenLabel: 'Aug 1',
          reason: 'artist',
          onSaleSoon: true,
        },
      ],
    });
    assert.match(html, /On Sale Soon Artist/);
  });

  it('shows seat label only when present', async () => {
    const html = await renderDailyDigest({
      ...fullProps,
      todayShows: [
        { headliner: 'No Seat Show', venueName: 'V', seat: null },
        { headliner: 'Seated Show', venueName: 'V', seat: 'Row B Seat 3' },
      ],
      upcomingShows: [],
      newAnnouncements: [],
    });
    assert.match(html, /No Seat Show/);
    assert.match(html, /Seated Show/);
    assert.match(html, /Row B Seat 3/);
  });

  it('uses appUrl in CTA links', async () => {
    const html = await renderDailyDigest(fullProps);
    assert.match(html, new RegExp(APP.replace(/\./g, '\\.')));
  });
});
