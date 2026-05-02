# Feature plan — The Brain (chat with your showbook)

**Goal:** A conversational surface where the user can ask anything
about their showbook in natural language and get back grounded,
verifiable answers — sometimes with a chart, a list, or a "go to this
show" CTA. Examples:

- "What's the smallest venue I've ever seen Phoebe Bridgers at?"
- "How many shows did I go to in 2023?"
- "Who's the artist I saw the most last year but haven't seen yet
  this year?"
- "Build me a Spotify playlist of every song I heard live last summer."
- "Did I go to a show in Tokyo?"
- "What's that show I went to with Sam at MSG, the rainy one?"
- "Find me a concert in NYC next weekend by an artist I follow."

**Why this is the differentiator:** every other live-show tracker is a
form-and-list app. With three years of structured personal data sitting
in Postgres + an LLM that's already wired up (Groq, Langfuse, prompt
caching), Showbook can be the first one that *talks back*. This is
also where the existing observability/LLM-trace/quota infrastructure
pays off — it was designed for exactly this kind of feature.

**Non-goal:** SQL-from-LLM. We are *not* letting the model generate
arbitrary queries. The model gets a fixed tool registry of typed
helpers; every retrieval is a parameterized procedure. This is what
keeps the answer correct, the cost bounded, and the security posture
unchanged.

Status: not started. All prerequisites in place
(`packages/api/src/groq.ts`, `traceLLM` /  `withTrace` from
`@showbook/observability`, the existing tRPC chat-mode parser in the
Add flow as the closest analogy).

---

## 1. Architecture overview

```
┌────────────────────────────────────────────────────────────────────┐
│ User: "What's the smallest venue I've seen Phoebe Bridgers at?"    │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│ tRPC: brain.chat.send  (server-side, withTrace)                    │
│  - Loads conversation thread + last 10 turns from `brain_messages` │
│  - Calls Groq with system prompt + tool registry + history         │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ Groq tool-call loop (max 6 hops):                           │  │
│  │   1. model emits: search_performers({ name: "Phoebe Br..." })│  │
│  │   2. server runs the typed helper, returns rows             │  │
│  │   3. model emits: smallest_venue_for_performer({ id })      │  │
│  │   4. server returns { venue, capacity, show }               │  │
│  │   5. model emits final natural-language reply +             │  │
│  │      a structured `cards` payload                            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  - Persists assistant turn (incl. tool trace) to `brain_messages`  │
│  - Streams text + cards back to client                             │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
                       ▼
                 Chat UI renders text + cards
```

Five things to notice:

1. **Tool-calling, not RAG.** Showbook has a *small*, structured
   dataset (a few thousand rows per power user). Embeddings + vector
   search would be over-engineering. Every question can be answered
   by ≤3 calls to typed helpers. RAG enters only for the user's
   free-text `notes` field (§3d).
2. **Each tool is a tRPC-style procedure** with zod validation. The
   LLM is just choosing *which procedure to call* and *with what
   args*. We control the surface area precisely.
3. **Cards are first-class output.** Replies aren't only text — the
   model can attach a `cards: [{ type: 'show', id }, { type:
   'list', items: [...] }]` payload that the client renders as
   interactive components (tap to open the show, pin to home, etc.).
4. **Threads persist.** Brain isn't a one-shot chat; threads live in
   the DB so the user can scroll back, and so the model has stable
   context across days.
5. **Everything is traced via Langfuse.** `withTrace` wraps the
   tRPC entry; each tool invocation becomes a child span. Cost,
   latency, and tool-choice patterns are visible end-to-end.

---

## 2. Schema

```sql
CREATE TABLE "brain_threads" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text,                                  -- LLM-summarized after first turn
  created_at  timestamp NOT NULL DEFAULT now(),
  last_msg_at timestamp NOT NULL DEFAULT now(),
  archived    boolean NOT NULL DEFAULT false
);
CREATE INDEX brain_threads_user_recent_idx
  ON brain_threads (user_id, archived, last_msg_at DESC);

CREATE TYPE "brain_role" AS ENUM ('user','assistant','tool','system');

CREATE TABLE "brain_messages" (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    uuid NOT NULL REFERENCES brain_threads(id) ON DELETE CASCADE,
  role         brain_role NOT NULL,
  -- For role='assistant': human-readable text
  -- For role='tool': stringified JSON of result
  -- For role='user': verbatim input
  content      text NOT NULL,
  -- For role='assistant', the structured cards payload (see §5):
  cards        jsonb,
  -- For role='assistant', the tool-call history that produced this turn:
  tool_calls   jsonb,
  -- Cost/latency/observability:
  model        text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd     numeric(10,6),
  trace_id     text,    -- Langfuse trace id for this turn
  created_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX brain_messages_thread_created_idx
  ON brain_messages (thread_id, created_at);
```

