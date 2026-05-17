/**
 * Phase 6 — component tests for the theatrical-style display variant.
 * Mirrors the Beyoncé Cowboy Carter worked example
 * (`showbook-specs/setlist-intelligence/worked-examples.md` §3) with a
 * compressed fixture: a 9-act program plus the Act V surprise +
 * Act VII family-appearance rotating slots.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import type { TheatricalPrediction } from '@showbook/api';
import {
  ActDivider,
  RotatingSlotCard,
  TheatricalSetlistView,
} from '../show-tabs/TheatricalSetlistView';

const BEYONCE_PREDICTION: TheatricalPrediction = {
  style: 'theatrical',
  confidence: 0.99,
  sampleSize: 32,
  tourId: 'beyonce__cowboy-carter-tour',
  tourName: 'Cowboy Carter Tour',
  copy:
    "Tonight's show is choreographed top to bottom — the same setlist with 2 rotating slots.",
  spoilerBlurDefault: true,
  expectedSongCount: 39,
  deterministicSetlist: [
    { act: 'Act I', actIndex: 0, title: 'AMERICAN REQUIEM', probability: 1, slotShare: 1 },
    { act: 'Act I', actIndex: 0, title: 'Blackbird', probability: 1, slotShare: 1 },
    { act: 'Act I', actIndex: 0, title: 'The Star-Spangled Banner', probability: 1, slotShare: 1 },
    { act: 'Act II', actIndex: 1, title: 'AMERICA HAS A PROBLEM', probability: 1, slotShare: 1 },
    { act: 'Act II', actIndex: 1, title: 'SPAGHETTII', probability: 1, slotShare: 1 },
    { act: 'Act II', actIndex: 1, title: 'Formation', probability: 1, slotShare: 1 },
    { act: 'Encore', actIndex: 8, title: 'AMEN', probability: 1, slotShare: 1 },
  ],
  rotatingSlots: [
    {
      act: 'Act V',
      actIndex: 4,
      positionInAct: 1,
      slotName: 'Variable · Act V · slot 2',
      candidates: [
        { title: 'DAUGHTER', probability: 0.31, slotShare: 0.31 },
        { title: 'FLAMENCO', probability: 0.22, slotShare: 0.22 },
        { title: 'SMOKE HOUR var.', probability: 0.18, slotShare: 0.18 },
        { title: 'Crazy In Love (acoustic)', probability: 0.14, slotShare: 0.14 },
      ],
    },
    {
      act: 'Act VII',
      actIndex: 6,
      positionInAct: 0,
      slotName: 'Variable · Act VII · slot 1',
      candidates: [
        { title: 'PROTECTOR (with Rumi)', probability: 0.55, slotShare: 0.55 },
        { title: 'BLACKBIIRD (with Blue Ivy)', probability: 0.27, slotShare: 0.3 },
        { title: 'no family member tonight', probability: 0.18, slotShare: 0.15 },
      ],
    },
  ],
};

describe('TheatricalSetlistView — Beyoncé worked example', () => {
  it('renders the confidence banner with THEATRICAL archetype label', () => {
    const { getByTestId } = render(
      <TheatricalSetlistView prediction={BEYONCE_PREDICTION} />,
    );
    const banner = getByTestId('setlist-confidence-banner-theatrical');
    assert.ok(banner.textContent?.includes('THEATRICAL'));
    assert.ok(banner.textContent?.includes('Cowboy Carter Tour'));
    cleanup();
  });

  it('renders an ActDivider per act in setlist order', () => {
    const { getAllByTestId } = render(
      <TheatricalSetlistView prediction={BEYONCE_PREDICTION} />,
    );
    const dividers = getAllByTestId('act-divider');
    const labels = dividers.map((d) => d.getAttribute('data-act'));
    assert.deepEqual(labels, ['Act I', 'Act II', 'Encore', 'Act V', 'Act VII']);
    cleanup();
  });

  it('renders deterministic rows under their act', () => {
    const { getAllByTestId } = render(
      <TheatricalSetlistView prediction={BEYONCE_PREDICTION} />,
    );
    const rows = getAllByTestId('theatrical-row');
    assert.equal(rows.length, BEYONCE_PREDICTION.deterministicSetlist.length);
    assert.ok(rows.some((r) => r.getAttribute('data-title') === 'AMERICAN REQUIEM'));
    assert.ok(rows.some((r) => r.getAttribute('data-title') === 'AMEN'));
    cleanup();
  });

  it('renders rotating slot cards inline with the program', () => {
    const { getAllByTestId } = render(
      <TheatricalSetlistView prediction={BEYONCE_PREDICTION} />,
    );
    const cards = getAllByTestId('rotating-slot-card');
    assert.equal(cards.length, 2);
    const slotNames = cards.map((c) => c.getAttribute('data-slot-name'));
    assert.ok(slotNames.includes('Variable · Act V · slot 2'));
    assert.ok(slotNames.includes('Variable · Act VII · slot 1'));
    cleanup();
  });

  it('renders every candidate inside a rotating-slot card', () => {
    const { getAllByTestId } = render(
      <TheatricalSetlistView prediction={BEYONCE_PREDICTION} />,
    );
    const candidates = getAllByTestId('rotating-slot-candidate');
    const titles = candidates.map((c) => c.getAttribute('data-title'));
    assert.ok(titles.includes('DAUGHTER'));
    assert.ok(titles.includes('PROTECTOR (with Rumi)'));
    cleanup();
  });

  it('surfaces the prediction copy block', () => {
    const { getByTestId } = render(
      <TheatricalSetlistView prediction={BEYONCE_PREDICTION} />,
    );
    const copy = getByTestId('theatrical-copy');
    assert.ok(copy.textContent?.includes('choreographed'));
    cleanup();
  });
});

describe('ActDivider — primitive', () => {
  it('emits the act label with the mono-caps treatment', () => {
    const { getByTestId } = render(<ActDivider label="Act V" />);
    const div = getByTestId('act-divider');
    assert.equal(div.getAttribute('data-act'), 'Act V');
    assert.ok(div.textContent?.includes('Act V'));
    cleanup();
  });
});

describe('RotatingSlotCard — primitive', () => {
  it('renders the slot name and every candidate', () => {
    const slot: TheatricalPrediction['rotatingSlots'][number] = {
      act: 'Act V',
      actIndex: 4,
      positionInAct: 1,
      slotName: 'Variable · Act V · slot 2',
      candidates: [
        { title: 'A', probability: 0.5, slotShare: 0.5 },
        { title: 'B', probability: 0.5, slotShare: 0.5 },
      ],
    };
    const { getByTestId, getAllByTestId } = render(<RotatingSlotCard slot={slot} />);
    const card = getByTestId('rotating-slot-card');
    assert.equal(card.getAttribute('data-slot-name'), 'Variable · Act V · slot 2');
    const candidates = getAllByTestId('rotating-slot-candidate');
    assert.equal(candidates.length, 2);
    cleanup();
  });
});
