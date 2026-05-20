import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildActualSongsFromSetlist,
  buildFestivalLineupEntries,
  countFestivalActualSongs,
  getHeadliner,
  getHeadlinerId,
  getHeadlinerImageUrl,
  getSupport,
  getSupportPerformers,
  type ShowLike,
} from "../show-accessors";

function show(overrides: Partial<ShowLike> & { showPerformers?: ShowLike["showPerformers"] }): ShowLike {
  return {
    kind: "concert",
    productionName: null,
    showPerformers: [],
    ...overrides,
  };
}

// ── getHeadliner ─────────────────────────────────────────────────────────

test("getHeadliner: theatre with productionName returns productionName", () => {
  assert.equal(
    getHeadliner(
      show({
        kind: "theatre",
        productionName: "Hadestown",
        showPerformers: [
          {
            role: "headliner",
            sortOrder: 0,
            performer: { id: "p1", name: "Lead Actor" },
          },
        ],
      }),
    ),
    "Hadestown",
  );
});

test("getHeadliner: festival with productionName returns productionName", () => {
  assert.equal(
    getHeadliner(
      show({
        kind: "festival",
        productionName: "Coachella 2024",
        showPerformers: [
          {
            role: "headliner",
            sortOrder: 0,
            performer: { id: "p1", name: "Headliner Band" },
          },
        ],
      }),
    ),
    "Coachella 2024",
  );
});

test("getHeadliner: theatre WITHOUT productionName falls back to performer", () => {
  assert.equal(
    getHeadliner(
      show({
        kind: "theatre",
        productionName: null,
        showPerformers: [
          {
            role: "headliner",
            sortOrder: 0,
            performer: { id: "p1", name: "Solo Performer" },
          },
        ],
      }),
    ),
    "Solo Performer",
  );
});

test("getHeadliner: prefers headliner with sortOrder 0 over other headliners", () => {
  assert.equal(
    getHeadliner(
      show({
        showPerformers: [
          { role: "headliner", sortOrder: 5, performer: { id: "p2", name: "Co-headliner" } },
          { role: "headliner", sortOrder: 0, performer: { id: "p1", name: "Main" } },
        ],
      }),
    ),
    "Main",
  );
});

test("getHeadliner: falls back to any headliner when none at sortOrder 0", () => {
  assert.equal(
    getHeadliner(
      show({
        showPerformers: [
          { role: "headliner", sortOrder: 3, performer: { id: "p1", name: "Secondary" } },
        ],
      }),
    ),
    "Secondary",
  );
});

test("getHeadliner: third-tier fallback uses first showPerformer regardless of role", () => {
  assert.equal(
    getHeadliner(
      show({
        showPerformers: [
          { role: "support", sortOrder: 0, performer: { id: "p1", name: "Opener" } },
        ],
      }),
    ),
    "Opener",
  );
});

test("getHeadliner: returns 'Unknown Artist' for empty showPerformers", () => {
  assert.equal(getHeadliner(show({ showPerformers: [] })), "Unknown Artist");
});

// ── getHeadlinerId ───────────────────────────────────────────────────────

test("getHeadlinerId: production show returns undefined (production has no performer id)", () => {
  assert.equal(
    getHeadlinerId(
      show({
        kind: "theatre",
        productionName: "Hamilton",
        showPerformers: [
          { role: "headliner", sortOrder: 0, performer: { id: "p1", name: "n" } },
        ],
      }),
    ),
    undefined,
  );
});

test("getHeadlinerId: returns the picked performer's id", () => {
  assert.equal(
    getHeadlinerId(
      show({
        showPerformers: [
          { role: "headliner", sortOrder: 0, performer: { id: "p-main", name: "Main" } },
          { role: "support", sortOrder: 1, performer: { id: "p-sup", name: "Sup" } },
        ],
      }),
    ),
    "p-main",
  );
});

