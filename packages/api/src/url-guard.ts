/**
 * SSRF guard for server-side fetches of user-supplied URLs.
 *
 * The venue scraper (`@showbook/scrapers`) loads a per-venue `scrapeConfig.url`
 * in headless Chromium and fetches its `/robots.txt` — both server-side, on a
 * weekly cron, with the rendered page text persisted to `venue_scrape_runs`
 * and readable back via `venues.scrapeStatus`. Because any user who follows a
 * venue can set that URL (`venues.saveScrapeConfig`), an unguarded `fetch` /
 * `page.goto` turns it into an SSRF + local-file-read primitive:
 *   - `file:///…` reads arbitrary local files (Chromium navigates `file://`),
 *   - `http://127.0.0.1:3002/…` / `http://169.254.169.254/…` reach internal
 *     services and cloud metadata,
 * and the first 2 KB of the response is exfiltrated through `scrapeStatus`.
 *
 * This module rejects non-`http(s)` schemes, embedded credentials, and hosts
 * that are (or resolve to) loopback / private / link-local / reserved
 * addresses. The synchronous variant runs at the validation boundary
 * (`saveScrapeConfig`); the async variant additionally resolves DNS and runs
 * at the actual fetch boundary in the scraper.
 */
import { isIP } from 'node:net';

export class BlockedUrlError extends Error {
  constructor(public readonly reason: string) {
    super(`URL not allowed for server-side fetch: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b, c] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254/16 link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0/24 IETF protocol assignments
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true; // 224/3 multicast + reserved (incl. 240/4, 255.255.255.255)
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped / -embedded (::ffff:a.b.c.d, ::a.b.c.d) — classify on the v4 part.
  const embedded = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded && (lower.startsWith('::ffff:') || lower.startsWith('::'))) {
    return isPrivateV4(embedded[1]!);
  }
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (/^fe[89ab]/.test(lower)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(lower)) return true; // fc00::/7 unique-local
  return false;
}

/** True when `ip` is an IP literal in a private/loopback/link-local/reserved range. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateV4(ip);
  if (fam === 6) return isPrivateV6(ip);
  return false; // not an IP literal — caller resolves via DNS
}

/**
 * Synchronous structural check: scheme is http(s), no embedded credentials,
 * and the host (when an IP literal or an obvious loopback name) is public.
 * Does NOT resolve DNS — a hostname that resolves to a private IP is caught by
 * `assertPublicHttpUrl`. Throws `BlockedUrlError` on rejection.
 */
export function assertPublicHttpUrlSync(raw: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BlockedUrlError('invalid_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new BlockedUrlError('scheme_not_http');
  }
  if (u.username || u.password) {
    throw new BlockedUrlError('userinfo_not_allowed');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new BlockedUrlError('empty_host');
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new BlockedUrlError('loopback_host');
  }
  if (isIP(host) && isPrivateOrReservedIp(host)) {
    throw new BlockedUrlError('private_ip');
  }
}

/**
 * Full guard for the fetch boundary: structural check, then DNS resolution
 * with a private-range check on every resolved address. Throws
 * `BlockedUrlError` on rejection. Note: this does not pin the resolved
 * address, so a determined attacker could still race a DNS-rebind between this
 * check and the actual connect (TOCTOU); the structural + resolved-IP checks
 * close the overwhelming majority of the SSRF surface (file://, literal
 * private IPs, and hostnames currently pointing at private space).
 */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  assertPublicHttpUrlSync(raw);
  const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return; // already validated as a public literal above
  const { lookup } = await import('node:dns/promises');
  let results: { address: string }[];
  try {
    results = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError('dns_resolution_failed');
  }
  if (results.length === 0) throw new BlockedUrlError('dns_no_records');
  for (const { address } of results) {
    if (isPrivateOrReservedIp(address)) {
      throw new BlockedUrlError('resolves_to_private_ip');
    }
  }
}
