import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysUntil,
  formatDateLong,
  formatDateMedium,
  formatDateParts,
  formatDateRangeLong,
  formatOnSaleDate,
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

test("toSetlistFmDate: dd-MM-yyyy", () => {
  // Use explicit local-midnight date to match implementation
  const d = new Date(2024, 5, 15);
  assert.equal(toSetlistFmDate(d), "15-06-2024");
});
