import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIND_ICONS,
  KIND_LABELS,
  DISCOVER_KIND_ICONS,
} from "../kind-icons";

const SHOW_KINDS = ["concert", "theatre", "comedy", "festival"] as const;

test("KIND_ICONS: every ShowKind has an icon", () => {
  for (const k of SHOW_KINDS) {
    assert.ok(
      typeof KIND_ICONS[k] === "function" || typeof KIND_ICONS[k] === "object",
      `KIND_ICONS missing icon for ${k}`,
    );
  }
});

test("KIND_LABELS: every ShowKind has a non-empty label", () => {
  for (const k of SHOW_KINDS) {
    const label = KIND_LABELS[k];
    assert.ok(typeof label === "string" && label.length > 0, `Missing label for ${k}`);
  }
});

test("KIND_LABELS includes sports", () => {
  assert.equal(KIND_LABELS.sports, "Sports");
});

test("DISCOVER_KIND_ICONS extends KIND_ICONS with sports", () => {
  for (const k of SHOW_KINDS) {
    assert.equal(DISCOVER_KIND_ICONS[k], KIND_ICONS[k]);
  }
  assert.ok(
    typeof DISCOVER_KIND_ICONS.sports === "function" ||
      typeof DISCOVER_KIND_ICONS.sports === "object",
    "DISCOVER_KIND_ICONS missing sports icon",
  );
});

test("KIND_LABELS: capitalized canonical form (matches packages/shared)", () => {
  assert.equal(KIND_LABELS.concert, "Concert");
  assert.equal(KIND_LABELS.theatre, "Theatre");
  assert.equal(KIND_LABELS.comedy, "Comedy");
  assert.equal(KIND_LABELS.festival, "Festival");
});
