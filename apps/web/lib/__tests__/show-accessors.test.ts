import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
