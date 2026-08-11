/**
 * describePlaylistExportFailure contract (see the module docblock for the
 * 2026-08-10 incident that motivated it):
 *   - terminal application rejections (scopes, not-connected, cold
 *     prediction, empty setlist, expired session) get specific copy and
 *     keepQueued: false — replaying them can never succeed.
 *   - transport-shaped failures (offline, 5xx, no decodable response)
 *     keep the outbox row for the reconnect replay.
 *   - an UNAUTHORIZED rejection while ONLINE must NOT read as an offline
 *     queue — that's the exact misclassification from the incident.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describePlaylistExportFailure } from '../setlist-intel/playlist-export-failure';

function trpcError(message: string, data?: { code?: string; httpStatus?: number }): Error {
  return Object.assign(new Error(message), data ? { data } : {});
}

describe('describePlaylistExportFailure', () => {
  it('maps the known terminal application codes with keepQueued: false', () => {
    const cases: Array<[Error, string]> = [
      [
        trpcError('spotify_scopes_missing:playlist-modify-private'),
        'Spotify needs an updated permission. Reconnect from Preferences.',
      ],
      [trpcError('spotify_not_connected'), 'Connect Spotify to create this playlist.'],
      [
        trpcError('prediction_cold'),
        'Not enough setlist data yet — try again closer to the show.',
      ],
      [
        trpcError('prediction_empty'),
        'Not enough setlist data yet — try again closer to the show.',
      ],
      [trpcError('setlist_empty'), 'No setlist on file yet — add songs from the Edit panel.'],
    ];
    for (const [err, expected] of cases) {
      const plan = describePlaylistExportFailure(err, true);
      assert.equal(plan.message, expected);
      assert.equal(plan.keepQueued, false);
    }
  });

  it('classifies UNAUTHORIZED while online as session-expired, not offline-queued', () => {
    const err = trpcError('UNAUTHORIZED', { code: 'UNAUTHORIZED', httpStatus: 401 });
    const plan = describePlaylistExportFailure(err, true);
    assert.equal(plan.message, 'Session expired — sign in again to sync.');
    assert.equal(plan.keepQueued, false);
  });

  it('classifies UNAUTHORIZED while offline as session-expired too', () => {
    // A dead token beats the offline heuristic: reconnecting won't fix it.
    const err = trpcError('UNAUTHORIZED', { code: 'UNAUTHORIZED', httpStatus: 401 });
    const plan = describePlaylistExportFailure(err, false);
    assert.equal(plan.message, 'Session expired — sign in again to sync.');
    assert.equal(plan.keepQueued, false);
  });

  it('keeps the row queued when offline with a transport failure', () => {
    const plan = describePlaylistExportFailure(new TypeError('fetch failed'), false);
    assert.equal(plan.message, "Queued — we'll create it on Spotify when you're back online.");
    assert.equal(plan.keepQueued, true);
  });

  it('keeps the row queued for an online transient failure (5xx / no response)', () => {
    for (const err of [
      trpcError('Internal error', { httpStatus: 503 }),
      new TypeError('fetch failed'), // no decodable tRPC response
    ]) {
      const plan = describePlaylistExportFailure(err, true);
      assert.equal(plan.message, 'Spotify export failed. Try again in a moment.');
      assert.equal(plan.keepQueued, true);
    }
  });

  it('drops the row for an online non-transient application rejection', () => {
    const err = trpcError('BAD_REQUEST', { code: 'BAD_REQUEST', httpStatus: 400 });
    const plan = describePlaylistExportFailure(err, true);
    assert.equal(plan.message, 'Spotify export failed. Try again in a moment.');
    assert.equal(plan.keepQueued, false);
  });

  it('tolerates non-Error throwables', () => {
    const plan = describePlaylistExportFailure('boom', false);
    assert.equal(plan.keepQueued, true); // offline, no terminal marker
  });
});
