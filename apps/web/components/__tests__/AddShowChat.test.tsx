/**
 * Component test for the chat-mode Ticketmaster matching step. After
 * the LLM parse, an upcoming show triggers a "did you mean one of
 * these?" event picker; picking a match hands the event to the parent
 * (which prefills the Form tab). Past shows skip the lookup entirely
 * because Ticketmaster's catalogue only exposes upcoming events.
 *
 * `next/navigation` is module-mocked so `useRouter()` resolves outside
 * an App Router context. The trpc mutations are passed as plain prop
 * objects, so no trpc provider is needed.
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ChatParsedResult, TMResult } from '../../app/(app)/add/types';

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {} }),
  },
});

let AddShowChatMod: typeof import('../add/AddShowChat');
before(async () => {
  AddShowChatMod = await import('../add/AddShowChat');
});
beforeEach(() => cleanup());

const futureParsed: ChatParsedResult = {
  headliner: 'Radiohead',
  venue_hint: 'MSG',
  date_hint: '2099-12-31',
  seat_hint: 'Sec 204',
  kind_hint: 'concert',
};

const pastParsed: ChatParsedResult = {
  headliner: 'Radiohead',
  venue_hint: 'MSG',
  date_hint: '2000-01-01',
  seat_hint: null,
  kind_hint: 'concert',
};

const futureMatch: TMResult = {
  tmEventId: 'evt1',
  name: 'Radiohead at Madison Square Garden',
  date: '2099-12-31',
  venueName: 'Madison Square Garden',
  venueCity: 'New York',
  venueState: 'NY',
  venueCountry: 'US',
  venueTmId: 'tmv1',
  venueLat: 40.75,
  venueLng: -73.99,
  kind: 'concert',
  performers: [{ name: 'Radiohead', tmAttractionId: 'att1', imageUrl: null }],
};

function makeProps(opts: {
  parsed: ChatParsedResult;
  matches?: TMResult[];
  searchTMEvents?: (args: unknown) => Promise<TMResult[]>;
  onTmEventSelected?: (result: TMResult, seatHint: string | null) => void;
}) {
  return {
    parseChat: { isPending: false, mutateAsync: async () => opts.parsed },
    createShow: {
      isPending: false,
      mutateAsync: async () => ({ id: 'show-1' }),
    },
    festivalFlowPhase: 'idle',
    onFestivalFile: () => {},
    searchTMEvents:
      opts.searchTMEvents ?? (async () => opts.matches ?? []),
    onTmEventSelected: opts.onTmEventSelected ?? (() => {}),
  } as unknown as Parameters<typeof AddShowChatMod.AddShowChat>[0];
}

function send(
  el: { getByPlaceholderText: (m: RegExp) => HTMLElement; getByText: (m: string) => HTMLElement },
  text: string,
) {
  fireEvent.change(el.getByPlaceholderText(/Describe your show/), {
    target: { value: text },
  });
  fireEvent.click(el.getByText('Send'));
}

describe('AddShowChat — Ticketmaster matching', () => {
  it('offers TM matches for an upcoming show and hands a pick to the form', async () => {
    const onTmEventSelected = mock.fn();
    const view = render(
      <AddShowChatMod.AddShowChat
        {...makeProps({ parsed: futureParsed, matches: [futureMatch], onTmEventSelected })}
      />,
    );
    send(view, 'Going to see Radiohead at MSG on Dec 31 2099');

    const matchName = await view.findByText('Radiohead at Madison Square Garden');
    fireEvent.click(matchName.closest('button')!);

    assert.equal(onTmEventSelected.mock.calls.length, 1);
    const [picked, seat] = onTmEventSelected.mock.calls[0]!.arguments;
    assert.equal((picked as TMResult).tmEventId, 'evt1');
    assert.equal(seat, 'Sec 204');
    cleanup();
  });

  it('skips the Ticketmaster lookup for a past show', async () => {
    const searchTMEvents = mock.fn(async () => [] as TMResult[]);
    const view = render(
      <AddShowChatMod.AddShowChat {...makeProps({ parsed: pastParsed, searchTMEvents })} />,
    );
    send(view, 'Saw Radiohead at MSG on Jan 1 2000');

    await view.findByText('Confirm & Save');
    assert.equal(searchTMEvents.mock.calls.length, 0);
    cleanup();
  });

  it('falls back to confirm-and-save when the user rejects all matches', async () => {
    const view = render(
      <AddShowChatMod.AddShowChat
        {...makeProps({ parsed: futureParsed, matches: [futureMatch] })}
      />,
    );
    send(view, 'Going to see Radiohead at MSG on Dec 31 2099');

    await view.findByText('Radiohead at Madison Square Garden');
    // The plain confirm button is hidden while matches are on screen.
    assert.equal(view.queryByText('Confirm & Save'), null);

    fireEvent.click(view.getByText('None of these'));
    await view.findByText('Confirm & Save');
    cleanup();
  });

  it('falls back to confirm-and-save when Ticketmaster returns no matches', async () => {
    const view = render(
      <AddShowChatMod.AddShowChat {...makeProps({ parsed: futureParsed, matches: [] })} />,
    );
    send(view, 'Going to see Radiohead at MSG on Dec 31 2099');

    await view.findByText('Confirm & Save');
    cleanup();
  });
});
