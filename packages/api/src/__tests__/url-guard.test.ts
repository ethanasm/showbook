/**
 * Unit tests for the SSRF guard used at the venue-scraper fetch boundary
 * (and at `saveScrapeConfig`'s validation boundary).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlSync,
  isPrivateOrReservedIp,
  BlockedUrlError,
} from '../url-guard';

describe('isPrivateOrReservedIp', () => {
  it('flags IPv4 loopback / private / link-local / reserved ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1', // CGNAT
      '198.18.0.1', // benchmarking
      '224.0.0.1', // multicast
      '255.255.255.255',
    ]) {
      assert.equal(isPrivateOrReservedIp(ip), true, `${ip} should be blocked`);
    }
  });

  it('allows public IPv4 literals', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      assert.equal(isPrivateOrReservedIp(ip), false, `${ip} should be allowed`);
    }
  });

  it('flags IPv6 loopback / ULA / link-local / mapped-private', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1']) {
      assert.equal(isPrivateOrReservedIp(ip), true, `${ip} should be blocked`);
    }
  });

  it('allows public IPv6 and non-IP strings', () => {
    assert.equal(isPrivateOrReservedIp('2606:4700:4700::1111'), false);
    assert.equal(isPrivateOrReservedIp('example.com'), false); // not an IP literal
  });
});

describe('assertPublicHttpUrlSync', () => {
  function reason(fn: () => void): string {
    try {
      fn();
      return '<no-throw>';
    } catch (err) {
      assert.ok(err instanceof BlockedUrlError);
      return err.reason;
    }
  }

  it('rejects non-http(s) schemes including file://', () => {
    assert.equal(reason(() => assertPublicHttpUrlSync('file:///etc/passwd')), 'scheme_not_http');
    assert.equal(reason(() => assertPublicHttpUrlSync('ftp://example.com/x')), 'scheme_not_http');
    assert.equal(reason(() => assertPublicHttpUrlSync('gopher://example.com')), 'scheme_not_http');
  });

  it('rejects embedded credentials', () => {
    assert.equal(
      reason(() => assertPublicHttpUrlSync('http://user:pass@example.com')),
      'userinfo_not_allowed',
    );
  });

  it('rejects localhost and private/loopback IP literals', () => {
    assert.equal(reason(() => assertPublicHttpUrlSync('http://localhost:3002/x')), 'loopback_host');
    assert.equal(reason(() => assertPublicHttpUrlSync('http://app.localhost/x')), 'loopback_host');
    assert.equal(reason(() => assertPublicHttpUrlSync('http://127.0.0.1/x')), 'private_ip');
    assert.equal(
      reason(() => assertPublicHttpUrlSync('http://169.254.169.254/latest/meta-data/')),
      'private_ip',
    );
    assert.equal(reason(() => assertPublicHttpUrlSync('http://[::1]/x')), 'private_ip');
  });

  it('rejects malformed URLs', () => {
    assert.equal(reason(() => assertPublicHttpUrlSync('not a url')), 'invalid_url');
  });

  it('allows ordinary public http(s) URLs', () => {
    assert.doesNotThrow(() => assertPublicHttpUrlSync('https://example.com/events'));
    assert.doesNotThrow(() => assertPublicHttpUrlSync('http://venue.example.org/calendar?x=1'));
  });
});

describe('assertPublicHttpUrl (async, with DNS)', () => {
  it('rejects file:// and literal private IPs before any DNS lookup', async () => {
    await assert.rejects(() => assertPublicHttpUrl('file:///etc/passwd'), BlockedUrlError);
    await assert.rejects(() => assertPublicHttpUrl('http://127.0.0.1/x'), BlockedUrlError);
    await assert.rejects(
      () => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/'),
      BlockedUrlError,
    );
  });

  it('allows a public IP literal without resolving DNS', async () => {
    await assert.doesNotReject(() => assertPublicHttpUrl('http://8.8.8.8/x'));
  });
});
