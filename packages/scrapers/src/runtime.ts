import { chromium, type Browser } from 'playwright';

const POLITE_USER_AGENT =
  'Mozilla/5.0 (compatible; ShowbookBot/1.0; +https://showbook.local/about)';

let browser: Browser | null = null;
const lastFetchByHost = new Map<string, number>();
const MIN_INTERVAL_MS = 2000;

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({ headless: true });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
    browser = null;
  }
}

/**
 * Throttle to one request per `MIN_INTERVAL_MS` per host. Idle waits silently
 * if we're hitting the same venue's site twice in a row.
 */
export async function throttle(host: string): Promise<void> {
  const last = lastFetchByHost.get(host) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
  }
  lastFetchByHost.set(host, Date.now());
}

/**
 * Fetch and parse a venue's `/robots.txt`. Returns true when the path is
 * allowed for our user agent. Errors are treated as "allowed" — we don't
 * want a missing robots.txt to silently block scraping.
 */
export async function isAllowedByRobots(targetUrl: string): Promise<boolean> {
  try {
    const url = new URL(targetUrl);
    const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
    const res = await fetch(robotsUrl, {
      headers: { 'User-Agent': POLITE_USER_AGENT },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return true;
    const body = await res.text();
    return checkRobots(body, url.pathname);
  } catch {
    return true;
  }
}

/**
 * Tiny robots.txt parser — supports User-agent and Allow/Disallow only.
 * Good enough for the venues we'll target; full RFC compliance can wait.
 */
export function checkRobots(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split('\n').map((l) => l.trim());
  let inOurGroup = false;
  let inGlobalGroup = false;
  let allowed = true;

  // Parse "User-agent: *" sections; * applies if no specific group matches.
  // We could add a "ShowbookBot" group later if needed.
  for (const line of lines) {
    if (line.startsWith('#') || line === '') continue;
    const lower = line.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const ua = lower.slice('user-agent:'.length).trim();
      inOurGroup = ua === 'showbookbot';
      inGlobalGroup = ua === '*';
      continue;
    }
    if (!inOurGroup && !inGlobalGroup) continue;
    if (lower.startsWith('disallow:')) {
      const disallow = line.slice('disallow:'.length).trim();
      if (disallow && path.startsWith(disallow)) allowed = false;
    } else if (lower.startsWith('allow:')) {
      const allow = line.slice('allow:'.length).trim();
      if (allow && path.startsWith(allow)) allowed = true;
    }
  }
  return allowed;
}

export { POLITE_USER_AGENT };
