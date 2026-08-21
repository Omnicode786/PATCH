# PATCH browser-context invocation repair — 2026-08-20

## Scope

This repair is based on `PATCH-agentic-browser-runtime-fixed-2026-08-19-v2.zip` and preserves the existing provider, security, restricted WebsitePatch DSL, native-host, undo, Windows UIA, Photoshop, packaged renderer, BYOK, Just Talk, and Show Screen architecture.

## Code-level root cause

The browser adapter health screen and the actual invocation took different paths.

The Chrome status screen queried the extension/native bridge directly, so it could correctly show **Native bridge connected / active tab reachable / semantic DOM available / live mutation available**.

However, an invocation only acquired semantic browser context when the preserved `activeApplication.processName` was Chrome/Edge/Brave/Chromium. The floating companion was created as a normal focusable Electron `BrowserWindow`. A mouse click on that companion could activate PATCH before `openOverlay()` called `orchestrator.createInvocation()`. The invocation could therefore preserve PATCH/Electron as the foreground application instead of the Chrome window that the user was actually working in.

That creates this exact split:

```
Chrome adapter status: ready
        ↓
user clicks floating PATCH companion
        ↓
PATCH companion may become foreground
        ↓
createInvocation() observes PATCH/Electron, not chrome.exe
        ↓
#context() refuses browser.getContext because original app is not a browser
        ↓
no browserContext / no dom-* targets
        ↓
browser tools are filtered out before planning
        ↓
planner receives observation context without semantic DOM targets
```

This explains how Settings could be fully green while the assistant still reported `BROWSER_CONTEXT_EMPTY` / no semantic DOM targets.

A second diagnostic weakness made the problem harder to distinguish: Settings treated the lightweight content-adapter ping as proof of semantic context readiness. It did not execute the same `browser.getContext` + `BrowserContextSchema` path used by real invocations.

## Repairs

1. **Floating companion no longer steals foreground focus**
   - `apps/desktop/src/main/index.ts`
   - The companion is created with `focusable: false` and is explicitly kept non-focusable with `setFocusable(false)`.
   - Clicking the sloth can still invoke PATCH, but the original Chrome/Photoshop/etc. application remains the Windows foreground target during invocation capture.

2. **Settings now verifies the real semantic context path**
   - `apps/desktop/src/main/browser-bridge.ts`
   - Added `probeReadiness()`.
   - A green Ready state now requires a successful, schema-validated `browser.getContext()` with observed DOM targets; a ping by itself is no longer enough.

3. **Adapter UI exposes real observed DOM readiness**
   - `apps/desktop/src/main/index.ts`
   - `apps/desktop/src/renderer/global.d.ts`
   - `apps/desktop/src/renderer/ui.tsx`
   - Status now includes `contextVerified` and `observedDomNodeCount`.

4. **Invocation diagnostics can see browser health even when the foreground target is wrong**
   - `apps/desktop/src/main/orchestrator.ts`
   - Browser health is queried read-only for diagnostics regardless of foreground process, but semantic DOM is still only acquired for a preserved Chromium target. This keeps the security/application-routing boundary intact.
   - Failed or empty `browser.getContext()` now downgrades the effective browser status and records a concrete failure message rather than leaving a misleading healthy status.

5. **Natural browser-action classification regression fixed**
   - `apps/desktop/src/main/action-intent.ts`
   - Handles `wider`, `narrower`, `larger`, `smaller`, `expand`, and `shrink` in addition to existing live-page mutation wording.

6. **Regression tests improved**
   - `apps/desktop/src/main/action-intent.test.ts`
   - Added natural sizing variants.
   - `apps/desktop/src/main/browser-bridge.test.ts`
   - Added readiness tests proving the status cannot be green when real semantic context acquisition is empty or fails.
   - `adapters/chrome/src/content.runtime.test.mjs`
   - Increased the dynamic SPA reconciliation test timeout to 15 seconds so Windows cold-transform runs do not fail at Vitest's default 5-second limit.

7. **Packaging/static gates updated**
   - `scripts/validate-agentic-browser-runtime.mjs`
   - `apps/desktop/scripts/package-win.mjs`
   - Packaging now checks that the non-focusable companion and verified-readiness code are present in the current build so stale bundles cannot silently regress this repair.

## Validation actually run in this environment

Passed:

- `node scripts/lint.mjs`
- `node scripts/validate-agentic-browser-runtime.mjs` — 18/18 checks
- TypeScript parser pass across 63 `.ts` / `.tsx` source files
- Direct runtime smoke of `classifyRuntimeActionIntent()` for:
  - Remove the sidebar.
  - Make the video area wider.
  - Make the sidebar narrower.
  - Make the article larger.
  - Shrink this panel.
  - Reduce the clutter on this page.
  - Use your Chrome extension and remove the sidebar.
- Informational negative case: `How do I remove a sidebar in DevTools?` remains non-actionable.

## Validation not genuinely executable here

This environment is Linux and has no real Windows desktop/native-messaging runtime. It also cannot fetch the pinned pnpm release from npm, so the complete dependency-aware Windows gates cannot honestly be claimed here.

Run these on the target Windows machine:

```powershell
pnpm --filter @patch/adapter-chrome test
pnpm --filter @patch/desktop test
pnpm lint
pnpm typecheck
pnpm test
pnpm build
dotnet build .\apps\windows-bridge\Patch.WindowsBridge.csproj -c Release
pnpm package:win
```

Then load/reload the packaged PATCH extension, focus a normal Chrome page, invoke PATCH by clicking the companion or using `Ctrl+Shift+Space`, and confirm the overlay identifies Chrome as the original target before testing `Remove the sidebar.`
