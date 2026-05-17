/**
 * ExternalSourceDisclaimer tests — verifies the three-bullet
 * disclosure block renders source-specific copy for every supported
 * external source, plus the shared "WHAT WE STORE" eyebrow. Uses the
 * same RN stubbing pattern as SetlistRow / VenueTypeahead tests.
 */

require('./_setup-rn-mocks.cjs');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { ThemeProvider } = require('../../lib/theme.ts');
const { ExternalSourceDisclaimer } = require('../ExternalSourceDisclaimer.tsx');

function renderDisclaimer(source) {
  let renderer;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(ExternalSourceDisclaimer, { source }),
      ),
    );
  });
  return renderer;
}

function allText(renderer) {
  return renderer.root
    .findAllByType('rn-text')
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')))
    .join('\n');
}

describe('ExternalSourceDisclaimer', () => {
  it('renders the spotify disclaimer with all three bullets', () => {
    const text = allText(renderDisclaimer('spotify'));
    assert.match(text, /Spotify display name and an access token/);
    assert.match(text, /Builds Hype and Heard playlists/);
    assert.match(text, /Disconnect anytime in Preferences/);
  });

  it('renders the setlist.fm disclaimer (no token / username only)', () => {
    const text = allText(renderDisclaimer('setlistfm'));
    assert.match(text, /setlist\.fm username/);
    assert.match(text, /Pulls every concert you've marked attended/);
  });

  it('renders the gmail disclaimer noting nothing is persisted from the inbox', () => {
    const text = allText(renderDisclaimer('gmail'));
    assert.match(text, /Nothing from your inbox/);
    assert.match(text, /Read-only access\. Revoke anytime/);
  });

  it('renders the eventbrite disclaimer noting only saved-show data is retained', () => {
    const text = allText(renderDisclaimer('eventbrite'));
    assert.match(text, /access token to fetch your past Eventbrite orders/);
    assert.match(text, /Revoke anytime from your Eventbrite account/);
  });

  it('renders the shared eyebrow on every source', () => {
    for (const source of ['spotify', 'setlistfm', 'gmail', 'eventbrite']) {
      const text = allText(renderDisclaimer(source));
      assert.match(text, /WHAT WE STORE/, `eyebrow missing for ${source}`);
    }
  });
});
