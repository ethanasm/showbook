/**
 * Smoke tests for logger.ts. Real Axiom transport never starts because
 * AXIOM_TOKEN / AXIOM_DATASET are not set in the unit-test env. We
 * verify the public interface and the redact path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { logger, child, getLogger, flushLogger, serializeErr, _testing } from '../logger';

describe('logger', () => {
  it('getLogger returns a singleton', () => {
    const a = getLogger();
    const b = getLogger();
    assert.equal(a, b);
  });

  it('logger proxy exposes pino methods', () => {
    assert.equal(typeof logger.info, 'function');
    assert.equal(typeof logger.debug, 'function');
    assert.equal(typeof logger.warn, 'function');
    assert.equal(typeof logger.error, 'function');
    assert.equal(typeof logger.fatal, 'function');
  });

  it('child() returns a logger with bound fields', () => {
    const c = child({ component: 'test', requestId: 'abc' });
    assert.equal(typeof c.info, 'function');
    // Pino exposes bindings; assert our binding shows up.
    const bindings = c.bindings();
    assert.equal(bindings.component, 'test');
    assert.equal(bindings.requestId, 'abc');
  });

  it('child(...) does not throw when called multiple times', () => {
    const a = child({ a: 1 });
    const b = child({ b: 2 });
    assert.notEqual(a, b);
  });

  it('flushLogger resolves without throwing', async () => {
    await flushLogger();
  });

  it('logger.info accepts structured payload + message', () => {
    // Just verifying the call doesn't throw — we don't intercept stdout.
    logger.info({ event: 'test.ping', n: 1 }, 'ping');
  });
});

// Plan §F: pino's default err serializer drops `err.cause`. That matters
// because Drizzle / postgres-js wrap the actual `PostgresError` (with
// SQLSTATE `code` + `detail`) in `err.cause` — which is exactly what was
// missing from the 2026-04-30 `shows.create` Axiom record. Verify the
// custom serializer walks the cause chain.
describe('serializeErr', () => {
  it('flattens a plain Error like stdSerializers (type, message, stack)', () => {
    const err = new TypeError('boom');
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.type, 'TypeError');
    assert.equal(serialized.message, 'boom');
    assert.equal(typeof serialized.stack, 'string');
  });

  it('captures err.code (e.g. PG SQLSTATE)', () => {
    const err = Object.assign(new Error('failed query'), { code: '23505' });
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.code, '23505');
  });

  it('captures err.detail (PG server-side detail)', () => {
    const err = Object.assign(new Error('unique violation'), {
      code: '23505',
      detail: 'Key (ticketmaster_venue_id)=(KovZpZAFadlA) already exists.',
    });
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.code, '23505');
    assert.match(String(serialized.detail), /KovZpZAFadlA/);
  });

  it('walks err.cause one level (Drizzle wrapping postgres-js)', () => {
    const pgErr = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      detail: 'already exists',
    });
    const drizzleErr = new Error('Failed query: insert into venues …');
    (drizzleErr as Error & { cause?: unknown }).cause = pgErr;

    const serialized = serializeErr(drizzleErr) as Record<string, unknown>;
    // pino's stdSerializer concatenates the cause message into `message`;
    // we don't fight that. The important data is the structured `cause`.
    assert.match(String(serialized.message), /Failed query/);
    const cause = serialized.cause as Record<string, unknown>;
    assert.match(String(cause.message), /duplicate key value/);
    assert.equal(cause.code, '23505');
    assert.equal(cause.detail, 'already exists');
  });

  it('walks nested err.cause recursively', () => {
    const inner = new Error('innermost');
    const middle = Object.assign(new Error('middle'), { cause: inner });
    const outer = Object.assign(new Error('outer'), { cause: middle });

    const serialized = serializeErr(outer) as Record<string, unknown>;
    const c1 = serialized.cause as Record<string, unknown>;
    assert.match(String(c1.message), /middle/);
    const c2 = c1.cause as Record<string, unknown>;
    assert.match(String(c2.message), /innermost/);
  });

  it('passes through non-Error values unchanged via stdSerializers.err', () => {
    // pino.stdSerializers.err returns the value as-is for non-Error inputs.
    assert.equal(serializeErr('plain string'), 'plain string');
    assert.equal(serializeErr(42), 42);
    assert.equal(serializeErr(null), null);
  });

  it('drops DOMException constant fields so they do not become Axiom columns', () => {
    // DOMException-like errors (RN, Web Crypto, fetch on Node 22) carry
    // ~24 inherited constants — ABORT_ERR, DATA_CLONE_ERR, etc. Pino's
    // default serializer flattens each into its own log field, and
    // Axiom promotes each unique field to a dataset column. That's how
    // showbook-prod hit its 257-column cap and started silently
    // rejecting mobile telemetry events. Allowlist guards against the
    // regression.
    const err = Object.assign(new Error('aborted'), {
      ABORT_ERR: 20,
      DATA_CLONE_ERR: 25,
      HIERARCHY_REQUEST_ERR: 3,
      INDEX_SIZE_ERR: 1,
      NETWORK_ERR: 19,
      // …a real one we DO want
      code: 23,
    });
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.message, 'aborted');
    assert.equal(serialized.code, 23);
    assert.equal(serialized.ABORT_ERR, undefined);
    assert.equal(serialized.DATA_CLONE_ERR, undefined);
    assert.equal(serialized.HIERARCHY_REQUEST_ERR, undefined);
    assert.equal(serialized.INDEX_SIZE_ERR, undefined);
    assert.equal(serialized.NETWORK_ERR, undefined);
  });

  it('drops unknown ad-hoc fields so a one-off throw cannot pollute the schema', () => {
    // Anything we didn't explicitly allowlist gets dropped — a callsite
    // that attaches a temporary field shouldn't widen the Axiom schema
    // forever.
    const err = Object.assign(new Error('boom'), {
      randomAttachedField: 'whatever',
      anotherJunkField: { nested: true },
    });
    const serialized = serializeErr(err) as Record<string, unknown>;
    assert.equal(serialized.randomAttachedField, undefined);
    assert.equal(serialized.anotherJunkField, undefined);
    assert.equal(serialized.message, 'boom');
  });
});

// Every Axiom-bound line is reshaped so only CORE_FIELDS stay top-level
// columns and everything else folds into the single `fields` map field,
// keeping the dataset under its column cap no matter what call-sites log.
// stdout is left untouched. See docs/specs/operations/axiom-map-fields.md.
describe('reshapeForAxiom', () => {
  const { reshapeForAxiom, CORE_FIELDS } = _testing;
  const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

  it('keeps core fields top-level', () => {
    const out = parse(
      reshapeForAxiom(
        JSON.stringify({
          level: 30,
          time: 1,
          event: 'venue.follow',
          component: 'api.venues',
          msg: 'followed',
          job: 'nightly',
          jobId: 'j1',
          userId: 'u1',
        }),
      ),
    );
    for (const key of ['level', 'time', 'event', 'component', 'msg', 'job', 'jobId', 'userId']) {
      assert.ok(key in out, `${key} should stay top-level`);
    }
    assert.equal('fields' in out, false);
  });

  it('folds non-core keys into the fields map', () => {
    const out = parse(
      reshapeForAxiom(
        JSON.stringify({
          event: 'venue.follow',
          venueId: 'v9',
          spotifyTrackId: 't3',
          assetId: 'a2',
        }),
      ),
    );
    assert.equal(out.event, 'venue.follow');
    assert.deepEqual(out.fields, {
      venueId: 'v9',
      spotifyTrackId: 't3',
      assetId: 'a2',
    });
    // The folded keys must not also appear at the top level.
    for (const key of ['venueId', 'spotifyTrackId', 'assetId']) {
      assert.equal(key in out, false);
    }
  });

  it('omits the fields key when every key is core', () => {
    const out = parse(
      reshapeForAxiom(JSON.stringify({ level: 30, event: 'job.complete', msg: 'ok' })),
    );
    assert.equal('fields' in out, false);
  });

  it('keeps err flat (already bounded by serializeErr)', () => {
    const out = parse(
      reshapeForAxiom(
        JSON.stringify({ event: 'db.error', err: { code: '23505', message: 'dup' } }),
      ),
    );
    assert.deepEqual(out.err, { code: '23505', message: 'dup' });
    assert.equal('fields' in out, false);
  });

  it('folds a literal top-level `fields` key into fields.fields', () => {
    // `fields` is deliberately NOT in CORE_FIELDS, so a call-site that logs it
    // gets bounded like any other ad-hoc key rather than colliding.
    assert.equal(CORE_FIELDS.has('fields'), false);
    const out = parse(
      reshapeForAxiom(JSON.stringify({ event: 'x', fields: { a: 1 } })),
    );
    assert.deepEqual(out.fields, { fields: { a: 1 } });
  });

  it('keeps a mobile telemetry line\'s component top-level', () => {
    const out = parse(
      reshapeForAxiom(
        JSON.stringify({
          level: 50,
          component: 'mobile.telemetry',
          event: 'mobile.upload.put.failed',
          errCode: 'ERR_X',
        }),
      ),
    );
    assert.equal(out.component, 'mobile.telemetry');
    assert.deepEqual(out.fields, { errCode: 'ERR_X' });
  });

  it('preserves a trailing newline (and its absence)', () => {
    const withNl = reshapeForAxiom(JSON.stringify({ event: 'x', venueId: 'v' }) + '\n');
    assert.ok(withNl.endsWith('\n'));
    const withoutNl = reshapeForAxiom(JSON.stringify({ event: 'x', venueId: 'v' }));
    assert.equal(withoutNl.endsWith('\n'), false);
  });

  it('returns malformed or non-object lines untouched', () => {
    assert.equal(reshapeForAxiom('not json {'), 'not json {');
    assert.equal(reshapeForAxiom('42'), '42');
    assert.equal(reshapeForAxiom('[1,2]'), '[1,2]');
  });
});
