import { describe, expect, it } from "vitest";
import { WebsitePatchSchema } from "./index";

describe("PATCH DSL", () => {
  it("accepts target-bound transformations", () => {
    expect(WebsitePatchSchema.parse({ version: "1", operations: [{ opId: "1", action: "HIDE", target: "dom-4" }] }).operations).toHaveLength(1);
  });

  it("rejects CSS URL injection", () => {
    expect(() => WebsitePatchSchema.parse({ version: "1", operations: [{ opId: "1", action: "RESTYLE", target: "dom-4", styles: { backgroundColor: "url(https://evil.invalid/x)" } }] })).toThrow();
  });
});
