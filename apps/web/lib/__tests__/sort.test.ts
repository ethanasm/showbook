import { test } from "node:test";
import assert from "node:assert/strict";
import { compareNullable } from "../sort";

const numCmp = (a: number, b: number) => a - b;
const strCmp = (a: string, b: string) => a.localeCompare(b);

test("compareNullable: equal non-null values yield 0", () => {
  assert.equal(compareNullable(5, 5, numCmp), 0);
  assert.equal(compareNullable("foo", "foo", strCmp), 0);
});

test("compareNullable: defers to cmp when neither is null", () => {
  assert.ok(compareNullable(1, 2, numCmp) < 0);
  assert.ok(compareNullable(2, 1, numCmp) > 0);
});

test("compareNullable: null sorts after non-null (a null → +1)", () => {
  assert.equal(compareNullable(null, 1, numCmp), 1);
});

test("compareNullable: null sorts after non-null (b null → -1)", () => {
  assert.equal(compareNullable(1, null, numCmp), -1);
});

test("compareNullable: both null yields 0", () => {
  assert.equal(compareNullable(null, null, numCmp), 0);
  assert.equal(compareNullable(undefined, undefined, numCmp), 0);
  assert.equal(compareNullable(null, undefined, numCmp), 0);
});

test("compareNullable: works with arrays sorted ascending — nulls land at the end", () => {
  const arr = [3, null, 1, 2, undefined];
  arr.sort((a, b) => compareNullable(a, b, numCmp));
  assert.deepEqual(arr.slice(0, 3), [1, 2, 3]);
  // The last two items are some permutation of [null, undefined]; both null-like.
  assert.equal(arr[3] == null, true);
  assert.equal(arr[4] == null, true);
});
