/**
 * Component test for the post-save toast on the Add page: undo stays a
 * one-click action, and the follow-seeding chips run the injected
 * follow handlers and flip to "Following" on success (or roll back to
 * tappable on failure). The component is rendered directly — in prod
 * it mounts via `toast.custom` outside the provider tree, so all
 * collaboration happens through the injected handlers.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { ShowAddedToast } from '../add/ShowAddedToast';

beforeEach(() => cleanup());

const PERFORMER = { id: 'perf-1', name: 'Radiohead' };
const VENUE = { id: 'venue-1', name: 'Madison Square Garden' };

function noopHandlers() {
  return {
    onUndo: () => {},
    onFollowPerformer: async () => {},
    onFollowVenue: async () => {},
  };
}

describe('ShowAddedToast', () => {
  it('renders follow chips for the suggested performer and venue', () => {
    const { getAllByTestId, getByText } = render(
      <ShowAddedToast
        toastId="t1"
        performer={PERFORMER}
        venue={VENUE}
        {...noopHandlers()}
      />,
    );
    assert.equal(getAllByTestId('show-added-follow-chip').length, 2);
    assert.ok(getByText('Follow Radiohead'));
    assert.ok(getByText('Follow Madison Square Garden'));
  });

  it('omits the chips section when there is nothing to follow', () => {
    const { queryByTestId, getByText } = render(
      <ShowAddedToast
        toastId="t1"
        performer={null}
        venue={null}
        {...noopHandlers()}
      />,
    );
    assert.ok(getByText('Show added'));
    assert.equal(queryByTestId('show-added-follow-chip'), null);
  });

  it('clicking a chip runs the follow handler and flips to Following', async () => {
    const followed: string[] = [];
    const { getByText } = render(
      <ShowAddedToast
        toastId="t1"
        performer={PERFORMER}
        venue={null}
        {...noopHandlers()}
        onFollowPerformer={async (id) => {
          followed.push(id);
        }}
      />,
    );
    fireEvent.click(getByText('Follow Radiohead'));
    await waitFor(() => {
      assert.ok(getByText('Following Radiohead'));
    });
    assert.deepEqual(followed, ['perf-1']);
  });

  it('a failed follow returns the chip to a tappable state', async () => {
    let attempts = 0;
    const { getByText, getByTestId } = render(
      <ShowAddedToast
        toastId="t1"
        performer={null}
        venue={VENUE}
        {...noopHandlers()}
        onFollowVenue={async () => {
          attempts += 1;
          throw new Error('network down');
        }}
      />,
    );
    fireEvent.click(getByText('Follow Madison Square Garden'));
    await waitFor(() => {
      const chip = getByTestId('show-added-follow-chip') as HTMLButtonElement;
      assert.equal(chip.disabled, false);
    });
    assert.equal(attempts, 1);
    assert.ok(getByText('Follow Madison Square Garden'));
  });

  it('undo runs the injected handler once', async () => {
    let undos = 0;
    const { getByText } = render(
      <ShowAddedToast
        toastId="t1"
        performer={null}
        venue={null}
        {...noopHandlers()}
        onUndo={() => {
          undos += 1;
        }}
      />,
    );
    fireEvent.click(getByText('Undo'));
    await waitFor(() => assert.equal(undos, 1));
  });
});
