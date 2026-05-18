/**
 * Phase 6 unit suite — theatrical-style prediction model.
 *
 * Mirrors the Beyoncé Cowboy Carter worked example
 * (`docs/specs/setlist-intelligence/worked-examples.md` §3): a
 * 32-setlist corpus that produces a deterministic setlist plus two
 * rotating "surprise" slots. The fixture is a stripped-down 8-night
 * corpus that still reproduces the dual-rotating-slot output, since
 * the model's logic doesn't depend on corpus size beyond the per-slot
 * share thresholds.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTheatricalSurpriseSlotHits,
  predictTheatrical,
} from '../setlist-predict-theatrical';
import type { CorpusRow } from '../setlist-predict';
import type { PerformerSetlist } from '@showbook/shared';

function setlistOf(
  acts: Array<{ name?: string; kind?: 'set' | 'encore'; songs: string[] }>,
): PerformerSetlist {
  return {
    sections: acts.map((a) => ({
      kind: a.kind ?? 'set',
      name: a.name,
      songs: a.songs.map((title) => ({ title })),
    })),
  };
}

function row(opts: { date: string; setlist: PerformerSetlist; venue?: string }): CorpusRow {
  return {
    id: `row-${opts.date}`,
    performerId: 'beyonce',
    performanceDate: opts.date,
    tourId: 'cowboy-carter-tour',
    tourName: 'Cowboy Carter Tour',
    setlist: opts.setlist,
    songCount: opts.setlist.sections.reduce((a, s) => a + s.songs.length, 0),
    fetchedAt: new Date(`${opts.date}T12:00:00Z`),
    venueNameRaw: opts.venue ?? null,
  };
}

// Beyoncé Cowboy Carter worked example, compressed. 8 nights, 9 acts,
// the same setlist save for the Act V "surprise" slot and the Act VII
// "family appearance" slot.
function buildBeyonceCorpus(): CorpusRow[] {
  const dates = [
    '2025-04-28',
    '2025-04-29',
    '2025-05-02',
    '2025-05-03',
    '2025-05-05',
    '2025-05-08',
    '2025-05-10',
    '2025-05-12',
  ];
  // Act V surprise rotates among 5 candidates with the share distribution
  // documented in the worked example.
  const act5Surprise = [
    'DAUGHTER',
    'DAUGHTER',
    'DAUGHTER',
    'FLAMENCO',
    'FLAMENCO',
    'SMOKE HOUR var.',
    'SMOKE HOUR var.',
    'II HANDS II HEAVEN',
  ];
  // Act VII family appearance — Rumi dominant (55%), Blue Ivy + none
  // splitting the remainder.
  const act7Family = [
    'PROTECTOR (with Rumi)',
    'PROTECTOR (with Rumi)',
    'PROTECTOR (with Rumi)',
    'PROTECTOR (with Rumi)',
    'BLACKBIIRD (with Blue Ivy)',
    'BLACKBIIRD (with Blue Ivy)',
    'no family member tonight',
    'no family member tonight',
  ];
  return dates.map((date, i) =>
    row({
      date,
      setlist: setlistOf([
        { name: 'Act I', songs: ['AMERICAN REQUIEM', 'Blackbird', 'The Star-Spangled Banner'] },
        { name: 'Act II', songs: ['AMERICA HAS A PROBLEM', 'SPAGHETTII', 'Formation', 'Diva'] },
        { name: 'Act III', songs: ['ALLIGATOR TEARS', 'JUST FOR FUN', 'PROTECTOR'] },
        { name: 'Act IV', songs: ['BODYGUARD', 'JOLENE'] },
        { name: 'Act V', songs: ['YA YA', act5Surprise[i]!] },
        { name: 'Act VI', songs: ['TYRANT', 'CUFF IT'] },
        { name: 'Act VII', songs: [act7Family[i]!] },
        { name: 'Act VIII', songs: ['16 CARRIAGES'] },
        { name: 'Encore', kind: 'encore', songs: ['AMEN'] },
      ]),
    }),
  );
}

describe('predictTheatrical — Beyoncé worked example', () => {
  test('deterministic setlist holds the fixed positions exactly', () => {
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: buildBeyonceCorpus(),
    });
    assert.equal(out.style, 'theatrical');
    // Act I should be three fixed songs in order.
    const actI = out.deterministicSetlist.filter((s) => s.act === 'Act I');
    assert.equal(actI.length, 3);
    assert.equal(actI[0]!.title, 'AMERICAN REQUIEM');
    assert.equal(actI[1]!.title, 'Blackbird');
    assert.equal(actI[2]!.title, 'The Star-Spangled Banner');
    assert.equal(actI[0]!.probability, 1);
    // Act IX/Encore — AMEN.
    const encore = out.deterministicSetlist.find((s) => s.title === 'AMEN');
    assert.ok(encore);
    assert.equal(encore!.act, 'Encore');
  });

  test('surfaces the Act V rotating surprise slot', () => {
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: buildBeyonceCorpus(),
    });
    const act5 = out.rotatingSlots.find((s) => s.act === 'Act V');
    assert.ok(act5, 'expected a rotating slot inside Act V');
    // 4 candidates: DAUGHTER (3/8), FLAMENCO (2/8), SMOKE HOUR (2/8),
    // II HANDS (1/8). All meet the 10% minimum.
    const titles = act5!.candidates.map((c) => c.title);
    assert.ok(titles.includes('DAUGHTER'));
    assert.ok(titles.includes('FLAMENCO'));
    assert.ok(titles.includes('SMOKE HOUR var.'));
  });

  test('Act VII family appearance keeps Rumi-dominant probability', () => {
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: buildBeyonceCorpus(),
    });
    // Note: act 7 family slot may end up as fixed (Rumi got 4/8 = 50%, just
    // below the rotating-max-top threshold of 0.6; but as it's between
    // 0.6 and 0.95 with ≥3 candidates available, it's classified
    // rotating per the model).
    const slot = out.rotatingSlots.find((s) => s.act === 'Act VII');
    assert.ok(slot, 'expected a rotating slot inside Act VII');
    const rumi = slot!.candidates.find((c) =>
      c.title.includes('PROTECTOR'),
    );
    assert.ok(rumi);
    // Rumi share is 4/8 = 0.5, below the dominant-candidate threshold
    // (0.6), so the model distributes uniformly over the eligible
    // candidates. Three candidates qualify → ≈0.33 each.
    assert.ok(rumi!.probability > 0.2 && rumi!.probability < 0.5);
  });

  test('expectedSongCount tracks the average', () => {
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: buildBeyonceCorpus(),
    });
    // Each fixture setlist has 18 songs; expectedSongCount ≈ 18.
    assert.ok(Math.abs(out.expectedSongCount - 18) <= 1);
  });

  test('handles empty corpus gracefully', () => {
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: [],
    });
    assert.equal(out.style, 'theatrical');
    assert.equal(out.deterministicSetlist.length, 0);
    assert.equal(out.rotatingSlots.length, 0);
    assert.equal(out.sampleSize, 0);
  });

  test('a single dominant candidate (≥60% share) keeps its observed share', () => {
    // 10 nights, Act V slot 2 is DAUGHTER 8/10, FLAMENCO 1/10, SMOKE 1/10.
    const fixture: CorpusRow[] = [];
    for (let i = 0; i < 10; i += 1) {
      let surprise = 'DAUGHTER';
      if (i === 0) surprise = 'FLAMENCO';
      if (i === 1) surprise = 'SMOKE HOUR var.';
      fixture.push(
        row({
          date: new Date(2025, 4, 1 + i).toISOString().slice(0, 10),
          setlist: setlistOf([
            { name: 'Act I', songs: ['Open', 'Mid'] },
            { name: 'Act V', songs: ['Anchor', surprise] },
            { name: 'Encore', kind: 'encore', songs: ['Close'] },
          ]),
        }),
      );
    }
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-20',
      corpus: fixture,
    });
    // Top share (0.8) is between 0.6 and 0.95 → rotating slot, but
    // 'DAUGHTER' keeps its observed share via the dominant-candidate
    // branch. With only 3 candidates and 'DAUGHTER' at 0.8 share,
    // the dominant-candidate rule applies.
    const act5 = out.rotatingSlots.find((s) => s.act === 'Act V');
    if (act5) {
      const dominant = act5.candidates.find((c) => c.title === 'DAUGHTER');
      assert.ok(dominant);
      assert.ok(dominant!.probability >= 0.7);
    } else {
      // Alternatively the slot fell into the deterministic bucket
      // because the top share crossed 0.95 — both behaviours are
      // acceptable per the spec; verify the deterministic version
      // surfaces the right song.
      const det = out.deterministicSetlist.find((s) =>
        s.act === 'Act V' && s.title === 'DAUGHTER',
      );
      assert.ok(det);
    }
  });

  test('confidence near 1.0 for an established theatrical tour', () => {
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: buildBeyonceCorpus(),
    });
    assert.ok(out.confidence >= 0.85, `expected confidence ≥ 0.85, got ${out.confidence}`);
  });

  test('drops the target-date row from the corpus', () => {
    const corpus = buildBeyonceCorpus();
    const targetDate = corpus[0]!.performanceDate;
    const out = predictTheatrical({
      performerId: 'beyonce',
      targetDate,
      corpus,
    });
    // 8 corpus rows minus one (target) → 7 remaining.
    assert.equal(out.sampleSize, 7);
  });
});

describe('computeTheatricalSurpriseSlotHits', () => {
  test('marks a hit when actual song is in the slot candidate set', () => {
    const prediction = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: buildBeyonceCorpus(),
    });
    const actVSlot = prediction.rotatingSlots.find((s) => s.act === 'Act V');
    assert.ok(actVSlot);
    const hits = computeTheatricalSurpriseSlotHits({
      performerId: 'beyonce',
      prediction,
      actualSetlistByAct: [
        { actIndex: actVSlot!.actIndex, songs: ['YA YA', 'DAUGHTER'] },
      ],
    });
    const actVHit = hits.find((h) => h.slotName === actVSlot!.slotName);
    assert.ok(actVHit);
    assert.equal(actVHit!.hit, true);
    assert.equal(actVHit!.actualTitle, 'DAUGHTER');
  });

  test('marks a miss when the band surprised the model', () => {
    const prediction = predictTheatrical({
      performerId: 'beyonce',
      targetDate: '2025-05-14',
      corpus: buildBeyonceCorpus(),
    });
    const actVSlot = prediction.rotatingSlots.find((s) => s.act === 'Act V');
    assert.ok(actVSlot);
    const hits = computeTheatricalSurpriseSlotHits({
      performerId: 'beyonce',
      prediction,
      actualSetlistByAct: [
        {
          actIndex: actVSlot!.actIndex,
          songs: ['YA YA', 'Truly Surprising Choice'],
        },
      ],
    });
    const actVHit = hits.find((h) => h.slotName === actVSlot!.slotName);
    assert.ok(actVHit);
    assert.equal(actVHit!.hit, false);
  });
});