test("getHeadlinerId: festival with a productionName still returns the headliner (per-artist prediction)", () => {
  assert.equal(
    getHeadlinerId(
      show({
        kind: "festival",
        productionName: "Bottlerock",
        showPerformers: [
          { role: "headliner", sortOrder: 0, performer: { id: "lorde", name: "Lorde" } },
        ],
      }),
    ),
    "lorde",
  );
});

// ── getHeadlinerImageUrl ─────────────────────────────────────────────────

test("getHeadlinerImageUrl: festival with a productionName still routes through the cover proxy", () => {
  assert.equal(
    getHeadlinerImageUrl(
      show({
        id: "show-fest",
        kind: "festival",
        productionName: "Bottlerock",
        coverImageUrl: "http://poster.png",
        showPerformers: [
          {
            role: "headliner",
            sortOrder: 0,
            performer: { id: "lorde", name: "Lorde", imageUrl: "http://lorde.png" },
          },
        ],
      }),
    ),
    "/api/show-cover/show-fest",
  );
});

test("getHeadlinerImageUrl: production show with id routes through self-heal proxy", () => {
  assert.equal(
    getHeadlinerImageUrl(
      show({
        id: "show-123",
        kind: "theatre",
        productionName: "Hamilton",
        coverImageUrl: "http://poster.png",
        showPerformers: [
          {
            role: "headliner",
            sortOrder: 0,
            performer: { id: "p1", name: "n", imageUrl: "http://x.png" },
          },
        ],
      }),
    ),
    "/api/show-cover/show-123",
  );
});

test("getHeadlinerImageUrl: production show without id falls back to stored coverImageUrl", () => {
  assert.equal(
    getHeadlinerImageUrl(
      show({
        kind: "theatre",
        productionName: "Hamilton",
        coverImageUrl: "http://poster.png",
        showPerformers: [],
      }),
    ),
    "http://poster.png",
  );
});

test("getHeadlinerImageUrl: production show without id or coverImageUrl returns null", () => {
  assert.equal(
    getHeadlinerImageUrl(
      show({
        kind: "theatre",
        productionName: "Hamilton",
        showPerformers: [],
      }),
    ),
    null,
  );
});

test("getHeadlinerImageUrl: concert falls back to coverImageUrl when performer has none", () => {
  assert.equal(
    getHeadlinerImageUrl(
      show({
        kind: "concert",
        coverImageUrl: "http://event.png",
        showPerformers: [
          { role: "headliner", sortOrder: 0, performer: { id: "p1", name: "Main" } },
        ],
      }),
    ),
    "http://event.png",
  );
});

test("getHeadlinerImageUrl: returns the picked performer's imageUrl", () => {
  assert.equal(
    getHeadlinerImageUrl(
      show({
        showPerformers: [
          {
            role: "headliner",
            sortOrder: 0,
            performer: { id: "p1", name: "Main", imageUrl: "http://x.png" },
          },
        ],
      }),
    ),
    "http://x.png",
  );
});

test("getHeadlinerImageUrl: returns null when picked performer has no imageUrl", () => {
  assert.equal(
    getHeadlinerImageUrl(
      show({
        showPerformers: [
          { role: "headliner", sortOrder: 0, performer: { id: "p1", name: "Main" } },
        ],
      }),
    ),
    null,
  );
});

// ── getSupport ───────────────────────────────────────────────────────────

test("getSupport: returns only role='support', sorted by sortOrder ascending", () => {
  assert.deepEqual(
    getSupport(
      show({
        showPerformers: [
          { role: "support", sortOrder: 2, performer: { id: "p3", name: "Z" } },
          { role: "headliner", sortOrder: 0, performer: { id: "p1", name: "Main" } },
          { role: "support", sortOrder: 1, performer: { id: "p2", name: "A" } },
        ],
      }),
    ),
    ["A", "Z"],
  );
});

test("getSupport: returns empty array when no supports", () => {
  assert.deepEqual(
    getSupport(
      show({
        showPerformers: [
          { role: "headliner", sortOrder: 0, performer: { id: "p1", name: "Main" } },
        ],
      }),
    ),
    [],
  );
});

