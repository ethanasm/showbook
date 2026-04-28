/**
 * CLI entrypoint: `pnpm --filter @showbook/scrapers run`.
 * Runs the scraper job locally for ad-hoc verification.
 */
import { runScrapers } from './run';
import { closeBrowser } from './runtime';

async function main() {
  console.log('[scrapers/cli] starting scraper run...');
  try {
    const result = await runScrapers();
    console.log('[scrapers/cli] complete:', result);
    process.exit(result.failed > 0 ? 2 : 0);
  } catch (err) {
    console.error('[scrapers/cli] fatal:', err);
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

void main();
