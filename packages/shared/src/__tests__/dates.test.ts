import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyEffectiveShowState,
  countdown,
  daysUntil,
  effectiveShowState,
  formatDateLong,
  formatDateMedium,
  formatDateParts,
  formatDateRangeLong,
  formatDateRangeShort,
  formatOnSaleDate,
  formatShowDate,
  formatYear,
  hasShowStarted,
  isDatePast,
  isShowEffectivelyPast,
  parseLocalDate,
  showStartTimeMs,
  toSetlistFmDate,
} from "../utils/dates";

// ── formatDateMedium ────────────────────────────────────────────────────

test("formatDateMedium: 'Jan 1, 2024' style", () => {
  assert.equal(formatDateMedium("2024-01-01"), "Jan 1, 2024");
});

test("formatDateMedium: returns fallback for null/undefined", () => {
  assert.equal(formatDateMedium(null), "—");
  assert.equal(formatDateMedium(undefined), "—");
  assert.equal(formatDateMedium(null, "TBD"), "TBD");
});

// ── formatDateLong ──────────────────────────────────────────────────────

test("formatDateLong: weekday+month+day+year", () => {
  // 2024-01-01 is a Monday in any IANA tz with localdate
  const out = formatDateLong("2024-01-01");
  assert.match(out, /Monday/);
  assert.match(out, /January/);
  assert.match(out, /2024/);
});

test("formatDateLong: returns fallback for null", () => {
  assert.equal(formatDateLong(null), "Date TBD");
  assert.equal(formatDateLong(undefined, "—"), "—");
});

// ── formatDateRangeLong ─────────────────────────────────────────────────

test("formatDateRangeLong: single date when end equals start", () => {
  assert.equal(
    formatDateRangeLong("2024-01-01", "2024-01-01"),
    formatDateLong("2024-01-01"),
  );
});

test("formatDateRangeLong: single date when end is null", () => {
  assert.equal(
    formatDateRangeLong("2024-01-01", null),
    formatDateLong("2024-01-01"),
  );
});

test("formatDateRangeLong: two-date range with hyphen", () => {
  const out = formatDateRangeLong("2024-01-01", "2024-01-03");
  assert.ok(out.includes(" - "));
  assert.match(out, /January/);
});

test("formatDateRangeLong: returns fallback when start is null", () => {
  assert.equal(formatDateRangeLong(null, "2024-01-01"), "Date TBD");
});

// ── formatDateRangeShort ────────────────────────────────────────────────

test("formatDateRangeShort: single date when end is null", () => {
  assert.equal(formatDateRangeShort("2024-08-09", null), "AUG 9, 2024");
});

test("formatDateRangeShort: single date when end equals start", () => {
  assert.equal(formatDateRangeShort("2024-08-09", "2024-08-09"), "AUG 9, 2024");
});

test("formatDateRangeShort: same month uses en-dash between days", () => {
  assert.equal(
    formatDateRangeShort("2024-08-09", "2024-08-11"),
    "AUG 9–11, 2024",
  );
});

test("formatDateRangeShort: cross-month within a year", () => {
  assert.equal(
    formatDateRangeShort("2024-08-30", "2024-09-02"),
    "AUG 30 – SEP 2, 2024",
  );
});

test("formatDateRangeShort: cross-year keeps both years", () => {
  assert.equal(
    formatDateRangeShort("2024-12-30", "2025-01-02"),
    "DEC 30, 2024 – JAN 2, 2025",
  );
});

test("formatDateRangeShort: falls back when start is null", () => {
  assert.equal(formatDateRangeShort(null, "2024-08-11"), "DATE TBD");
});

test("formatDateRangeShort: ignores end <= start", () => {
  assert.equal(
    formatDateRangeShort("2024-08-09", "2024-08-08"),
    "AUG 9, 2024",
  );
});

// ── formatDateParts ─────────────────────────────────────────────────────

test("formatDateParts: returns capitalized dow + uppercase month", () => {
  const parts = formatDateParts("2024-01-01");
  assert.equal(parts.month, "JAN");
  assert.equal(parts.day, "1");
  assert.equal(parts.year, "2024");
  assert.equal(parts.dow, "Mon");
});

