/**
 * Smoke tests for the show-accessors module that lives in
 * @showbook/shared. The deep behavioural coverage lives at
 * `apps/web/lib/__tests__/show-accessors.test.ts` (predates the
 * lift); these tests pin the package entry point so we don't
 * accidentally regress the export surface that server-side
 * procedures (and the web client) import.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getHeadliner,
  getHeadlinerId,
  getSupportPerformers,
  hasProductionLabel,
  isProductionShow,
  pickHeadliner,
  type ShowLike,
} from '../show-accessors';

function makeShow(
  overrides: Partial<ShowLike> & {
    showPerformers?: ShowLike['showPerformers'];
  },
): ShowLike {
  return {
    kind: 'concert',
    productionName: null,
    showPerformers: [],
    ...overrides,
  };
}

describe('show-accessors (api re-export)', () => {
  it('pickHeadliner prefers role=headliner + sortOrder=0', () => {
    const show = makeShow({
      showPerformers: [
        { role: 'support', sortOrder: 0, performer: { id: 's1', name: 'Support' } },
        { role: 'headliner', sortOrder: 1, performer: { id: 'h1', name: 'H1' } },
        { role: 'headliner', sortOrder: 0, performer: { id: 'h0', name: 'H0' } },
      ],
    });
    assert.equal(pickHeadliner(show)?.performer.id, 'h0');
  });

  it('pickHeadliner falls back to first row when no headliner role', () => {
    const show = makeShow({
      showPerformers: [
        { role: 'cast', sortOrder: 0, performer: { id: 'c1', name: 'Cast' } },
      ],
    });
    assert.equal(pickHeadliner(show)?.performer.id, 'c1');
  });

  it('getHeadliner returns productionName for theatre/festival production shows', () => {
    assert.equal(
      getHeadliner(
        makeShow({ kind: 'theatre', productionName: 'Hadestown' }),
      ),
      'Hadestown',
    );
  });

  it('getHeadlinerId returns undefined for production shows', () => {
    assert.equal(
      getHeadlinerId(
        makeShow({
          kind: 'theatre',
          productionName: 'Hadestown',
          showPerformers: [
            {
              role: 'headliner',
              sortOrder: 0,
              performer: { id: 'p1', name: 'Lead Actor' },
            },
          ],
        }),
      ),
      undefined,
    );
  });

  it('getHeadlinerId returns the resolved performer id for concert shows', () => {
    assert.equal(
      getHeadlinerId(
        makeShow({
          showPerformers: [
            {
              role: 'headliner',
              sortOrder: 0,
              performer: { id: 'p1', name: 'Phoebe' },
            },
          ],
        }),
      ),
      'p1',
    );
  });

  it('isProductionShow is theatre-only (festivals are multi-artist, not scripted)', () => {
    assert.equal(
      isProductionShow(makeShow({ kind: 'theatre', productionName: 'X' })),
      true,
    );
    assert.equal(
      isProductionShow(makeShow({ kind: 'theatre', productionName: null })),
      false,
    );
    assert.equal(
      isProductionShow(makeShow({ kind: 'concert', productionName: 'X' })),
      false,
    );
    assert.equal(
      isProductionShow(makeShow({ kind: 'festival', productionName: 'Bottlerock' })),
      false,
      'festivals are not production shows even with a productionName',
    );
  });

  it('hasProductionLabel covers theatre and festival rows with a productionName', () => {
    assert.equal(
      hasProductionLabel(makeShow({ kind: 'theatre', productionName: 'X' })),
      true,
    );
    assert.equal(
      hasProductionLabel(makeShow({ kind: 'festival', productionName: 'Bottlerock' })),
      true,
    );
    assert.equal(
      hasProductionLabel(makeShow({ kind: 'festival', productionName: null })),
      false,
    );
    assert.equal(
      hasProductionLabel(makeShow({ kind: 'concert', productionName: 'X' })),
      false,
    );
  });

  it('getHeadlinerId returns the headliner for festivals with a productionName', () => {
    const show = makeShow({
      kind: 'festival',
      productionName: 'Bottlerock',
      showPerformers: [
        { role: 'headliner', sortOrder: 0, performer: { id: 'lorde', name: 'Lorde' } },
        { role: 'support', sortOrder: 1, performer: { id: 'tash', name: 'Tash Sultana' } },
      ],
    });
    assert.equal(getHeadlinerId(show), 'lorde');
  });

  it('getHeadliner still surfaces the productionName label for festivals', () => {
    const show = makeShow({
      kind: 'festival',
      productionName: 'Bottlerock',
      showPerformers: [
        { role: 'headliner', sortOrder: 0, performer: { id: 'lorde', name: 'Lorde' } },
      ],
    });
    assert.equal(getHeadliner(show), 'Bottlerock');
  });

  it('getSupportPerformers returns ids sorted by sortOrder', () => {
    const show = makeShow({
      showPerformers: [
        { role: 'support', sortOrder: 2, performer: { id: 's2', name: 'Two' } },
        { role: 'support', sortOrder: 0, performer: { id: 's0', name: 'Zero' } },
        { role: 'headliner', sortOrder: 0, performer: { id: 'h', name: 'H' } },
        { role: 'support', sortOrder: 1, performer: { id: 's1', name: 'One' } },
      ],
    });
    assert.deepEqual(
      getSupportPerformers(show).map((p) => p.id),
      ['s0', 's1', 's2'],
    );
  });
});
