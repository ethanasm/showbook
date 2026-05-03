import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { EmptyState } from '../design-system/EmptyState';

describe('EmptyState', () => {
  it('renders kind-specific eyebrow', () => {
    const { getByText } = render(
      <EmptyState kind="shows" title="No shows yet" body="Add one." />,
    );
    assert.ok(getByText('Your live-show log'));
    cleanup();
  });

  it('artists eyebrow acknowledges follows, not just attended shows', () => {
    const { getByText } = render(
      <EmptyState kind="artists" title="No artists" body="" />,
    );
    assert.ok(
      getByText('Artists from your shows and follows'),
      'Eyebrow must not claim users have "seen" artists they only follow.',
    );
    cleanup();
  });

  it('venues eyebrow does not claim user has been there', () => {
    const { getByText } = render(
      <EmptyState kind="venues" title="No venues" body="" />,
    );
    assert.ok(
      getByText('Venues from your shows'),
      'Eyebrow must not claim users have been to venues they only follow.',
    );
    cleanup();
  });

  it('renders body and title text', () => {
    const { getByText } = render(
      <EmptyState kind="venues" title="No venues" body="Find one." />,
    );
    assert.ok(getByText('Find one.'));
    cleanup();
  });

  it('wraps the last word of multi-word titles in a gradient span', () => {
    const { container } = render(
      <EmptyState kind="artists" title="No artists yet" body="" />,
    );
    const span = container.querySelector('.gradient-emphasis');
    assert.ok(span);
    assert.equal(span?.textContent, 'yet');
    cleanup();
  });

  it('wraps single-word title entirely in a gradient span', () => {
    const { container } = render(
      <EmptyState kind="discover" title="Empty" body="" />,
    );
    const span = container.querySelector('.gradient-emphasis');
    assert.equal(span?.textContent, 'Empty');
    cleanup();
  });

  it('renders the action when provided', () => {
    const { getByText } = render(
      <EmptyState
        kind="map"
        title="X"
        body="Y"
        action={<button type="button">Add show</button>}
      />,
    );
    assert.ok(getByText('Add show'));
    cleanup();
  });

  it('passes through ReactNode titles unchanged', () => {
    const { container } = render(
      <EmptyState kind="shows" title={<em data-testid="t">Custom</em>} body="" />,
    );
    assert.ok(container.querySelector('em'));
    cleanup();
  });
});