test("formatDateParts: returns default fallback on null", () => {
  assert.deepEqual(formatDateParts(null), {
    month: "TBD",
    day: "",
    year: "—",
    dow: "date",
  });
});

test("formatDateParts: accepts a custom fallback", () => {
  const fallback = { month: "—", day: "—", year: "", dow: "" };
  assert.deepEqual(formatDateParts(undefined, fallback), fallback);
});

test("formatDateParts: returns fallback for invalid date", () => {
  assert.deepEqual(formatDateParts("not-a-date"), {
    month: "TBD",
    day: "",
    year: "—",
    dow: "date",
  });
});

// ── formatOnSaleDate ────────────────────────────────────────────────────

test("formatOnSaleDate: 'Jan 1' (no year)", () => {
  // ISO date with explicit time so it parses regardless of timezone
  assert.equal(formatOnSaleDate("2024-06-15T19:00:00Z"), "Jun 15");
});

test("formatOnSaleDate: returns fallback for null/invalid", () => {
  assert.equal(formatOnSaleDate(null), "—");
  assert.equal(formatOnSaleDate(undefined), "—");
  assert.equal(formatOnSaleDate("garbage"), "—");
});

// ── daysUntil ───────────────────────────────────────────────────────────

test("daysUntil: 0 for null input", () => {
  assert.equal(daysUntil(null), 0);
  assert.equal(daysUntil(undefined), 0);
});

test("daysUntil: positive for future dates", () => {
  const future = new Date();
  future.setDate(future.getDate() + 7);
  const iso = future.toISOString().slice(0, 10);
  const days = daysUntil(iso);
  assert.ok(days >= 6 && days <= 8, `expected ~7, got ${days}`);
});

test("daysUntil: negative or zero for past dates", () => {
  const past = new Date();
  past.setDate(past.getDate() - 5);
  const iso = past.toISOString().slice(0, 10);
  const days = daysUntil(iso);
  assert.ok(days <= 0, `expected <= 0, got ${days}`);
});

// ── existing helpers (sanity) ───────────────────────────────────────────

test("formatYear: extracts year", () => {
  assert.equal(formatYear("2024-06-15"), 2024);
});

test("isDatePast: today is not past", () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(isDatePast(today), false);
});

// Regression: zone-less YYYY-MM-DD for today's local date was being parsed as
// UTC midnight, which is "yesterday" in zones west of UTC — `isDatePast`
// returned true for today's show in PT. Anchor with the local calendar date.
test("isDatePast: today's local calendar date is not past (TZ-safe)", () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const todayLocal = `${y}-${m}-${d}`;
  assert.equal(isDatePast(todayLocal), false);
});

// ── parseLocalDate ──────────────────────────────────────────────────────

test("parseLocalDate: zone-less YYYY-MM-DD anchors to local midnight", () => {
  const d = parseLocalDate("2024-06-15");
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 5);
  assert.equal(d.getDate(), 15);
  assert.equal(d.getHours(), 0);
});

test("parseLocalDate: passes through Date instances unchanged", () => {
  const input = new Date(2024, 5, 15, 12);
  assert.equal(parseLocalDate(input), input);
});

// ── countdown ───────────────────────────────────────────────────────────

test("countdown: 'today' for today", () => {
  const now = new Date();
  // Add a few hours so we're squarely on the same calendar day
  const target = new Date(now.getTime() + 1000 * 60 * 60 * 2);
  const out = countdown(target);
  // Could be 'today', 'tomorrow', or '1 days' depending on time drift
  assert.match(out, /today|days|tomorrow/);
});

test("countdown: tomorrow / days / weeks / months / years", () => {
  const day = (n: number) => new Date(Date.now() + n * 1000 * 60 * 60 * 24);
  assert.match(countdown(day(1.5)), /tomorrow|days/);
  assert.match(countdown(day(3)), /days/);
  assert.match(countdown(day(15)), /weeks/);
  assert.match(countdown(day(60)), /months/);
  assert.match(countdown(day(800)), /years/);
});

test("countdown: past date returns 'N days ago'", () => {
  const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 5);
  assert.match(countdown(past), /days ago/);
});

