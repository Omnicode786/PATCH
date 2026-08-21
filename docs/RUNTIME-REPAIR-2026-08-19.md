# PATCH runtime repair — 2026-08-19

This repair is based on `PATCH-production-runtime-repair-2026-08-18.zip` (SHA-256 `28b3b06edba775fca40a6c5b592a42b3b6dca20971d2fb5c94ae51bbe9b9dcc9`).

## Fixed in this revision

### Installed Electron app / black renderer

- Vite renderer `base` is now `./`, so the installed `file://.../renderer/index.html` resolves generated JS/CSS assets relative to the packaged renderer instead of looking for `/assets/...` at the filesystem root.
- Windows packaging now has a release gate that rejects renderer HTML containing root-absolute `/assets/` URLs before Electron Builder runs.
- The existing native SQLite packaged-runtime smoke remains in the packaging pipeline.

### Gemini planning-schema HTTP 400

- Small/context structured requests still exercise provider-side `responseJsonSchema`.
- The larger PATCH action-plan contract now uses `application/json` response mode with the full JSON Schema carried in the request text and then validates the returned object with `PatchPlanSchema` locally.
- The seventh staged Gemini diagnostic now tests the same planning transport used in production, preventing a provider-side planning-schema transport rejection from incorrectly degrading live-action requests into read-only advice.
- Tests assert that the planning request does not send `responseJsonSchema` while still carrying the schema and enforcing the local plan contract.

### Live Chrome page changes instead of DevTools advice

- PATCH system policy now explicitly classifies live page hide/remove/simplify/rearrange/resize/restyle requests as `WEB_PATCH` when the connected browser context and `browser.applyPatch` are available.
- `browser.applyPatch` tool metadata explicitly tells the planner to perform the live DOM change rather than return DevTools/source-edit instructions.
- Browser observations now include `parentId` relationships between observed DOM elements to improve grounded layout/container selection without arbitrary JavaScript.
- The existing restricted WebsitePatch DSL remains the execution boundary; model-generated JavaScript is not introduced.

### App awareness without an image

- Overlay sessions now default to `app` context. PATCH reads the active process/window from the Windows bridge before its overlay opens and does not silently capture a screenshot.
- Windows active-window metadata now includes `nativeWindowHandle`.
- Accessibility context can be rooted at that original native window handle, so opening the PATCH overlay does not make PATCH accidentally inspect its own window.
- Chrome/Edge/Brave/Chromium detection continues to activate the browser adapter from process metadata, so identifying Chrome does not require vision.

### “Just talk” / “Show screen” modes

- Overlay has a two-option context selector: **Just talk** and **Show screen**.
- **Just talk** uses app metadata, accessibility context, and connected specialized adapters without sharing a screenshot.
- **Show screen** explicitly captures the display, enables annotation tools, and hides PATCH UI during capture so PATCH is not baked into the screenshot.
- Switching modes preserves the originally detected target application even though the overlay has foreground focus.

### Rich assistant output

- Assistant result cards now render a safe React-based Markdown subset: headings, paragraphs, bold, italics, inline code, code fences, ordered/unordered lists, and blockquotes.
- Raw markers such as `##` and `**` are no longer presented as plain text in normal formatted answers.
- No raw HTML or `dangerouslySetInnerHTML` is used.

## Validation performed in this environment

- Original source ZIP checksum matched its `.sha256` manifest.
- TypeScript/TSX syntax transpile passed for all changed TS/TSX files using TypeScript 5.8.3.
- `apps/desktop/scripts/package-win.mjs` passes Node syntax checking.
- Root/desktop/Chrome manifest JSON parsing passed.
- Static repair assertions passed for Vite relative asset base, app-context default, IPC context-mode round trip, prompt-carried Gemini plan schema, browser hierarchy grounding, and rich-text renderer wiring.

## Validation that still requires Windows

This sandbox is Linux and does not contain the project dependency install or the .NET Windows Desktop SDK/runtime, so it cannot truthfully execute Electron/NSIS, Windows UI Automation, Chrome native messaging, or a real Gemini API-key diagnostic. On the target Windows machine, run the repository validation/package command and then verify:

1. The unpacked/installed PATCH renderer opens instead of a black surface.
2. Gemini 7-stage diagnostics reaches `planning-schema` successfully with the selected key/model.
3. With the Chrome extension/native host connected, open a page and ask PATCH to remove/simplify an observed section; PATCH should present/execute a grounded `browser.applyPatch` action rather than a DevTools tutorial.
4. Open PATCH in **Just talk** and confirm the context chip names Chrome while no screenshot is shared.
5. Switch to **Show screen**, annotate, and confirm image-grounded requests still work.
