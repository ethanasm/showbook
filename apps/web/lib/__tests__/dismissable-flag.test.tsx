import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useDismissableFlag } from "../dismissable-flag";

const KEY = "showbook:test-flag";

describe("useDismissableFlag", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults to not dismissed", () => {
    const { result } = renderHook(() => useDismissableFlag(KEY));
    assert.equal(result.current.dismissed, false);
  });

  it("reads the persisted flag on mount", () => {
    window.localStorage.setItem(KEY, "1");
    const { result } = renderHook(() => useDismissableFlag(KEY));
    assert.equal(result.current.dismissed, true);
  });

  it("dismiss() persists and flips state", () => {
    const { result } = renderHook(() => useDismissableFlag(KEY));
    act(() => {
      result.current.dismiss();
    });
    assert.equal(result.current.dismissed, true);
    assert.equal(window.localStorage.getItem(KEY), "1");
  });

  it("keys are independent", () => {
    window.localStorage.setItem(KEY, "1");
    const { result } = renderHook(() => useDismissableFlag("showbook:other-flag"));
    assert.equal(result.current.dismissed, false);
  });
});
