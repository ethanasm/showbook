import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { KindBadge } from '../design-system/KindBadge';

const cases: Array<['concert' | 'theatre' | 'comedy' | 'festival', string]> = [
  ['concert', 'Concert'],
  ['theatre', 'Theatre'],
  ['comedy', 'Comedy'],
  ['festival', 'Festival'],
];

describe('KindBadge', () => {
  for (const [kind, label] of cases) {
    it(`renders the label for ${kind}`, () => {
      const { getByText } = render(<KindBadge kind={kind} />);
      const el = getByText(label);
      assert.match(el.className, new RegExp(`kind-badge--${kind}`));
      cleanup();
    });
  }
});
