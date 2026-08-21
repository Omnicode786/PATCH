import { describe, expect, it } from "vitest";
import { classifyRuntimeActionIntent } from "./action-intent";

const chrome = { processName: "chrome.exe", windowTitle: "Example" };

describe("runtime browser action intent", () => {
  for (const prompt of [
    "Remove the sidebar.",
    "Hide the recommendations.",
    "Make this page simpler and hide the sidebar.",
    "Get rid of the right column.",
    "Make the video area wider.",
    "Make the sidebar narrower.",
    "Make the article larger.",
    "Shrink this panel.",
    "Reduce the clutter on this page.",
    "Move this section above that one.",
    "Use your Chrome extension and remove the sidebar."
  ]) {
    it(`classifies ${JSON.stringify(prompt)} as WEB_PATCH`, () => {
      expect(classifyRuntimeActionIntent(prompt, chrome)).toMatchObject({ actionable: true, requestClass: "WEB_PATCH", requestedCapability: "browser.applyPatch" });
    });
  }

  it("does not turn an explanation request into an action", () => {
    expect(classifyRuntimeActionIntent("How do I remove a sidebar in DevTools?", chrome).actionable).toBe(false);
  });

  it("does not classify a non-browser foreground app as WEB_PATCH", () => {
    expect(classifyRuntimeActionIntent("Remove the sidebar.", { processName: "notepad.exe" }).actionable).toBe(false);
  });
});
