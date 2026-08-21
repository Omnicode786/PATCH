import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("renderer transparency contract", () => {
  it("leaves the base document transparent while Settings owns an opaque surface", async () => {
    const css = await readFile(new URL("./styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/html, body, #root[^}]*background:transparent/);
    expect(css).toMatch(/html\[data-view="companion"\][^}]*background:transparent !important/);
    expect(css).toMatch(/\.settings-shell[^}]*background:var\(--bg\)/);
    expect(css).toMatch(/\.sloth-companion-shell[^}]*background:transparent !important/);
  });
});
