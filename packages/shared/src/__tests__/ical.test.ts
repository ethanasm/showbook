import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIcs,
  defaultShowTime,
  slugifyForFilename,
  type IcsEvent,
} from "../utils/ical";

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "evt-1@showbook",
    summary: "Test Concert",
    dtstart: new Date(2025, 5, 15, 19, 0, 0),
    dtend: new Date(2025, 5, 15, 22, 0, 0),
    ...overrides,
  };
}

// ── buildIcs ────────────────────────────────────────────────────────────

test("buildIcs: wraps events in BEGIN/END:VCALENDAR", () => {
  const out = buildIcs([event()]);
  assert.match(out, /^BEGIN:VCALENDAR\r\n/);
  assert.match(out, /\r\nEND:VCALENDAR\r\n$/);
});

test("buildIcs: includes VERSION, PRODID, CALSCALE, METHOD", () => {
  const out = buildIcs([event()]);
  assert.match(out, /VERSION:2\.0/);
  assert.match(out, /PRODID:-\/\/Showbook\/\/Showbook\/\/EN/);
  assert.match(out, /CALSCALE:GREGORIAN/);
  assert.match(out, /METHOD:PUBLISH/);
});

test("buildIcs: emits VEVENT with UID, DTSTART, DTEND, SUMMARY", () => {
  const out = buildIcs([event()]);
  assert.match(out, /BEGIN:VEVENT\r\n/);
  assert.match(out, /UID:evt-1@showbook/);
  assert.match(out, /DTSTART:20250615T190000/);
  assert.match(out, /DTEND:20250615T220000/);
  assert.match(out, /SUMMARY:Test Concert/);
  assert.match(out, /END:VEVENT/);
});

test("buildIcs: includes optional LOCATION when provided", () => {
  const out = buildIcs([event({ location: "Madison Square Garden" })]);
  assert.match(out, /LOCATION:Madison Square Garden/);
});

test("buildIcs: includes optional URL when provided", () => {
  const out = buildIcs([event({ url: "https://example.com/show/1" })]);
  assert.match(out, /URL:https:\/\/example\.com\/show\/1/);
});

test("buildIcs: escapes commas, semicolons, and newlines in text fields", () => {
  const out = buildIcs([
    event({ summary: "Foo, Bar; Baz", description: "line1\nline2" }),
  ]);
  assert.match(out, /SUMMARY:Foo\\, Bar\\; Baz/);
  assert.match(out, /DESCRIPTION:line1\\nline2/);
});

test("buildIcs: escapes backslashes too", () => {
  const out = buildIcs([event({ summary: "back\\slash" })]);
  assert.match(out, /SUMMARY:back\\\\slash/);
});

test("buildIcs: emits multiple events in order", () => {
  const out = buildIcs([
    event({ uid: "a", summary: "First" }),
    event({ uid: "b", summary: "Second" }),
  ]);
  const idxA = out.indexOf("UID:a");
  const idxB = out.indexOf("UID:b");
  assert.ok(idxA > 0 && idxB > idxA);
});

test("buildIcs: emits empty calendar when no events", () => {
  const out = buildIcs([]);
  assert.match(out, /BEGIN:VCALENDAR/);
  assert.match(out, /END:VCALENDAR/);
  assert.equal(out.includes("BEGIN:VEVENT"), false);
});

test("buildIcs: folds long lines past 75 chars", () => {
  const longSummary = "A".repeat(200);
  const out = buildIcs([event({ summary: longSummary })]);
  // Folded continuation lines start with a single space.
  assert.ok(out.includes("\r\n A"), "expected folded continuation");
});

// ── defaultShowTime ─────────────────────────────────────────────────────

test("defaultShowTime: returns 7pm-10pm local on the given date", () => {
  const { start, end } = defaultShowTime("2025-12-31");
  assert.equal(start.getFullYear(), 2025);
  assert.equal(start.getMonth(), 11);
  assert.equal(start.getDate(), 31);
  assert.equal(start.getHours(), 19);
  assert.equal(start.getMinutes(), 0);
  // 3-hour duration
  assert.equal(end.getTime() - start.getTime(), 3 * 60 * 60 * 1000);
});

// ── slugifyForFilename ──────────────────────────────────────────────────

test("slugifyForFilename: lowercases, replaces non-alphanum with dashes", () => {
  assert.equal(slugifyForFilename("Hello, World!"), "hello-world");
});

test("slugifyForFilename: trims leading/trailing dashes", () => {
  assert.equal(slugifyForFilename("---foo---"), "foo");
});

test("slugifyForFilename: caps at 60 chars", () => {
  const long = "a".repeat(100);
  assert.equal(slugifyForFilename(long).length, 60);
});

test("slugifyForFilename: returns 'event' for empty input", () => {
  assert.equal(slugifyForFilename(""), "event");
  assert.equal(slugifyForFilename("---"), "event");
});
