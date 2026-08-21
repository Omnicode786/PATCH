import { describe, expect, it } from "vitest";
import { SLOTH_ASSETS } from "./sloth-assets";

describe("sloth playback tuning", () => {
  it("keeps ordinary animations deliberately lazy", () => {
    for (const [name, meta] of Object.entries(SLOTH_ASSETS)) {
      if (name === "sloth_deep_sleep.png") continue;
      expect(meta.fps).toBeGreaterThanOrEqual(5);
      expect(meta.fps).toBeLessThanOrEqual(6);
    }
  });

  it("keeps deep sleep exceptionally slow", () => {
    expect(SLOTH_ASSETS["sloth_deep_sleep.png"].fps).toBeLessThanOrEqual(3);
  });
});
