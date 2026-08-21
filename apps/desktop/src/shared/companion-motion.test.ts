import { describe, expect, it } from "vitest";
import {
  DRAG_CLICK_THRESHOLD, MAX_RELEASE_SPEED, MAX_SETTLE_DISTANCE, classifyDragSpeed, clampCompanionPosition,
  clampReleaseVelocity, fixedCompanionBounds, isDragGesture, releaseSettleOffset
} from "./companion-motion";

describe("companion drag motion", () => {
  it("classifies drag speed without making ordinary movement feel fast", () => {
    expect(classifyDragSpeed(0)).toBe("slow");
    expect(classifyDragSpeed(249)).toBe("slow");
    expect(classifyDragSpeed(250)).toBe("medium");
    expect(classifyDragSpeed(649)).toBe("medium");
    expect(classifyDragSpeed(650)).toBe("fast");
  });

  it("clamps a restored companion position to the usable work area", () => {
    const workArea = { x: -1920, y: 0, width: 1920, height: 1040 };
    const size = { width: 154, height: 128 };
    expect(clampCompanionPosition({ x: -9999, y: 9999 }, workArea, size, 6)).toEqual({ x: -1914, y: 906 });
  });

  it("preserves the companion outer size whenever it moves", () => {
    expect(fixedCompanionBounds({ x: 37.6, y: 81.3 }, { width: 154, height: 128 })).toEqual({ x: 38, y: 81, width: 154, height: 128 });
  });

  it("caps release velocity and limits release settle to a tiny displacement", () => {
    expect(clampReleaseVelocity(MAX_RELEASE_SPEED * 4)).toBe(MAX_RELEASE_SPEED);
    const offset = releaseSettleOffset(5000, -5000, false);
    expect(Math.hypot(offset.x, offset.y)).toBeLessThanOrEqual(MAX_SETTLE_DISTANCE + 0.001);
    expect(releaseSettleOffset(5000, 5000, true)).toEqual({ x: 0, y: 0 });
  });

  it("separates clicks from drags using a stable movement threshold", () => {
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10 + DRAG_CLICK_THRESHOLD - 1, y: 10 })).toBe(false);
    expect(isDragGesture({ x: 10, y: 10 }, { x: 10 + DRAG_CLICK_THRESHOLD, y: 10 })).toBe(true);
  });
});
