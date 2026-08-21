import { describe, expect, it } from "vitest";
import { AdapterResponseSchema, createRequest } from "./index";

describe("versioned protocol", () => {
  it("creates v1 request envelopes", () => expect(createRequest("ping").protocolVersion).toBe("1"));
  it("rejects a failed response with no typed error", () => expect(() => AdapterResponseSchema.parse({ protocolVersion: "1", requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), kind: "response", ok: false })).toThrow());
});
