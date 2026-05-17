import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';
import { ExternalSourceDisclaimer } from '../external-connection/ExternalSourceDisclaimer';

describe('ExternalSourceDisclaimer', () => {
  it('renders the spotify disclaimer with all three bullets', () => {
    const { getByText, getByTestId } = render(
      <ExternalSourceDisclaimer source="spotify" />,
    );
    assert.ok(getByTestId('disclaimer-spotify'));
    assert.ok(getByText(/Spotify display name and an access token/));
    assert.ok(getByText(/Builds Hype and Heard playlists/));
    assert.ok(getByText(/Disconnect anytime in Preferences/));
    cleanup();
  });

  it('renders the setlist.fm disclaimer (no token / username only)', () => {
    const { getByText } = render(
      <ExternalSourceDisclaimer source="setlistfm" />,
    );
    assert.ok(getByText(/setlist\.fm username/));
    assert.ok(getByText(/Pulls every concert you've marked attended/));
    cleanup();
  });

  it('renders the gmail disclaimer noting nothing is persisted from the inbox', () => {
    const { getByText } = render(
      <ExternalSourceDisclaimer source="gmail" />,
    );
    assert.ok(getByText(/Nothing from your inbox/));
    assert.ok(getByText(/Read-only access\. Revoke anytime/));
    cleanup();
  });

  it('renders the eventbrite disclaimer noting only saved-show data is retained', () => {
    const { getByText } = render(
      <ExternalSourceDisclaimer source="eventbrite" />,
    );
    assert.ok(getByText(/access token to fetch your past Eventbrite orders/));
    assert.ok(getByText(/Revoke anytime from your Eventbrite account/));
    cleanup();
  });

  it('renders the eyebrow label so users know this is the data-disclosure block', () => {
    const { getByText } = render(
      <ExternalSourceDisclaimer source="spotify" />,
    );
    assert.ok(getByText(/What we store/i));
    cleanup();
  });
});
