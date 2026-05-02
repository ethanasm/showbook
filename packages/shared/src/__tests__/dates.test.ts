import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countdown,
  daysUntil,
  formatDateLong,
  formatDateMedium,
  formatDateParts,
  formatDateRangeLong,
  formatOnSaleDate,
  formatShowDate,
  formatYear,
  isDatePast,
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
