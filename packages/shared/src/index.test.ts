import { describe, expect, it } from "vitest";
import { PatchError } from "./index";
describe("PatchError", () => { it("retains a typed code", () => expect(new PatchError("TARGET_NOT_FOUND", "missing").code).toBe("TARGET_NOT_FOUND")); });
