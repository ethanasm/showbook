/**
 * CLI entrypoint: `pnpm --filter @showbook/scrapers run`.
 * Runs the scraper job locally for ad-hoc verification.
 */
import { runScrapers } from './run';
import { closeBrowser } from './runtime';
import { child, flushObservability } from '@showbook/observability';

const log = child({ component: 'scrapers.cli' });

async function main() {
  log.info({ event: 'scrapers.cli.start' }, 'Starting scraper run');
  try {
    const result = await runScrapers();
    log.info({ event: 'scrapers.cli.complete', ...result }, 'Scraper run complete');
    await flushObservability();
    process.exit(result.failed > 0 ? 2 : 0);
  } catch (err) {
    log.error({ err, event: 'scrapers.cli.fatal' }, 'Scraper run fatal');
    await flushObservability();
    process.exit(1);
  } finally {
    await closeBrowser();
  }
}

void main();
