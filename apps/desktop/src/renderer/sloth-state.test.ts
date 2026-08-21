import { describe, expect, it } from "vitest";
import { animationForState, stateAfterAnimation, type LocalSlothState } from "./sloth-state";

const states: LocalSlothState[] = ["idle", "active", "thinking", "success", "error", "listening", "responding", "drop", "click"];

describe("sloth state controller", () => {
  it("maps every runtime state to a supplied production sprite", () => {
    for (const state of states) {
      const animation = animationForState(state);
      expect(animation.file).toMatch(/^sloth_.*\.png$/);
      expect(animation.count).toBeGreaterThan(0);
    }
  });

  it("settles one-shot reaction states back to idle", () => {
    for (const state of ["active", "success", "error", "drop", "click"] as const) {
      expect(stateAfterAnimation(state)).toBe("idle");
    }
  });

  it("keeps continuous attention states until main-process state changes", () => {
    for (const state of ["idle", "thinking", "listening", "responding"] as const) {
      expect(stateAfterAnimation(state)).toBe(state);
    }
  });
});
