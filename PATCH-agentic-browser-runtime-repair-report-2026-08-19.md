# PATCH Agentic Browser Runtime Repair — 2026-08-19

## Source integrity

Source of truth: `PATCH-production-runtime-repair-2026-08-19.zip`

Verified input SHA-256 before modification:

`553291b0e67e47d4b792a04223b6354267c585ffa57cc269eedfbffc3ce44cf4`

Result: **PASS — exact match.**

## Root cause / first incorrect transition

The first incorrect transition was **browser capability discovery → invocation tool eligibility**.

In the source archive, `BrowserBridgeServer.connected` meant only that a named-pipe socket existed. During invocation, the orchestrator then attempted `browser.getContext()`, silently swallowed any failure, and left `browserContext` undefined. The invocation tool filter removed every `browser.*` tool whenever `browserContext` was absent. Consequently, `ActionPlanningRequest` could be generated without `browser.applyPatch` even though Settings appeared to show the Chrome integration as connected. The same submit path was then allowed to degrade a planning failure, a QUESTION/EXPLANATION plan, or a zero-action plan into `analyzeContext()`, which is why a live mutation request could become manual DevTools/source-code advice.

A reproducible trigger existed in the MV3 extension path: after an unpacked extension is installed/reloaded, an already-open tab may not yet contain PATCH's content script. The old service worker directly called `tabs.sendMessage`; that failed, while the desktop still considered the native pipe “Connected.” The repair does not assume that this is the only possible context failure: all stages are now measured independently and actionable requests fail with the actual missing stage instead of losing tools silently.

## Architectural repair

The repaired path is:

`original active Chrome window → staged adapter health → semantic browser context → runtime WEB_PATCH classification → eligible ToolRegistry capabilities → provider PatchPlan → schema/target/risk/permission validation → browser.applyPatch → restricted WebsitePatch DSL → post-state verification/re-observation → result`

Key changes:

- Preserves the original process/executable/window title/native window handle captured before the PATCH overlay appears.
- Adds conservative runtime `WEB_PATCH` intent classification for generic live-page mutation requests. No YouTube command or selector is hard-coded.
- Separates browser health into native bridge, active tab, content adapter, semantic DOM, and mutation capability instead of a one-bit Connected state.
- Uses Chrome's **last-focused browser window** to resolve the active tab after PATCH itself becomes foreground.
- Recovers already-open tabs by injecting only PATCH's static bundled `content.js` when Chrome reports that no receiving content script exists. No model JavaScript, `eval`, shell, generic CDP execution, or arbitrary browser scripting was added.
- Keeps `browser.applyPatch` visible to planning only after real semantic context exists; if an actionable request loses the tool, PATCH now reports `TOOL_NOT_ELIGIBLE` instead of becoming a chatbot.
- Actionable `WEB_PATCH` requests may no longer silently degrade to the read-only conversational analyzer.
- A planner that returns QUESTION/EXPLANATION/no action for a runtime-proven `WEB_PATCH`, or asks which PATCH Chrome adapter is meant, is rejected instead of being presented as manual advice.
- Browser-first routing is enforced while the deterministic browser adapter is healthy; Windows/coordinate mutation tools are not accepted as a silent downgrade in the same WEB_PATCH plan.
- `browser.applyPatch` now performs: apply → wait for client-render reaction → `browser.verifyPatch` → fresh `browser.getContext` observation. Sending a native message is not treated as task success.
- The content adapter records stable locators for grounded DOM targets, reconciles a framework-replaced element after a client-rendered rerender, preserves the original `dom-*` identity where the locator still resolves, re-applies the restricted operation, and supports restore/undo.
- Protocol mismatch fails closed: a connected but stale extension cannot advertise semantic/mutation eligibility.
- Native-host registration is inspected from the actual per-user Windows registry entry and manifest. Stale manifest paths, bridge executables, or mismatched extension IDs are reported.
- Chrome and Edge use separate generated native-host manifest files so one registration does not overwrite the other's manifest on disk.
- Windows packaging now fails if the built Chrome bundle or desktop main bundle lacks current agentic-runtime markers, reducing source/dist divergence.
- Developer diagnostics expose safe invocation stages/tool names/results without prompts, screenshots, secrets, or full provider payloads.

