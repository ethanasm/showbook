/**
 * Unit tests for `lib/showForm` — the kind-aware serializer that
 * powers the mobile add/edit show forms.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShowFormFromDetail,
  emptyShowFormValues,
  serializeShowFormForKind,
  type PerformerRow,
  type ShowDetailLite,
  type ShowFormValues,
} from '../showForm';

function makeRow(partial: Partial<PerformerRow> & { name: string }): PerformerRow {
  return {
    id: partial.id ?? `row-${partial.name}`,
    name: partial.name,
    characterName: partial.characterName,
    tier: partial.tier,
    tmAttractionId: partial.tmAttractionId,
    musicbrainzId: partial.musicbrainzId,
    imageUrl: partial.imageUrl,
  };
}

function makeValues(overrides: Partial<ShowFormValues>): ShowFormValues {
  return emptyShowFormValues({
    kind: 'concert',
    title: 'Big Thief',
    venueQuery: '',
    venue: { name: 'Bowery Ballroom', city: 'New York', stateRegion: 'NY' },
    date: '2026-04-12',
    ticketCount: '2',
    ...overrides,
  });
}

describe('serializeShowFormForKind', () => {
  it('concert: title becomes headliner, rows become support, tourName and seat retained', () => {
    const values = makeValues({
      kind: 'concert',
      title: 'Big Thief',
      tourName: 'Dragon New Warm Mountain',
      seat: 'GA Floor',
      pricePaid: '45.00',
      notes: 'Stood by the soundboard',
      performers: [
        makeRow({ name: 'Indigo De Souza' }),
        makeRow({ name: 'Florist', tmAttractionId: 'K8vZ9' }),
      ],
    });
    const out = serializeShowFormForKind(values);
    assert.equal(out.kind, 'concert');
    assert.equal(out.headliner.name, 'Big Thief');
    assert.equal(out.tourName, 'Dragon New Warm Mountain');
    assert.equal(out.seat, 'GA Floor');
    assert.equal(out.pricePaid, '45.00');
    assert.equal(out.notes, 'Stood by the soundboard');
    assert.equal(out.productionName, undefined);
    assert.equal(out.endDate, undefined);
    assert.deepEqual(out.performers, [
      { name: 'Indigo De Souza', role: 'support', sortOrder: 1 },
      { name: 'Florist', role: 'support', sortOrder: 2, tmAttractionId: 'K8vZ9' },
    ]);
  });

  it('theatre: title fills productionName + headliner.name, rows become cast with characterName', () => {
    const values = makeValues({
      kind: 'theatre',
      title: 'Hadestown',
      tourName: '<ignored on theatre>',
      seat: 'Orch C12',
      performers: [
        makeRow({ name: 'Eva Noblezada', characterName: 'Eurydice' }),
        makeRow({ name: 'André De Shields', characterName: 'Hermes' }),
        makeRow({ name: 'Patrick Page' }),
      ],
    });
    const out = serializeShowFormForKind(values);
    assert.equal(out.kind, 'theatre');
    assert.equal(out.headliner.name, 'Hadestown');
    assert.equal(out.productionName, 'Hadestown');
    assert.equal(out.tourName, undefined); // dropped on theatre
    assert.equal(out.seat, 'Orch C12');
    assert.deepEqual(out.performers, [
      { name: 'Eva Noblezada', role: 'cast', characterName: 'Eurydice', sortOrder: 1 },
      { name: 'André De Shields', role: 'cast', characterName: 'Hermes', sortOrder: 2 },
      { name: 'Patrick Page', role: 'cast', sortOrder: 3 },
    ]);
  });

  it('comedy: title becomes headliner, rows become support (no tier toggle)', () => {
    const values = makeValues({
      kind: 'comedy',
      title: 'John Mulaney',
      tourName: 'should be dropped',
      performers: [
        makeRow({ name: 'Jacqueline Novak', tier: 'headliner' }), // tier ignored on comedy
        makeRow({ name: 'Pete Lee' }),
      ],
    });
    const out = serializeShowFormForKind(values);
    assert.equal(out.kind, 'comedy');
    assert.equal(out.headliner.name, 'John Mulaney');
    assert.equal(out.tourName, undefined);
    assert.equal(out.productionName, undefined);
    assert.deepEqual(out.performers, [
      { name: 'Jacqueline Novak', role: 'support', sortOrder: 1 },
      { name: 'Pete Lee', role: 'support', sortOrder: 2 },
    ]);
  });

  it('festival: title fills productionName, rows projected by tier, endDate retained, seat dropped', () => {
    const values = makeValues({
      kind: 'festival',
      title: 'Pitchfork Festival',
      seat: 'should be dropped on festival',
      endDate: '2026-07-19',
      performers: [
        makeRow({ name: 'Black Pumas', tier: 'headliner', tmAttractionId: 'K8vZ_BP' }),
        makeRow({ name: 'Yves Tumor', tier: 'support' }),
        makeRow({ name: 'Caroline Polachek' }), // default tier = support
      ],
    });
    const out = serializeShowFormForKind(values);
    assert.equal(out.kind, 'festival');
    assert.equal(out.headliner.name, 'Pitchfork Festival');
    assert.equal(out.productionName, 'Pitchfork Festival');
    assert.equal(out.endDate, '2026-07-19');
    assert.equal(out.seat, undefined);
    assert.deepEqual(out.performers, [
      { name: 'Black Pumas', role: 'headliner', sortOrder: 1, tmAttractionId: 'K8vZ_BP' },
      { name: 'Yves Tumor', role: 'support', sortOrder: 2 },
      { name: 'Caroline Polachek', role: 'support', sortOrder: 3 },
    ]);
  });

  it('festival: a lineup row whose name matches the festival name is dropped to avoid PK collision', () => {
    const values = makeValues({
      kind: 'festival',
      title: 'Coachella',
      performers: [
        makeRow({ name: 'Coachella', tier: 'headliner' }), // would clash with synthetic headliner
        makeRow({ name: 'Lana Del Rey', tier: 'headliner' }),
      ],
    });
    const out = serializeShowFormForKind(values);
    assert.deepEqual(out.performers, [
      { name: 'Lana Del Rey', role: 'headliner', sortOrder: 1 },
    ]);
  });

  it('festival: headliner enrichment inherits IDs from a matching lineup row', () => {
    const values = makeValues({
      kind: 'festival',
      title: 'Lollapalooza',
      performers: [
        // Tour-typeahead-picked headliner that also happens to be the festival name
        // is unlikely, but the helper supports it for symmetry. In the realistic
        // case the synthetic headliner stays a free-text {name}, which is also fine.
        makeRow({ name: 'Tame Impala', tier: 'headliner', tmAttractionId: 'tm-tame' }),
      ],
    });
    const out = serializeShowFormForKind(values);
    assert.equal(out.headliner.tmAttractionId, undefined); // festival name has no row
    // Lineup keeps the enriched row
    assert.deepEqual(out.performers, [
      { name: 'Tame Impala', role: 'headliner', sortOrder: 1, tmAttractionId: 'tm-tame' },
    ]);
  });

  it('empty rows / whitespace rows are dropped', () => {
    const values = makeValues({
      kind: 'concert',
      performers: [
        makeRow({ name: '' }),
        makeRow({ name: '   ' }),
        makeRow({ name: 'Real Estate' }),
      ],
    });
    const out = serializeShowFormForKind(values);
    assert.deepEqual(out.performers, [{ name: 'Real Estate', role: 'support', sortOrder: 1 }]);
  });

  it('numeric ticketCount is clamped to >= 1', () => {
    const a = serializeShowFormForKind(makeValues({ ticketCount: '0' }));
    const b = serializeShowFormForKind(makeValues({ ticketCount: '' }));
    const c = serializeShowFormForKind(makeValues({ ticketCount: '3' }));
    assert.equal(a.ticketCount, 1);
    assert.equal(b.ticketCount, 1);
    assert.equal(c.ticketCount, 3);
  });

  it('venue payload uses the picked venue when present, otherwise the typed query', () => {
    const picked = serializeShowFormForKind(
      makeValues({
        venue: { name: 'Madison Square Garden', city: 'New York', stateRegion: 'NY', country: 'US' },
      }),
    );
    assert.deepEqual(picked.venue, {
      name: 'Madison Square Garden',
      city: 'New York',
      stateRegion: 'NY',
      country: 'US',
    });

    const typed = serializeShowFormForKind(
      makeValues({ venue: null, venueQuery: '  Webster Hall ' }),
    );
    assert.deepEqual(typed.venue, { name: 'Webster Hall', city: 'Unknown' });
  });

  it('cross-kind: switching kind keeps the same field data but projects differently', () => {
    const values = makeValues({
      kind: 'concert',
      title: 'Some Headliner',
      tourName: 'A Tour',
      seat: 'GA',
      endDate: '2026-09-09',
      performers: [
        makeRow({ name: 'Opener One', characterName: 'Hermes', tier: 'headliner' }),
        makeRow({ name: 'Opener Two' }),
      ],
    });

    // Same values, projected to four kinds:
    const concert = serializeShowFormForKind(values, 'concert');
    const theatre = serializeShowFormForKind(values, 'theatre');
    const comedy = serializeShowFormForKind(values, 'comedy');
    const festival = serializeShowFormForKind(values, 'festival');

    // Concert ignores characterName + tier
    assert.deepEqual(
      concert.performers,
      [
        { name: 'Opener One', role: 'support', sortOrder: 1 },
        { name: 'Opener Two', role: 'support', sortOrder: 2 },
      ],
    );
    assert.equal(concert.tourName, 'A Tour');
    assert.equal(concert.seat, 'GA');

    // Theatre uses characterName, ignores tier and tour
    assert.deepEqual(theatre.performers, [
      { name: 'Opener One', role: 'cast', characterName: 'Hermes', sortOrder: 1 },
      { name: 'Opener Two', role: 'cast', sortOrder: 2 },
    ]);
    assert.equal(theatre.tourName, undefined);
    assert.equal(theatre.productionName, 'Some Headliner');

    // Comedy is plain support, no character / no tier
    assert.deepEqual(comedy.performers, [
      { name: 'Opener One', role: 'support', sortOrder: 1 },
      { name: 'Opener Two', role: 'support', sortOrder: 2 },
    ]);
    assert.equal(comedy.tourName, undefined);

    // Festival respects tier (Opener One was headliner, Opener Two defaults to support)
    assert.deepEqual(festival.performers, [
      { name: 'Opener One', role: 'headliner', sortOrder: 1 },
      { name: 'Opener Two', role: 'support', sortOrder: 2 },
    ]);
    assert.equal(festival.seat, undefined);
    assert.equal(festival.endDate, '2026-09-09');
    assert.equal(festival.productionName, 'Some Headliner');
  });
});

describe('buildShowFormFromDetail', () => {
  let idCounter = 0;
  const newRowId = (): string => `id-${++idCounter}`;

  function makeDetail(overrides: Partial<ShowDetailLite>): ShowDetailLite {
    return {
      kind: 'concert',
      date: '2026-04-12',
      endDate: null,
      seat: 'GA',
      pricePaid: '45.00',
      ticketCount: 2,
      tourName: null,
      productionName: null,
      notes: null,
      venue: {
        id: 'venue-1',
        name: 'Bowery Ballroom',
        city: 'New York',
        stateRegion: 'NY',
        country: 'US',
      },
      showPerformers: [],
      ...overrides,
    };
  }

  it('concert: first headliner becomes title, rest become support rows', () => {
    idCounter = 0;
    const values = buildShowFormFromDetail(
      makeDetail({
        showPerformers: [
          {
            role: 'headliner',
            sortOrder: 0,
            performer: { name: 'Big Thief', ticketmasterAttractionId: 'tm-bt' },
          },
          {
            role: 'support',
            sortOrder: 1,
            performer: { name: 'Indigo De Souza' },
          },
        ],
      }),
      newRowId,
    );
    assert.equal(values.title, 'Big Thief');
    assert.equal(values.performers.length, 1);
    assert.equal(values.performers[0].name, 'Indigo De Souza');
    assert.equal(values.performers[0].tier, 'support');
  });

  it('theatre: title hydrates from productionName even when a headliner performer exists', () => {
    idCounter = 0;
    const values = buildShowFormFromDetail(
      makeDetail({
        kind: 'theatre',
        productionName: 'Hadestown',
        showPerformers: [
          {
            role: 'cast',
            sortOrder: 0,
            characterName: 'Eurydice',
            performer: { name: 'Eva Noblezada' },
          },
        ],
      }),
      newRowId,
    );
    assert.equal(values.title, 'Hadestown');
    assert.equal(values.performers.length, 1);
    assert.equal(values.performers[0].name, 'Eva Noblezada');
    assert.equal(values.performers[0].characterName, 'Eurydice');
  });

  it('festival: the synthetic festival-name headliner is excluded from lineup rows', () => {
    idCounter = 0;
    const values = buildShowFormFromDetail(
      makeDetail({
        kind: 'festival',
        productionName: 'Pitchfork Festival',
        endDate: '2026-07-19',
        showPerformers: [
          {
            role: 'headliner',
            sortOrder: 0,
            performer: { name: 'Pitchfork Festival' },
          },
          {
            role: 'headliner',
            sortOrder: 1,
            performer: { name: 'Black Pumas', ticketmasterAttractionId: 'tm-bp' },
          },
          {
            role: 'support',
            sortOrder: 2,
            performer: { name: 'Caroline Polachek' },
          },
        ],
      }),
      newRowId,
    );
    assert.equal(values.title, 'Pitchfork Festival');
    assert.equal(values.endDate, '2026-07-19');
    assert.equal(values.performers.length, 2);
    assert.equal(values.performers[0].name, 'Black Pumas');
    assert.equal(values.performers[0].tier, 'headliner');
    assert.equal(values.performers[0].tmAttractionId, 'tm-bp');
    assert.equal(values.performers[1].name, 'Caroline Polachek');
    assert.equal(values.performers[1].tier, 'support');
  });
});