Pruning: archived threads older than 12 months get hard-deleted by
the existing `prune-orphan-catalog` job (extend it with a "brain
threads" pass).

---

## 3. Tool registry

Each tool is a typed function. The LLM is given a JSON-schema
description of every tool's input and output, plus a system prompt
explaining when to use which.

The registry is grouped by purpose. v1 ships ~25 tools covering 95%
of the questions a user is likely to ask.

### 3a. Identity / scoping helpers

| Tool | Input | Output |
|------|-------|--------|
| `who_am_i` | `{}` | `{ userId, displayName, regions: [...], joinedAt }` |
| `current_date` | `{}` | `{ today: 'YYYY-MM-DD', tz }` |

The model can't reach the system clock directly; it asks. Keeps
"last week" / "this year" answers grounded against the user's tz.

### 3b. Search / lookup tools

| Tool | Input | Output |
|------|-------|--------|
| `search_performers` | `{ query, limit? }` | `{ matches: [{ id, name, image }] }` |
| `search_venues` | `{ query, city?, limit? }` | `{ matches: [{ id, name, city, lat, lng }] }` |
| `search_shows` | `{ query, dateFrom?, dateTo?, kind?, state?, performerId?, venueId?, limit? }` | `{ shows: [{ id, date, venue, headliner, ... }] }` |
| `search_tours` | `{ performerId? }` | `{ tours: [{ name, dateRange, showCount }] }` |

`search_shows` is the workhorse. The args are intentionally a strict
subset of the existing `shows.list` filter — the helper just calls
into that procedure with the same code, reusing pagination + the
`shows.list` projection work.

### 3c. Aggregations / stats

| Tool | Input | Output |
|------|-------|--------|
| `count_shows` | `{ filter: ShowFilter }` | `{ count }` |
| `shows_by_year` | `{ }` | `{ buckets: [{ year, count }] }` |
| `shows_by_kind` | `{ }` | `{ buckets: [{ kind, count }] }` |
| `top_artists` | `{ year?, limit }` | `{ rows: [{ performerId, name, showCount }] }` |
| `top_venues` | `{ year?, limit }` | `{ rows: [{ venueId, name, showCount }] }` |
| `top_cities` | `{ year?, limit }` | `{ rows: [{ city, showCount }] }` |
| `total_spend` | `{ year?, performerId? }` | `{ usd }` |
| `total_distance` | `{ year? }` | `{ miles }` (relies on user.regions[0] as home) |
| `streak_stats` | `{ }` | `{ longestGapDays, longestStreakDays, busiestWeek }` |

### 3d. Setlist / song tools (cross-feature with §setlist-intelligence)

These only work end-to-end once the setlist intelligence schema
ships. Until then they degrade to "feature not yet available."

| Tool | Input | Output |
|------|-------|--------|
| `songs_heard_most` | `{ scope: all|performerId, limit }` | `{ rows: [{ title, performer, count }] }` |
| `rare_catches` | `{ scope, limit }` | `{ rows: [{ title, performer, showId, frequency }] }` |
| `tour_debuts_caught` | `{ performerId? }` | `{ rows: [...] }` |
| `setlist_for_show` | `{ showId }` | `{ setlists: PerformerSetlistsMap }` |
| `predicted_setlist` | `{ performerId, showId? }` | `{ confidence, songs: [...] }` |

### 3e. Notes / free-text tools

The user's `shows.notes` field is unstructured and the only place
where free-text RAG actually pays for itself.

| Tool | Input | Output |
|------|-------|--------|
| `search_notes` | `{ query, limit }` | `{ matches: [{ showId, snippet, score }] }` |

Implementation:
- Postgres `tsvector` GIN index on `shows.notes`.
- For natural-language queries ("the rainy MSG show with Sam"),
  generate an embedding via Groq (or a cheap embedder like
  `nomic-embed-text-v1.5` if Groq doesn't ship one) and pgvector for
  semantic match. Schema:

```sql
ALTER TABLE shows
  ADD COLUMN notes_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(notes, ''))) STORED,
  ADD COLUMN notes_embedding vector(768);

CREATE INDEX shows_notes_tsv_idx ON shows USING gin (notes_tsv);
CREATE INDEX shows_notes_embedding_idx
  ON shows USING ivfflat (notes_embedding vector_cosine_ops) WITH (lists = 100);
```

Embeddings are populated lazily by a `enrichment/notes-embed` job
when `notes` is created or changed. Empty notes → no embedding.

### 3f. Action tools

The tools above are read-only. Action tools ask the user to
*confirm* before mutating — the model never side-effects without a
"yes" round-trip.

| Tool | Input | Output | Confirm? |
|------|-------|--------|----------|
| `add_show_draft` | `{ headliner, venue, date, kind, state }` | `{ draftUrl }` | Yes — opens the Add page pre-filled. No DB write. |
| `propose_export_playlist` | `{ showId, mode: 'predicted'|'attended' }` | `{ confirmCard, songCount }` | Yes — assistant returns a card with a "create playlist" button. |
| `propose_follow_artist` | `{ performerId }` | `{ confirmCard }` | Yes — emits a card the user must tap. |

Hard rule: the model never directly invokes mutations. The "confirm"
shape is a card with an explicit user action. Every state-changing
path runs through the user's tap, which calls the existing
`shows.create` / `performers.follow` / `setlistIntel.exportPlaylist`
procedures. No new mutation surface area.

### 3g. Tool registry implementation sketch

```ts
// packages/api/src/brain/tools/index.ts
import { z } from 'zod';

export interface BrainTool<I, O> {
  name: string;
  description: string;            // shown to the LLM
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  // Executes against the *current* user's data; userId comes from ctx.
  run(args: I, ctx: BrainContext): Promise<O>;
  // Cost class. Used by quota + parallelism limits.
  cost: 'cheap' | 'medium' | 'expensive';
}

export const BRAIN_TOOLS = [
  whoAmI,
  currentDate,
  searchPerformers,
  searchVenues,
  searchShows,
  countShows,
  showsByYear,
  topArtists,
  topVenues,
  topCities,
  totalSpend,
  songsHeardMost,
  rareCatches,
  tourDebutsCaught,
  predictedSetlist,
  setlistForShow,
  searchNotes,
  addShowDraft,
  proposeExportPlaylist,
  proposeFollowArtist,
  // ...
] satisfies BrainTool<unknown, unknown>[];

export const BRAIN_TOOLS_JSON_SCHEMA = BRAIN_TOOLS.map(t => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.input),
  },
}));
```

The `BrainContext` carries the authenticated `userId`, the
`db` handle, and a `traceCtx` for nested Langfuse spans. The LLM
*never sees* `userId`; it's stamped server-side.

---

## 4. Server flow

### 4a. tRPC procedures

```ts
// packages/api/src/routers/brain.ts
brain.threads.list({ archived?, limit?, cursor? })
brain.threads.create({ firstMessage })          // returns { threadId, messageId }
brain.threads.get({ threadId })
brain.threads.archive({ threadId })
brain.threads.delete({ threadId })

brain.chat.send({ threadId, content })          // streamed via tRPC subscription / SSE
```

`brain.chat.send` is the orchestration loop:

```ts
brain.chat.send.mutation(async ({ ctx, input }) => {
  return withTrace('brain.chat', async (run) => {
    const thread = await loadThread(ctx, input.threadId);
    const userMsg = await persistUserMessage(thread.id, input.content);

    // Recent context window: last 10 messages, plus a system summary
    // for older turns if any.
    const history = await loadRecentMessages(thread.id, 10);

    let messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...buildContextPreamble(ctx),         // see §4b
      ...history.map(toLLMMessage),
      { role: 'user', content: input.content },
    ];

    let toolCallCount = 0;
    const toolHistory: ToolCall[] = [];

    while (toolCallCount < MAX_TOOL_HOPS) {
      const completion = await traceLLM({
        name: 'brain.complete',
        model: 'llama-4-scout-17b',         // or whatever is current
        input: messages,
        run,
      }, () => groq.chat.completions.create({
        model: '...',
        messages,
        tools: BRAIN_TOOLS_JSON_SCHEMA,
        tool_choice: 'auto',
        stream: true,                       // streamed; assemble below
      }));

      const choice = await assembleStream(completion);
      messages.push(choice.message);

      if (!choice.message.tool_calls?.length) {
        // Final answer.
        const cards = extractCardsPayload(choice.message);
        await persistAssistantMessage(thread.id, choice.message, cards, run.traceId);
        return { content: choice.message.content, cards };
      }

      // Execute tool calls (parallel, with cost-class concurrency limit).
      for (const call of choice.message.tool_calls) {
        const tool = BRAIN_TOOLS.find(t => t.name === call.function.name);
        if (!tool) {
          messages.push(toolErrorMessage(call, 'unknown_tool'));
          continue;
        }
        const parsed = tool.input.safeParse(JSON.parse(call.function.arguments));
        if (!parsed.success) {
          messages.push(toolErrorMessage(call, 'invalid_args'));
          continue;
        }
        const result = await traceTool(call.function.name, run, () =>
          tool.run(parsed.data, { ...ctx, run }),
        );
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
        toolHistory.push({ name: call.function.name, args: parsed.data, result });
        toolCallCount++;
      }
    }

    // Hop budget exhausted — final attempt to answer with what we have.
    return finalizeWithBudgetExhausted(messages, thread, run);
  });
});
```

Notes:
- `MAX_TOOL_HOPS = 6` — one query rarely needs more.
- Cards are *embedded* in the assistant's final-turn JSON (the model
  is instructed to emit a small structured tail). See §5.
- Streaming: client receives both raw text deltas (for UI typing) and
  the final tool-history + cards JSON in a single SSE channel.

### 4b. The system prompt

A skeleton (real one will be longer + iterated):

```
You are Showbook, an assistant that answers a single user's questions
about their personal live-show history. You have access to tools that
query that user's data only.

Rules:
- Always use a tool to ground a numeric or factual claim. Never invent
  show counts, dates, venue names, or song titles.
- When the user asks an ambiguous question (e.g. "the show with Sam"),
  call search_notes first.
- For "smallest", "biggest", "most", "least": use the appropriate
  aggregation tool. For follow-ups like "show me the venues", emit a
  cards payload of type 'venue_list'.
- For *future* shows the user hasn't logged yet (e.g. "is X playing
  in NYC next week?"), say you only see the user's own data and
  suggest checking the Discover page.
- Today's date is provided by `current_date`. Use it; never guess.
- Currency is the user's locale; if unknown, USD.
- Tool calls run server-side and have access to the user's full data.
  You cannot fetch the open web, mutate user data, or read other
  users' data.
- For action requests (export playlist, add show), call the matching
  `propose_*` tool and let the user confirm via the card you return.

Output format:
- Plain markdown reply.
- Optionally append a single fenced ```json {"cards": [...]} ```
  block at the very end. Cards described in the tool docs.
```

### 4c. Context preamble — injected with prompt caching

To make every turn snappy and cheap, prepend a tiny "user context"
preamble that summarizes counts + regions + followed entities. This
is a perfect prompt-cache target because it changes infrequently.

```ts
function buildContextPreamble(ctx: BrainContext): LLMMessage[] {
  return [{
    role: 'system',
    content: `User context:
      - Display name: ${ctx.user.displayName}
      - Joined: ${ctx.user.joinedAt}
      - Regions: ${ctx.user.regions.map(r => r.city).join(', ') || 'none'}
      - Show count: ${ctx.cached.showCount}
      - Followed performers: ${ctx.cached.followedPerformerCount}
      - Followed venues: ${ctx.cached.followedVenueCount}
      - Date range of attended shows: ${ctx.cached.firstShow}–${ctx.cached.lastShow}
      Use this to disambiguate questions about "my", "this year", etc.`,
    cache: { type: 'ephemeral' },     // explicit cache marker per provider
  }];
}
```

Cache invalidation: drop the cache when any of the listed counts
change (cheap event-bus signal from the existing list-invalidation
machinery).

### 4d. Quota / cost guardrails

Reuse `packages/api/src/llm-quota.ts` (already gating Groq spend per
user for the Add chat-mode and playbill flows).

- Per-user daily message cap (default 100 turns).
- Per-turn tool-hop cap (6).
- Per-turn token cap (e.g. 8K input including tool results, 1.5K
  output) — model truncates context if a tool returns a 200-row list.
- Model error → user-visible "I'm having trouble, try again in a
  moment" + structured `brain.chat.error` log.

---

## 5. Cards: the structured-output channel

Plain text would work for "you went to 47 shows in 2024." It does
*not* work for "and here are the top 5 venues" — that wants to be
clickable.

The assistant emits at the end of its reply (parsed and stripped before
display):

````json
{
  "cards": [
    { "type": "stat", "label": "Shows in 2024", "value": "47" },
    {
      "type": "show_list",
      "title": "Top 5 venues",
      "items": [
        { "venueId": "...", "label": "Madison Square Garden", "trailing": "8 shows" },
        { "venueId": "...", "label": "Beacon Theatre", "trailing": "5 shows" }
      ]
    }
  ]
}
````

Card types (initial set):

| Type | Render |
|------|--------|
| `stat` | Big number + label |
| `show_list` | Vertical list of show rows (tap → /shows/[id]) |
| `venue_list` | Vertical list of venue rows (tap → /venues/[id]) |
| `artist_list` | Same shape, /artists/[id] |
| `song_list` | Title + performer + frequency badge |
| `chart_bar` | Horizontal bar chart (year × count, etc.) |
| `chart_line` | Spend or distance over time |
| `confirm_action` | Title + body + primary CTA button (calls a tRPC mutation) |
| `playlist_pending` | Spotify "create playlist" CTA + song preview |
| `predicted_setlist` | Reuses the §setlist-intel `PredictedSetlist` component |

The client renders cards inline with the markdown text, in source
order. Cards persist on the message row, so scrolling back through a
thread shows the same cards (no re-querying).

---

## 6. UI

### 6a. Web surface

New page: `apps/web/app/(app)/brain/page.tsx`. Two-pane layout:

```
┌────────────────────────────────────────────────────────────────┐
│ Brain                                          [+ New thread]  │
├────────────────┬───────────────────────────────────────────────┤
│ Threads        │ "What's the smallest venue I've seen Phoebe   │
│  · Phoebe...   │  Bridgers at?"                                │
│  · Top 2024    │                                               │
│  · Tokyo trip  │ Brain                                         │
│  · ...         │ The smallest venue you've seen Phoebe         │
│                │ Bridgers at was the Bowery Ballroom (cap.     │
│                │ 575) on Sep 12, 2019. You've seen her four    │
│                │ times since, the most recent at MSG.          │
│                │                                               │
│                │ ┌─ Show ─────────────────────────────────┐    │
│                │ │ Sep 12, 2019 · Bowery Ballroom        │    │
│                │ │ Phoebe Bridgers  →                     │    │
│                │ └────────────────────────────────────────┘    │
│                │                                               │
│                │ [ ask anything... ]                  [Send]   │
└────────────────┴───────────────────────────────────────────────┘
```

Sidebar entry point: a "Brain" item between Discover and Map. On
mobile, the nav becomes one of the five tabs in M5/M6. A "ask
your showbook" affordance also goes on Home for first-run discovery.

### 6b. Inline brain on Show / Venue / Artist pages

Each entity detail page gets a tiny "Ask about this" pill that
opens Brain pre-loaded with context:

- On `/shows/[id]`: pill "Ask about this show" → new thread,
  pre-seeded user message `What can you tell me about my [date]
  [venue] show?`. The system prompt context preamble adds
  `Current focus: showId=...` so the model leans into that scope.
- On `/venues/[id]`: "What's my history at this venue?"
- On `/artists/[id]`: "What's my history with this artist?"

These become 80% of usage early on — they replace the awkward "skim
several stat tiles" UX with one paragraph.

### 6c. Mobile (M5/M6)

A dedicated tab plus the same per-entity entry pills. Streaming text
+ cards work over the existing tRPC-over-fetch transport (no special
WebSocket needed).

---

## 7. Observability

Every Brain interaction is a Langfuse trace. The wrapping is the
existing `withTrace` from `@showbook/observability`:

- Trace name: `brain.chat`
- Attrs: `{ userId, threadId, messageId }`
- Spans:
  - `brain.complete` per LLM call (input/output, model, cost)
  - `brain.tool.<name>` per tool invocation (input, output, latency)
- Outcome event on the assistant message: `brain.turn.complete`
  (or `.error`).

Structured pino events (per CLAUDE.md `<component>.<action>.<outcome>`):

- `brain.thread.created`
- `brain.message.sent`
- `brain.tool.call`              — debug-level
- `brain.tool.error`
- `brain.complete.success`
- `brain.complete.error`
- `brain.quota.exceeded`

Cost dashboard target: median turn ≤ $0.005, p95 ≤ $0.02. Brain is
*not* allowed to silently exceed those without paging the developer
(an Axiom monitor on `brain.complete.success` cost percentile).

---

## 8. Test plan

- Unit (cheap, no LLM):
  - Tool input zod schemas reject malformed args.
  - Each tool's `run` against an in-memory fake DB seeded with a
    fixture user (3 shows, 2 artists, 1 venue, 1 note). Snapshot the
    output shape.
  - Card-extraction parser given a synthetic LLM final message.
  - Hop-budget ceiling: a forced loop tool-call returns the budget-
    exhausted finalizer.
- Integration (real DB, mocked Groq):
  - End-to-end thread: send "how many shows did I go to in 2024?" →
    expected `count_shows({year: 2024})` tool call → asserted
    response shape.
  - "Build me a playlist of last summer's setlists" → expected
    `propose_export_playlist` confirm card.
  - Thread persistence: reload thread, verify history reads back
    intact with cards + tool_calls JSON.
- E2E (Playwright):
  - User opens `/brain`, types a question, sees streaming text +
    a clickable show card, taps the card, lands on the show page.
  - Quota guardrail: simulate 100 turns, verify 101st returns the
    quota-exceeded UI state.
- LLM-as-judge eval (offline):
  - Curated set of ~30 question/answer pairs from the developer's
    own data. Run weekly; alert on regressions.

---

## 9. Phased rollout

| Phase | Scope |
|-------|-------|
| **B0** | Schema (`brain_threads`, `brain_messages`) + the tRPC procedures + persistence layer (no LLM yet). Verifiable by writing/reading messages. |
| **B1** | Tool registry — identity, search, count tools (§3a/b/c). System prompt v1. Single-turn answers for "how many shows in X." Web `/brain` page minimal layout. |
| **B2** | Multi-hop tool loop. Cards channel. Inline pills on Show/Venue/Artist detail pages. Streaming UI. |
| **B3** | Notes search (§3e) — pgvector + tsvector + embedding job. Unlocks "the rainy MSG show with Sam." |
| **B4** | Setlist tools (§3d) — depends on `feature-plan-setlist-intelligence` shipping the schema. |
| **B5** | Action tools (§3f) — `add_show_draft`, `propose_export_playlist`, `propose_follow_artist`. The point at which Brain can *do* things, not just answer. |
| **B6** | Mobile parity in M5. |

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| LLM hallucinates a fact and skips tools | System prompt forbids unground numeric/factual claims; eval suite catches regressions; the cards channel makes invented IDs visually fail (404 on click). |
| Tool sprawl — model can't pick the right one | Keep v1 to ~25 tools, well-named, with crisp descriptions. Periodic eval-driven prune. |
| Cost runaway from chatty users | Per-user daily turn cap; per-turn hop cap; per-turn token cap. Hard stop with friendly error. |
| Multi-tenant safety: tool returns another user's data | `BrainContext.userId` is server-stamped from session; every tool implementation MUST scope its query by `userId`. Lint rule: any `db.query.*` inside `packages/api/src/brain/tools/` without a `userId` clause fails CI. |
| Prompt injection via user notes ("ignore previous instructions...") | Notes flow through `search_notes` as tool *result*, not as system prompt. Tool results are clearly labeled `role:'tool'`; injection in note content can't override the system prompt. Belt-and-suspenders: strip null bytes / control chars from tool results before re-feeding. |
| LLM provider outage | Brain page handles errors gracefully (toast + retry CTA); rest of the app is unaffected (Brain is a leaf feature). |
| Streaming complexity | Use the same SSE shape as Gmail scan (tested, in production). Don't reinvent. |

---

## 11. Open questions

1. **Single thread or multi?** Multi (per the schema). Users build
   "investigations" (e.g. trip planning, year-end recap) that benefit
   from being separate from the one-shot "how many shows..." threads.
2. **Voice input?** Mobile only, P2 — Whisper transcription pipes
   the audio into the same `brain.chat.send` path. Low effort once
   the core is solid.
3. **Should Brain answer questions about *other* users?** No, ever.
   That'd require a friend-graph product and a far more careful
   privacy posture. The single-user scope is a hard product line.
4. **Does the model see embeddings or raw notes for `search_notes`?**
   Raw notes (top-N matches), capped at ~2K tokens of total content.
   Embeddings are an internal retrieval mechanism, not exposed to the
   model.
5. **Streaming partial cards?** No in v1 — emit cards only on the
   *final* turn. Streaming partial structured output is a complexity
   trap and the reply latency is short enough (~1–3s) that the user
   won't notice.
