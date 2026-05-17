import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { QueryBoundary } from '../design-system/QueryBoundary';

describe('QueryBoundary', () => {
  it('renders loading label when isLoading is true', () => {
    const { getByText } = render(
      <QueryBoundary
        query={{ isLoading: true, error: undefined, data: undefined }}
        loadingLabel="Loading show…"
      >
        {() => <div>never</div>}
      </QueryBoundary>,
    );
    assert.ok(getByText('Loading show…'));
    cleanup();
  });

  it('renders default error label when error is present', () => {
    const { getByText } = render(
      <QueryBoundary
        query={{ isLoading: false, error: new Error('boom'), data: undefined }}
      >
        {() => <div>never</div>}
      </QueryBoundary>,
    );
    assert.ok(getByText("Couldn't load."));
    cleanup();
  });

  it('renders custom errorFallback when provided', () => {
    const { getByText } = render(
      <QueryBoundary
        query={{ isLoading: false, error: new Error('boom'), data: undefined }}
        errorFallback={(err) => <div>Custom: {(err as Error).message}</div>}
      >
        {() => <div>never</div>}
      </QueryBoundary>,
    );
    assert.ok(getByText('Custom: boom'));
    cleanup();
  });

  it('treats undefined data without error as a load failure', () => {
    const { getByText } = render(
      <QueryBoundary
        query={{ isLoading: false, error: undefined, data: undefined }}
        errorLabel="Missing."
      >
        {() => <div>never</div>}
      </QueryBoundary>,
    );
    assert.ok(getByText('Missing.'));
    cleanup();
  });

  it('renders children with data on success', () => {
    const { getByText } = render(
      <QueryBoundary
        query={{ isLoading: false, error: undefined, data: { name: 'Hamilton' } }}
      >
        {(data) => <div>Hello {data.name}</div>}
      </QueryBoundary>,
    );
    assert.ok(getByText('Hello Hamilton'));
    cleanup();
  });

  it('renders emptyFallback when isEmpty predicate matches', () => {
    const { getByText } = render(
      <QueryBoundary
        query={{ isLoading: false, error: undefined, data: [] as string[] }}
        isEmpty={(d) => d.length === 0}
        emptyFallback={<div>No items.</div>}
      >
        {() => <div>list</div>}
      </QueryBoundary>,
    );
    assert.ok(getByText('No items.'));
    cleanup();
  });

  it('ignores isEmpty when emptyFallback is omitted', () => {
    const { getByText } = render(
      <QueryBoundary
        query={{ isLoading: false, error: undefined, data: [] as string[] }}
        isEmpty={(d) => d.length === 0}
      >
        {(d) => <div>count={d.length}</div>}
      </QueryBoundary>,
    );
    assert.ok(getByText('count=0'));
    cleanup();
  });
});