// ── getSupportPerformers ─────────────────────────────────────────────────

// ── buildActualSongsFromSetlist ──────────────────────────────────────────

test("buildActualSongsFromSetlist: returns [] for null / undefined", () => {
  assert.deepEqual(buildActualSongsFromSetlist(null), []);
  assert.deepEqual(buildActualSongsFromSetlist(undefined), []);
});

test("buildActualSongsFromSetlist: returns [] for an empty sections array", () => {
  assert.deepEqual(buildActualSongsFromSetlist({ sections: [] }), []);
});

test("buildActualSongsFromSetlist: flattens sections + songs preserving indices", () => {
  const out = buildActualSongsFromSetlist({
    sections: [
      { kind: "set", songs: [{ title: "A" }, { title: "B" }, { title: "C" }] },
      { kind: "encore", songs: [{ title: "E1" }] },
    ],
  });
  assert.deepEqual(out, [
    { title: "A", sectionIndex: 0, songIndex: 0, isEncore: false, isOpenerOrCloser: true, note: null },
    { title: "B", sectionIndex: 0, songIndex: 1, isEncore: false, isOpenerOrCloser: false, note: null },
    { title: "C", sectionIndex: 0, songIndex: 2, isEncore: false, isOpenerOrCloser: true, note: null },
    { title: "E1", sectionIndex: 1, songIndex: 0, isEncore: true, isOpenerOrCloser: false, note: null },
  ]);
});

test("buildActualSongsFromSetlist: opener+closer flags only fire on non-encore sections", () => {
  const out = buildActualSongsFromSetlist({
    sections: [
      { kind: "encore", songs: [{ title: "Only" }] },
    ],
  });
  // Encore section's only song is neither opener nor closer.
  assert.equal(out[0].isOpenerOrCloser, false);
});

