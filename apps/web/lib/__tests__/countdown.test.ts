import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { countdownText } from "../countdown";

// Freeze "now" by replacing the Date constructor's no-arg path. We construct
// a real Date in the host's local zone so `setHours(0,0,0,0)` in countdownText
// produces a deterministic local midnight regardless of where the test runs.
const RealDate = Date;
function freezeNow(localYear: number, localMonth: number, localDay: number, hour = 12) {
  class FrozenDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(localYear, localMonth - 1, localDay, hour, 0, 0, 0);
        return;
      }
      // Date's constructor overloads can't be represented as a single tuple,
      // so cast through `any` to forward the variadic args verbatim.
      super(...(args as ConstructorParameters<typeof Date>));
    }
    static override now() {
      return new FrozenDate().getTime();
    }
  }
  globalThis.Date = FrozenDate as unknown as DateConstructor;
}
function restoreNow() {
  globalThis.Date = RealDate;
}

before(() => freezeNow(2026, 5, 8));
after(() => restoreNow());

test("countdownText: null -> 'date TBD'", () => {
  assert.equal(countdownText(null), "date TBD");
});

test("countdownText: same calendar date -> 'tonight'", () => {
  assert.equal(countdownText("2026-05-08"), "tonight");
});

test("countdownText: next calendar date -> 'tomorrow' (regression: zone-less dates west of UTC)", () => {
  // Bug: `new Date('2026-05-09')` parses as UTC midnight; in zones west of
  // UTC `setHours(0,0,0,0)` rolled it back to 2026-05-08, so the home page
  // labelled tomorrow's show as "tonight".
  assert.equal(countdownText("2026-05-09"), "tomorrow");
});

test("countdownText: future date -> 'in N days'", () => {
  assert.equal(countdownText("2026-05-15"), "in 7 days");
});

test("countdownText: past date -> 'N days ago'", () => {
  assert.equal(countdownText("2026-05-05"), "3 days ago");
});

test("countdownText: full ISO timestamp on the same calendar day -> 'tonight'", () => {
  assert.equal(countdownText("2026-05-08T20:00:00Z"), "tonight");
});
