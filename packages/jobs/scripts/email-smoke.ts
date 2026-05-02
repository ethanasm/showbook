/**
 * Email smoke test: render the daily digest with sample data and write the
 * HTML to disk. Open the file in a browser to inspect the layout.
 *
 * Run via:  pnpm email:smoke
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDailyDigest } from '@showbook/emails';

const out = process.env.SMOKE_OUT ?? join(tmpdir(), 'showbook-digest.html');
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://localhost:3001';

async function main() {
  const html = await renderDailyDigest({
    displayName: 'Ethan',
    todayShows: [
      {
        headliner: 'Hadestown',
        venueName: 'Walter Kerr Theatre',
        seat: 'Orch G 14',
      },
    ],
    upcomingShows: [
      {
        headliner: 'Caroline Polachek',
        venueName: 'Brooklyn Steel',
        dateLabel: 'Sat, May 3',
        daysUntil: 3,
      },
      {
        headliner: 'The Cure',
        venueName: 'Madison Square Garden',
        dateLabel: 'Wed, May 7',
        daysUntil: 7,
      },
    ],
    newAnnouncements: [
      {
        headliner: 'Phoebe Bridgers',
        venueName: 'Forest Hills Stadium',
        whenLabel: 'Aug 15',
        reason: 'artist',
        onSaleSoon: true,
      },
      {
        headliner: 'Sufjan Stevens',
        venueName: 'Kings Theatre',
        whenLabel: 'Sep 12 – Sep 14 (3 dates)',
        reason: 'venue',
        onSaleSoon: false,
      },
    ],
    preamble:
      'Tonight you slip into Orch G 14 for Hadestown — that long descent again. ' +
      'Wear the good shoes.\n\n' +
      'Then Caroline Polachek lands at Brooklyn Steel in three days, and a Phoebe ' +
      'Bridgers date at Forest Hills just dropped — on sale soon.',
    appUrl,
  });

  writeFileSync(out, html);
  console.log(`✓ Rendered daily digest (${html.length} chars)`);
  console.log(`  → ${out}`);
}

main().catch((err) => {
  console.error('✗ Smoke test failed:', err);
  process.exit(1);
});