test("buildActualSongsFromSetlist: a single-song non-encore section marks the song as both opener and closer", () => {
  const out = buildActualSongsFromSetlist({
    sections: [{ kind: "set", songs: [{ title: "Solo" }] }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].isOpenerOrCloser, true);
});

test("buildActualSongsFromSetlist: passes through note when present, defaults to null", () => {
  const out = buildActualSongsFromSetlist({
    sections: [
      { kind: "set", songs: [{ title: "A", note: "intro" }, { title: "B" }] },
    ],
  });
  assert.equal(out[0].note, "intro");
  assert.equal(out[1].note, null);
});

test("buildActualSongsFromSetlist: missing section.kind treats the section as non-encore", () => {
  const out = buildActualSongsFromSetlist({
    sections: [{ songs: [{ title: "X" }] }],
  });
  assert.equal(out[0].isEncore, false);
});

// ── buildFestivalLineupEntries ───────────────────────────────────────────

test("buildFestivalLineupEntries: filters out non-headliner/support and preserves DB order", () => {
  const entries = buildFestivalLineupEntries({
    showPerformers: [
      { role: "support", sortOrder: 1, performer: { id: "s1", name: "S One" } },
      { role: "headliner", sortOrder: 0, performer: { id: "h", name: "Head" } },
      { role: "guest", sortOrder: 2, performer: { id: "g", name: "Guest" } },
    ],
    isPast: false,
    predictions: null,
    setlistsByPerformer: {},
  });
  assert.equal(entries.length, 2);
  // Order matches showPerformers — the consumer sorts/filters later.
  assert.equal(entries[0].performerId, "s1");
  assert.equal(entries[1].performerId, "h");
});

test("buildFestivalLineupEntries: upcoming attaches predictions by performerId, leaves actualSongs []", () => {
  const entries = buildFestivalLineupEntries({
    showPerformers: [
      { role: "headliner", sortOrder: 0, performer: { id: "h", name: "Head" } },
      { role: "support", sortOrder: 1, performer: { id: "s", name: "Sup" } },
    ],
    isPast: false,
    predictions: [
      { performerId: "h", prediction: { kind: "hot" } as { kind: string } },
    ],
    setlistsByPerformer: {
      // Even if present, isPast=false means actualSongs stays [].
      h: { sections: [{ kind: "set", songs: [{ title: "X" }] }] },
    },
  });
  assert.deepEqual(entries[0].prediction, { kind: "hot" });
  assert.equal(entries[0].actualSongs.length, 0);
  assert.equal(entries[1].prediction, null);
});

test("buildFestivalLineupEntries: past fans out per-performer setlists, ignores any predictions", () => {
  const entries = buildFestivalLineupEntries({
    showPerformers: [
      { role: "headliner", sortOrder: 0, performer: { id: "h", name: "Head" } },
      { role: "support", sortOrder: 1, performer: { id: "s", name: "Sup" } },
    ],
    isPast: true,
    predictions: [
      // Predictions ignored on past shows.
      { performerId: "h", prediction: { kind: "hot" } as { kind: string } },
    ],
    setlistsByPerformer: {
      h: { sections: [{ kind: "set", songs: [{ title: "Hit" }] }] },
      // s has no setlist — should produce actualSongs: [].
    },
  });
  assert.equal(entries[0].prediction, null, "past: predictions ignored");
  assert.equal(entries[0].actualSongs.length, 1);
  assert.equal(entries[0].actualSongs[0].title, "Hit");
  assert.equal(entries[1].actualSongs.length, 0);
});

test("buildFestivalLineupEntries: empty showPerformers returns []", () => {
  assert.deepEqual(
    buildFestivalLineupEntries({
      showPerformers: [],
      isPast: false,
      predictions: null,
      setlistsByPerformer: {},
    }),
    [],
  );
});

test("buildFestivalLineupEntries: null predictions on upcoming still produces entries with prediction=null", () => {
  const entries = buildFestivalLineupEntries({
    showPerformers: [
      { role: "headliner", sortOrder: 0, performer: { id: "h", name: "H" } },
    ],
    isPast: false,
    predictions: null,
    setlistsByPerformer: {},
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].prediction, null);
});

// ── countFestivalActualSongs ─────────────────────────────────────────────

test("countFestivalActualSongs: returns 0 when not a festival", () => {
  assert.equal(
    countFestivalActualSongs({
      isFestival: false,
      isPast: true,
      entries: [
        { actualSongs: [{ title: "x", sectionIndex: 0, songIndex: 0, isEncore: false }] },
      ],
    }),
    0,
  );
});

test("countFestivalActualSongs: returns 0 when not past (no totals on upcoming festivals)", () => {
  assert.equal(
    countFestivalActualSongs({
      isFestival: true,
      isPast: false,
      entries: [
        { actualSongs: [{ title: "x", sectionIndex: 0, songIndex: 0, isEncore: false }] },
      ],
    }),
    0,
  );
});

test("countFestivalActualSongs: sums actualSongs across every entry for past festivals", () => {
  assert.equal(
    countFestivalActualSongs({
      isFestival: true,
      isPast: true,
      entries: [
        { actualSongs: [
          { title: "a", sectionIndex: 0, songIndex: 0, isEncore: false },
          { title: "b", sectionIndex: 0, songIndex: 1, isEncore: false },
        ] },
        { actualSongs: [] },
        { actualSongs: [
          { title: "c", sectionIndex: 0, songIndex: 0, isEncore: false },
        ] },
      ],
    }),
    3,
  );
});

// ── getSupportPerformers ─────────────────────────────────────────────────

test("getSupportPerformers: returns id+name pairs in sortOrder", () => {
  assert.deepEqual(
    getSupportPerformers(
      show({
        showPerformers: [
          { role: "support", sortOrder: 5, performer: { id: "p3", name: "C" } },
          { role: "support", sortOrder: 1, performer: { id: "p1", name: "A" } },
          { role: "headliner", sortOrder: 0, performer: { id: "ph", name: "H" } },
        ],
      }),
    ),
    [
      { id: "p1", name: "A" },
      { id: "p3", name: "C" },
    ],
  );
});