## Security preserved

The repair keeps:

- Manifest V3;
- native messaging + named-pipe bridge;
- restricted `WebsitePatch` DSL;
- grounded observed `dom-*` targets;
- ToolRegistry validation;
- permission gates and confirmation/risk policy;
- browser patch reversibility/undo;
- `contextIsolation`, renderer sandbox, and existing IPC sender checks;
- BYOK/safeStorage/provider selection;
- redacted structured logging.

No arbitrary JavaScript execution, `eval`, `new Function`, model-provided Chrome scripting, generic shell tool, or unrestricted Chrome DevTools Protocol execution was introduced.

## Tests/regression coverage added

Repository tests now cover:

- runtime action classification for generic browser mutation language;
- planner visibility of `browser.applyPatch` after all invocation filtering;
- real ToolRegistry execution of `browser.applyPatch` and post-state verification;
- verification failure not being reported as success;
- explicit “use your Chrome extension” wording without adapter-identity clarification;
- disconnected bridge and unreachable content adapter producing concrete capability diagnostics instead of chatbot advice;
- protocol mismatch failing closed;
- conversational/zero-action plan rejection for a runtime-classified WEB_PATCH;
- no downgrade to lower-priority Windows/coordinate mutation tools while deterministic browser mutation is available;
- genuine target ambiguity remaining allowed;
- preservation of original Chrome process/native window handle;
- `browser.restorePatch` undo path;
- Gemini WEB_PATCH planning request carrying the exact live `browser.applyPatch` capability;
- OpenAI WEB_PATCH planning request carrying the exact live `browser.applyPatch` capability;
- MV3 already-open-tab recovery through the static bundled content adapter;
- dynamic SPA-style rerender: semantic context → HIDE → verify → element replacement → reconcile/reapply with same grounded ID → verify → restore.

## Files changed

- `adapters/chrome/public/manifest.json`
- `adapters/chrome/scripts/install-native-host.ps1`
- `adapters/chrome/src/chrome-types.ts`
- `adapters/chrome/src/content.ts`
- `adapters/chrome/src/content.runtime.test.mjs` (new)
- `adapters/chrome/src/service-worker.ts`
- `adapters/chrome/src/service-worker.runtime.test.mjs` (new)
- `apps/desktop/scripts/package-win.mjs`
- `apps/desktop/src/main/action-intent.ts` (new)
- `apps/desktop/src/main/action-intent.test.ts` (new)
- `apps/desktop/src/main/browser-bridge.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/orchestrator.ts`
- `apps/desktop/src/main/orchestrator.browser-agent.test.ts` (new)
- `apps/desktop/src/main/register-tools.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/global.d.ts`
- `apps/desktop/src/renderer/ui.tsx`
- `package.json`
- `packages/ai-core/src/index.ts`
- `packages/provider-gemini/src/index.ts`
- `packages/provider-gemini/src/index.test.ts`
- `packages/provider-gemini/src/diagnostics.test.ts`
- `packages/provider-openai/src/index.ts`
- `packages/provider-openai/src/index.test.ts` (new)
- `packages/shared/src/index.ts`
- `scripts/validate-agentic-browser-runtime.mjs` (new)
- `PATCH-agentic-browser-runtime-repair-report-2026-08-19.md` (new deliverable report)

The Gemini test casts also retain the earlier strict TypeScript repair for `GenerateContentConfig` versus `Record<string, unknown>` by intentionally crossing the mock-inspection boundary through `unknown`.

## Validation actually executed in this environment

The following were genuinely run against the repaired source:

| Check | Result |
|---|---|
| Input ZIP SHA-256 | PASS — exact expected hash |
| `node scripts/lint.mjs` | PASS |
| `node scripts/validate-agentic-browser-runtime.mjs` | PASS |
| Node syntax checks over repository `.mjs` scripts/tests | PASS |
| TypeScript syntax parser over 48 selected TS/TSX source files | PASS — 48/48 |
| Strict targeted Chrome adapter source compile using global TypeScript + temporary local PATCH-DSL declarations | PASS |
| Executable matrix from the actual transpiled `action-intent.ts` | PASS — 11 actionable + 4 negative cases |
| Executable matrix from the actual transpiled `PatchOrchestrator` | PASS — planner visibility, execution, explicit-adapter wording, capability failures, no chatbot degradation |
| Executable matrix from actual transpiled `register-tools.ts` | PASS — apply → verify → post-context observation → undo registration |
| Executable matrix from actual transpiled Chrome service worker | PASS — native request → last-focused tab → static `content.js` recovery → semantic/mutation readiness |
| Executable matrix from actual transpiled content adapter | PASS — semantic context → HIDE → verify → SPA replacement/reconcile → stable target ID → verify → undo |

