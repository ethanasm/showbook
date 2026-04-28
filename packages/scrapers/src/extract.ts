import { getBrowser, throttle, POLITE_USER_AGENT } from './runtime';

const MAX_PAGE_CONTENT_BYTES = 30_000;

export interface ExtractedPage {
  url: string;
  text: string;
  title: string;
  bytes: number;
}

/**
 * Load `url` in headless Chromium, wait for network idle, then return the
 * rendered visible text + page title. Caps output at 30 KB so we don't blow
 * the LLM context on enormous calendar pages.
 */
export async function loadAndExtract(url: string): Promise<ExtractedPage> {
  const host = new URL(url).host;
  await throttle(host);

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: POLITE_USER_AGENT,
  });
  const page = await context.newPage();
  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30_000,
    });

    const title = await page.title();

    // innerText collapses whitespace and skips hidden nodes, which is what
    // we want for LLM extraction.
    const rawText = await page.evaluate(() => {
      const body = document.body;
      return body ? body.innerText : '';
    });

    // Compress consecutive blank lines and strip very long runs of
    // whitespace. Keeps semantically distinct lines intact.
    const cleaned = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join('\n');

    const trimmed =
      cleaned.length > MAX_PAGE_CONTENT_BYTES
        ? cleaned.slice(0, MAX_PAGE_CONTENT_BYTES)
        : cleaned;

    return {
      url,
      text: trimmed,
      title,
      bytes: trimmed.length,
    };
  } finally {
    await context.close();
  }
}