// ── formatShowDate ──────────────────────────────────────────────────────

test("formatShowDate: weekday + month + day + year", () => {
  const out = formatShowDate("2024-06-15");
  assert.match(out, /2024/);
});

// ── toSetlistFmDate string overload ─────────────────────────────────────

test("toSetlistFmDate: string overload (zone-less ISO)", () => {
  assert.equal(toSetlistFmDate("2024-06-15"), "15-06-2024");
});

test("toSetlistFmDate: dd-MM-yyyy", () => {
  // Use explicit local-midnight date to match implementation
  const d = new Date(2024, 5, 15);
  assert.equal(toSetlistFmDate(d), "15-06-2024");
});

// ── doors-anchored show timing ──────────────────────────────────────────
// All anchors are local-zone, so fixed "now" values are built with the
// local Date constructor to stay deterministic in any test TZ.

const SHOW_DATE = "2026-06-11";
const localMs = (h: number, m = 0) => new Date(2026, 5, 11, h, m).getTime();

test("showStartTimeMs: anchors a calendar date at the 19:00 local doors hour", () => {
  assert.equal(showStartTimeMs(SHOW_DATE), localMs(19));
  assert.equal(showStartTimeMs(SHOW_DATE, 20), localMs(20));
});

test("showStartTimeMs: null/invalid input returns null", () => {
  assert.equal(showStartTimeMs(null), null);
  assert.equal(showStartTimeMs(undefined), null);
  assert.equal(showStartTimeMs("not-a-date"), null);
});

test("hasShowStarted: false before doors, true from doors onward", () => {
  assert.equal(hasShowStarted(SHOW_DATE, localMs(18, 59)), false);
  assert.equal(hasShowStarted(SHOW_DATE, localMs(19)), true);
  assert.equal(hasShowStarted(SHOW_DATE, localMs(23, 30)), true);
  // Any past date counts as started.
  assert.equal(hasShowStarted("2020-01-01", localMs(12)), true);
  assert.equal(hasShowStarted(null, localMs(12)), false);
});

test("isShowEffectivelyPast: flips 3 h after doors (22:00 local)", () => {
  assert.equal(isShowEffectivelyPast(SHOW_DATE, localMs(21, 59)), false);
  assert.equal(isShowEffectivelyPast(SHOW_DATE, localMs(22)), true);
  // Next morning is past too — no waiting for the nightly transition.
  assert.equal(
    isShowEffectivelyPast(SHOW_DATE, new Date(2026, 5, 12, 9).getTime()),
    true,
  );
});

test("effectiveShowState: ticketed flips to past 3 h after doors", () => {
  assert.equal(effectiveShowState("ticketed", SHOW_DATE, localMs(20)), "ticketed");
  assert.equal(effectiveShowState("ticketed", SHOW_DATE, localMs(22, 5)), "past");
});

test("effectiveShowState: watching and past are left alone", () => {
  assert.equal(effectiveShowState("watching", SHOW_DATE, localMs(23)), "watching");
  assert.equal(effectiveShowState("past", SHOW_DATE, localMs(12)), "past");
});

test("effectiveShowState: null date never flips", () => {
  assert.equal(effectiveShowState("ticketed", null, localMs(23)), "ticketed");
});

test("applyEffectiveShowState: maps endDate-aware rows, preserves identity when unchanged", () => {
  const live = { state: "ticketed", date: SHOW_DATE, endDate: null };
  // Pre-flip: the exact same object comes back (memo-friendly).
  assert.equal(applyEffectiveShowState(live, localMs(20)), live);
  // Post-flip: a new row with state past.
  const flipped = applyEffectiveShowState(live, localMs(22, 30));
  assert.notEqual(flipped, live);
  assert.equal(flipped.state, "past");
  // Multi-night run: anchored on the last night, so night one stays live.
  const run = { state: "ticketed", date: SHOW_DATE, endDate: "2026-06-13" };
  assert.equal(applyEffectiveShowState(run, localMs(23)).state, "ticketed");
  assert.equal(
    applyEffectiveShowState(run, new Date(2026, 5, 13, 22, 1).getTime()).state,
    "past",
  );
});