These executable matrices exercise the repaired production source with deterministic local fakes for unavailable OS/browser dependencies. They are not presented as a substitute for a real Windows browser run.

## Validation that could not genuinely be executed here

This delivery environment is Linux and cannot reach the npm registry. Corepack attempts to fetch `pnpm@11.21.0` and fails with `getaddrinfo EAI_AGAIN registry.npmjs.org`. The .NET SDK is also not installed.

Therefore the following commands were **not** falsely claimed as run here:

- `corepack enable` + complete `pnpm install` dependency resolution;
- full workspace `pnpm typecheck`;
- full workspace `pnpm test` / Vitest suite;
- full workspace `pnpm build`;
- live provider diagnostic suite with installed workspace dependencies/real keys;
- `dotnet build .\apps\windows-bridge\Patch.WindowsBridge.csproj`;
- `pnpm package:win`;
- NSIS installer execution;
- installed Electron Windows runtime;
- Windows registry/native-host execution;
- real `Patch.WindowsBridge.exe` native-messaging pipe;
- real Chrome/Edge extension service worker/content script;
- live YouTube acceptance test.

Those Windows gates must be run on the target Windows machine before calling the binary release-validated.

## Windows build/install and acceptance procedure

1. Extract the corrected ZIP to a normal writable folder.
2. Double-click `SETUP_PATCH.cmd` from the `PATCH` root. The script installs/checks Node 22, .NET 8 and pnpm 11.21.0 as needed, runs lint/typecheck/tests/build, builds the Windows bridge, packages the NSIS installer, and launches that installer when the verification gate passes.
3. Install and launch PATCH.
4. Open **Settings → Adapters → Chrome / Edge** and choose **Open extension folder**.
5. In `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select that packaged PATCH extension folder.
6. Copy the browser-generated 32-character extension ID into PATCH Settings, select Chrome or Edge, and choose **Register native host**.
7. Reload the PATCH extension and reload the current tab once. If a prior install left a stale registration, PATCH now reports **Stale**; register the native host again so the manifest points at the currently installed bridge executable.
8. Do not rely on a single Connected label. Confirm PATCH reports:
   - Native host: **Verified**
   - Native bridge: **Connected**
   - Active tab: **Reachable**
   - Content adapter: **Reachable**
   - Semantic DOM: **Available**
   - Live mutation: **Available**
   - overall Chrome browser agent: **Ready**
9. Open a YouTube watch page, leave Chrome as the original foreground application, invoke PATCH, keep **Just talk** mode, and ask: `Remove the YouTube sidebar.` A screenshot should not be required for Chrome identity or semantic DOM mutation.
10. PATCH should produce a grounded WEB_PATCH plan. With the default security policy, reversible actions still require confirmation unless **Perform reversible actions without confirmation** is enabled. Confirm if prompted.
11. Verify the live page changes and PATCH reports success only after post-state verification. Test the existing undo/restore path and confirm the sidebar returns.
12. Repeat on a second normal website with: `Make this page simpler and hide the sidebar.`
13. Repeat with: `Use your Chrome extension to remove the sidebar.` It must not ask which extension/adapter is meant.
14. Disconnect/reload-disable the browser adapter and repeat. PATCH should identify the actual unavailable stage rather than claiming execution or returning DevTools instructions.

## Packaged-runtime gate added

`pnpm package:win` now verifies that the current built artifacts contain the staged browser health, static content-adapter recovery, post-patch verification, planner diagnostics, and current desktop orchestration markers before Electron Builder is allowed to produce the installer. This specifically guards against a fixed source tree being packaged with stale Chrome or desktop `dist` output.
