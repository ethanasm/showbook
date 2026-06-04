/**
 * DeleteShowConfirmModal render + interaction tests. Mounts the
 * component via @testing-library/react under jsdom (configured in
 * test-setup.ts).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DeleteShowConfirmModal } from '../show-tabs/DeleteShowConfirmModal';

function renderModal(args?: {
  showName?: string;
  deleting?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  return render(
    <DeleteShowConfirmModal
      showName={args?.showName ?? 'Radiohead'}
      deleting={args?.deleting ?? false}
      onConfirm={args?.onConfirm ?? (() => undefined)}
      onCancel={args?.onCancel ?? (() => undefined)}
    />,
  );
}

describe('DeleteShowConfirmModal', () => {
  test('renders the show name and both Delete / Cancel actions', () => {
    const { getByTestId } = renderModal({ showName: 'Radiohead' });
    const modal = getByTestId('delete-show-modal');
    assert.ok(modal.textContent?.includes('Radiohead'));
    assert.equal(getByTestId('delete-show-confirm').textContent, 'Delete');
    assert.equal(getByTestId('delete-show-cancel').textContent, 'Cancel');
    cleanup();
  });

  test('falls back to "this show" when no name is supplied', () => {
    const { getByTestId } = renderModal({ showName: '' });
    assert.ok(getByTestId('delete-show-modal').textContent?.includes('this show'));
    cleanup();
  });

  test('fires onConfirm when Delete is clicked', () => {
    let confirmed = 0;
    const { getByTestId } = renderModal({ onConfirm: () => (confirmed += 1) });
    fireEvent.click(getByTestId('delete-show-confirm'));
    assert.equal(confirmed, 1);
    cleanup();
  });

  test('fires onCancel when Cancel is clicked', () => {
    let cancelled = 0;
    const { getByTestId } = renderModal({ onCancel: () => (cancelled += 1) });
    fireEvent.click(getByTestId('delete-show-cancel'));
    assert.equal(cancelled, 1);
    cleanup();
  });

  test('fires onCancel on backdrop click', () => {
    let cancelled = 0;
    const { getByTestId } = renderModal({ onCancel: () => (cancelled += 1) });
    fireEvent.click(getByTestId('delete-show-modal'));
    assert.equal(cancelled, 1);
    cleanup();
  });

  test('fires onCancel on Escape', () => {
    let cancelled = 0;
    renderModal({ onCancel: () => (cancelled += 1) });
    fireEvent.keyDown(window, { key: 'Escape' });
    assert.equal(cancelled, 1);
    cleanup();
  });

  test('shows the in-flight label and disables both buttons while deleting', () => {
    let confirmed = 0;
    let cancelled = 0;
    const { getByTestId } = renderModal({
      deleting: true,
      onConfirm: () => (confirmed += 1),
      onCancel: () => (cancelled += 1),
    });
    const confirmBtn = getByTestId('delete-show-confirm') as HTMLButtonElement;
    const cancelBtn = getByTestId('delete-show-cancel') as HTMLButtonElement;
    assert.equal(confirmBtn.textContent, 'Deleting…');
    assert.equal(confirmBtn.disabled, true);
    assert.equal(cancelBtn.disabled, true);
    // Disabled buttons don't dispatch click handlers.
    fireEvent.click(confirmBtn);
    fireEvent.click(cancelBtn);
    assert.equal(confirmed, 0);
    assert.equal(cancelled, 0);
    // Escape is also suppressed while a delete is in flight.
    fireEvent.keyDown(window, { key: 'Escape' });
    assert.equal(cancelled, 0);
    cleanup();
  });
});
