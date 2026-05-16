/**
 * Unit suite for the song-index-rebuild job's pure helpers. The DB
 * round-trip (delete + re-insert + matview refresh) is exercised by
 * the integration test alongside the corpus-fill flow.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveRole } from '../song-index-rebuild';

// ─────────────────────────────────────────────────────────────────────
// deriveRole — exhaustive coverage of every role + boundary case
// ─────────────────────────────────────────────────────────────────────

describe('deriveRole — main-set-only (no encore)', () => {
  test('first song = opener', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 0,
        sectionCount: 1,
        songsInSection: 10,
        isEncore: false,
        hasEncore: false,
      }),
      'opener',
    );
  });

  test('last song = closer (no encore)', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 9,
        sectionCount: 1,
        songsInSection: 10,
        isEncore: false,
        hasEncore: false,
      }),
      'closer',
    );
  });

  test('middle song = core', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 5,
        sectionCount: 1,
        songsInSection: 10,
        isEncore: false,
        hasEncore: false,
      }),
      'core',
    );
  });

  test('single-song setlist = opener (not closer; closer rule needs not-position-0)', () => {
    // Per the spec the opener check fires first; for a one-song
    // setlist the song is the opener.
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 0,
        sectionCount: 1,
        songsInSection: 1,
        isEncore: false,
        hasEncore: false,
      }),
      'opener',
    );
  });
});

describe('deriveRole — main-set + encore', () => {
  test('first main-set song = opener', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 0,
        sectionCount: 2,
        songsInSection: 15,
        isEncore: false,
        hasEncore: true,
      }),
      'opener',
    );
  });

  test('last main-set song = closer (when encore exists)', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 14,
        sectionCount: 2,
        songsInSection: 15,
        isEncore: false,
        hasEncore: true,
      }),
      'closer',
    );
  });

  test('first encore song = encore_open', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 0,
        sectionCount: 2,
        songsInSection: 3,
        isEncore: true,
        hasEncore: true,
      }),
      'encore_open',
    );
  });

  test('last encore song = encore_close', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 2,
        sectionCount: 2,
        songsInSection: 3,
        isEncore: true,
        hasEncore: true,
      }),
      'encore_close',
    );
  });

  test('middle encore song = core', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 1,
        sectionCount: 2,
        songsInSection: 4,
        isEncore: true,
        hasEncore: true,
      }),
      'core',
    );
  });

  test('single-song encore = encore_open (the open rule wins over close)', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 0,
        sectionCount: 2,
        songsInSection: 1,
        isEncore: true,
        hasEncore: true,
      }),
      'encore_open',
    );
  });

  test('middle main-set song = core', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 7,
        sectionCount: 2,
        songsInSection: 15,
        isEncore: false,
        hasEncore: true,
      }),
      'core',
    );
  });
});

describe('deriveRole — multi-section main set (e.g. theatre-style "act" splits)', () => {
  test('first song of section 0 is the opener regardless of how many sections', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 0,
        sectionCount: 3,
        songsInSection: 5,
        isEncore: false,
        hasEncore: true,
      }),
      'opener',
    );
  });

  test('last song of the LAST non-encore section is the closer', () => {
    // 3 sections: [0=set1, 1=set2, 2=encore]. Closer is the last
    // song of section 1 (last non-encore).
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 9,
        sectionCount: 3,
        songsInSection: 10,
        isEncore: false,
        hasEncore: true,
      }),
      'closer',
    );
  });

  test('last song of section 0 is core (because section 1 also has main-set songs)', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 9,
        sectionCount: 3,
        songsInSection: 10,
        isEncore: false,
        hasEncore: true,
      }),
      'core',
    );
  });

  test('songs anywhere else in a multi-section main set are core', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 3,
        sectionCount: 3,
        songsInSection: 10,
        isEncore: false,
        hasEncore: true,
      }),
      'core',
    );
  });
});

describe('deriveRole — pathological edge cases', () => {
  test('encore-only setlist (no main section): treat encore as encore', () => {
    // Single section that IS the encore. Edge case for setlists that
    // come in encore-only from a malformed setlist.fm payload.
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 0,
        sectionCount: 1,
        songsInSection: 2,
        isEncore: true,
        hasEncore: true,
      }),
      'encore_open',
    );
    assert.equal(
      deriveRole({
        sectionIndex: 0,
        songIndex: 1,
        sectionCount: 1,
        songsInSection: 2,
        isEncore: true,
        hasEncore: true,
      }),
      'encore_close',
    );
  });

  test('5-song encore: first, middle, last are encore_open / core / encore_close', () => {
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 0,
        sectionCount: 2,
        songsInSection: 5,
        isEncore: true,
        hasEncore: true,
      }),
      'encore_open',
    );
    for (let i = 1; i <= 3; i++) {
      assert.equal(
        deriveRole({
          sectionIndex: 1,
          songIndex: i,
          sectionCount: 2,
          songsInSection: 5,
          isEncore: true,
          hasEncore: true,
        }),
        'core',
        `middle encore index ${i} should be core`,
      );
    }
    assert.equal(
      deriveRole({
        sectionIndex: 1,
        songIndex: 4,
        sectionCount: 2,
        songsInSection: 5,
        isEncore: true,
        hasEncore: true,
      }),
      'encore_close',
    );
  });
});

describe('deriveRole — fuzz over every (sectionIndex, songIndex) shape', () => {
  test('every output is one of the five canonical roles', () => {
    const allowed = new Set(['opener', 'closer', 'encore_open', 'encore_close', 'core']);
    for (let sectionCount = 1; sectionCount <= 3; sectionCount++) {
      for (let songsInSection = 1; songsInSection <= 6; songsInSection++) {
        for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
          for (let songIndex = 0; songIndex < songsInSection; songIndex++) {
            for (const hasEncore of [true, false]) {
              const isEncore = hasEncore && sectionIndex === sectionCount - 1;
              const role = deriveRole({
                sectionIndex,
                songIndex,
                sectionCount,
                songsInSection,
                isEncore,
                hasEncore,
              });
              assert.ok(allowed.has(role), `invalid role ${role}`);
            }
          }
        }
      }
    }
  });
});
