/**
 * Manually trigger the daily digest run. Useful for verifying templates,
 * the Resend API key, and end-to-end delivery without waiting for 8 AM cron.
 *
 *   pnpm --filter web exec tsx scripts/run-daily-digest.ts
 *
 * Reads RESEND_API_KEY and NEXT_PUBLIC_APP_URL from the environment. With
 * RESEND_API_KEY unset, the run prints what *would* be sent and skips the
 * Resend call.
 */

import { runDailyDigest } from '@showbook/jobs';

async function main() {
  const start = Date.now();
  const result = await runDailyDigest();
  console.log(
    `Done in ${Date.now() - start}ms — sent=${result.sent} skipped=${result.skipped}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
