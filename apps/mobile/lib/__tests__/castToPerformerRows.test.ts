import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  castToPerformerRows,
  mergeCastRows,
} from '../playbill/castToPerformerRows';
import type { PerformerRow } from '../showForm';

let counter = 0;
const newId = () => `id-${(counter += 1)}`;

describe('castToPerformerRows', () => {
  it('maps actor/role to cast rows with characterName', () => {
    counter = 0;
    const rows = castToPerformerRows(
      [
        { actor: 'Cole Escola', role: 'Mary Todd Lincoln' },
        { actor: 'Conrad Ricamora', role: "Mary's Husband" },
      ],
      newId,
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      id: 'id-1',
      name: 'Cole Escola',
      characterName: 'Mary Todd Lincoln',
    });
    assert.equal(rows[1].name, 'Conrad Ricamora');
    assert.equal(rows[1].characterName, "Mary's Husband");
  });

  it('omits characterName when role is blank and skips blank actors', () => {
    const rows = castToPerformerRows(
      [
        { actor: '  ', role: 'Nobody' },
        { actor: 'Solo Performer', role: '' },
      ],
      newId,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Solo Performer');
    assert.equal('characterName' in rows[0], false);
  });

  it('dedupes repeated actor names case-insensitively', () => {
    const rows = castToPerformerRows(
      [
        { actor: 'Audra McDonald', role: 'Mother' },
        { actor: 'audra mcdonald', role: 'Mother (alt)' },
      ],
      newId,
    );
    assert.equal(rows.length, 1);
  });
});

describe('mergeCastRows', () => {
  const row = (name: string): PerformerRow => ({ id: name, name });

  it('drops blank existing rows and appends new names', () => {
    const merged = mergeCastRows(
      [row('Existing'), { id: 'blank', name: '   ' }],
      [{ id: 'x', name: 'New Cast' }],
    );
    assert.deepEqual(
      merged.map((r) => r.name),
      ['Existing', 'New Cast'],
    );
  });

  it('skips extracted names already present (case-insensitive)', () => {
    const merged = mergeCastRows(
      [row('Cole Escola')],
      [
        { id: 'a', name: 'cole escola' },
        { id: 'b', name: 'Betty Gilpin' },
      ],
    );
    assert.deepEqual(
      merged.map((r) => r.name),
      ['Cole Escola', 'Betty Gilpin'],
    );
  });
});
