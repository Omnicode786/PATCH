> **Superseded runtime note (18 Aug 2026):** The Gemini Interactions transport described in older sections below is historical. The current implementation uses Gemini **GenerateContent** with `inlineData`, account model discovery/recovery, and strict post-response validation. See `GEMINI_ROOT_CAUSE.md` and `RUNTIME_FIX_REPORT_2026-08-18.md`.

# PATCH Production Repair Audit

Audit date: **2026-08-17**  
Source of truth: **the user's `PATCH-updated-fixed-regression-repair(1).zip`, `patch.jsonl`, and reproduced runtime screenshots/errors**.

This report distinguishes source/runtime behavior that was reproduced or executable in the delivery environment from Windows/provider checks that require the user's Windows machine, native runtime or private API credential.

## Confirmed problems and corrections

### Sloth companion opaque rectangle — VERIFIED ROOT CAUSE / STATIC + ASSET VERIFIED

The Electron companion window was already transparent, frameless and configured with a transparent background color. The visible black rectangle came from the renderer document itself: the shared renderer root painted an opaque `#0d0e11` canvas.

Correction:

- `html`, `body` and `#root` are transparent at the renderer base layer.
- the companion view is marked before React mounts and is forced transparent, preventing an opaque startup flash;
- `.sloth-companion-shell` and drag hit surface remain transparent;
- Settings owns its own warm opaque `.settings-shell` surface instead of relying on the global document canvas.

All 15 supplied PNG sheets were independently audited as RGBA images with real 0–255 alpha and dimensions matching the 512×512 frame manifest. The source art is unchanged.

### Companion growth / aggressive drag — UNIT VERIFIED / WINDOWS VISUAL CHECK REQUIRED

All movement now passes a fixed-bounds invariant. Drag updates change X/Y while always reapplying the constant 154×128 outer size. No animation state or velocity changes BrowserWindow width/height.

The previous game-like physics were replaced by calm companion motion:

- click/drag threshold: 7 px;
- visual lean capped around ±3°;
- release speed capped at 420 px/s;
- release maps to one bounded settle displacement of at most 12 px;
- no bounce, ricochet or continuous release timer;
- reduced motion produces zero inertial displacement;
- settled positions are clamped to the display work area and only then persisted.

Pure runtime assertions for size preservation, speed bands, release cap, settle distance, reduced motion, click/drag threshold and multi-monitor work-area clamping passed in this environment.

### Sloth animation pacing — STATIC VERIFIED / WINDOWS VISUAL CHECK REQUIRED

The runtime manifest now deliberately plays the supplied sheets at a lazy 2–6 FPS depending on state. Deep sleep is 2 FPS; active/thinking/drag/idle gestures are generally 5–6 FPS. Sprite registration stays on fixed 512×512 cells and the presentation viewport is square, so state changes do not resize or distort individual frames.

### Gemini multimodal 400 — ROOT CAUSE VERIFIED FROM USER DIAGNOSTIC / LIVE REPAIR NOT EXECUTED HERE

The user's 17 August staged diagnostic supplies the missing provider evidence. With `@google/genai` 2.17.0, Interactions `v1` and `gemini-3.5-flash`, authentication, text generation, structured output and system instruction all passed. The multimodal stage failed with HTTP 400 because Gemini interpreted the top-level second input item as a step and rejected the discriminator `image`.

Correction:

- all Gemini requests now use an explicit `user_input` step;
- text and image content live under that step's `content` array;
- request preflight rejects the previous ambiguous unwrapped direct-content array;
- diagnostics use the same production request shape;
- the bundled default is now the currently documented GA `gemini-3.6-flash` instead of stale `gemini-3.7-flash`;
- strict PATCH Zod validation after provider JSON parsing remains intact.

The source/unit shape is corrected, but a new authenticated diagnostic and real `patch:submit` must still be executed on the user's machine before this is called live-provider VERIFIED. See `GEMINI_ROOT_CAUSE.md`.

### Packaged shutdown SQLite crash — ROOT CAUSE VERIFIED / SOURCE REPAIRED

The installed app screenshot shows `TypeError: The database connection is not open` from session cleanup after window close. The source closed `PatchDatabase` in Electron `before-quit`, while overlay `closed` callbacks can still call `PatchOrchestrator.discardSession()` and read settings from that database.

Correction: SQLite remains open during window teardown and is closed in `will-quit`, after Electron has closed the windows. `before-quit` is limited to quitting state, capture cleanup and adapter shutdown.

### Packaged responsiveness — TARGETED STARTUP/POLLING REPAIR / WINDOWS PROFILING STILL REQUIRED

Three avoidable startup/runtime costs were reduced:

- the sloth companion no longer eagerly constructs/preloads every large sprite atlas; sheets load as their state is actually used;
- companion bootstrap/provider-status refresh was reduced from every 4 seconds to every 15 seconds;
- adapter health polling is read-only. A failing Windows sidecar is started once at app startup and retried only through the explicit **Connect / retry** action instead of being implicitly spawned/pinged by each status refresh.

These are concrete hot-path reductions, not a claim that all packaged performance has been profiled. Windows Task Manager/DevTools profiling is still required if lag remains after this build.

### Windows `spawnSync pnpm ENOENT` — ROOT CAUSE VERIFIED / HELPER UNIT VERIFIED / NSIS NOT EXECUTED HERE

`package-win.mjs` nested a `pnpm` invocation and later relied on Windows command shims. A parent pnpm process being available does not guarantee that Node's direct `execFileSync("pnpm", ...)` resolution will locate/execute a `.cmd` shim safely.

Correction:

- resolve the active pnpm JavaScript entry via `npm_execpath`;
- invoke it through `process.execPath` with an argument array;
- resolve Electron Builder's real package bin JS entry and invoke it through Node;
- never build a shell command string, so source paths containing spaces remain safe.

Executable helper assertions passed for JS-entry resolution, a Windows `.cmd` shim layout, paths with spaces, missing-pnpm diagnostics and package-bin resolution.

The packaging pipeline now independently publishes the self-contained win-x64 .NET bridge, builds the monorepo, invokes Electron Builder NSIS, checks the installer artifact, and runs `PATCH.exe --patch-smoke-native` against the unpacked packaged Electron runtime.

### Native SQLite packaging — STATIC VERIFIED / PACKAGED WINDOWS SMOKE NOT EXECUTED

`better-sqlite3` remains part of PATCH. pnpm is configured not to run the unnecessary source rebuild during install, Electron Builder does not run a second node-gyp rebuild, and the native dependency is unpacked from ASAR. Packaging fails if the resulting Electron executable cannot execute a real temporary SQLite write/read smoke test.

## Security regression audit

**STATIC VERIFIED:**

- Electron `contextIsolation:true` retained.
- renderer sandbox retained.
- `nodeIntegration:false` retained.
- `webSecurity:true` retained.
- dev renderer trust is exact-origin, not string-prefix matching.
- packaged renderer trust is exact local renderer path.
- privileged IPC requires the trusted main frame.
- navigation/window-open restrictions are installed before renderer loading.
- provider keys remain in the existing Electron `safeStorage` credential vault.
- provider diagnostics omit prompts, screenshots, authorization headers and raw credentials.
- no arbitrary shell/JavaScript planner tool was introduced.

## Adapter audit

- **Windows UI Automation:** desktop starts the native sidecar once where supported; health polling reads actual process state without launching it. Settings exposes **Connect / retry** and the last startup error. Development discovery checks Debug, Release and self-contained Release publish outputs; packaged mode uses the bundled bridge resource.
- **Chrome / Edge:** Settings now opens the packaged MV3 extension directory, accepts the browser-issued 32-character extension ID, and invokes the bundled PowerShell host registrar with argument-array process execution. The registrar creates the user-level native-messaging manifest/registry entry for the exact extension origin and bridge executable. The UI tells the user to reload the extension and reports actual pipe connection state.
- **Photoshop UXP:** Settings opens the packaged plugin folder and gives the Adobe UXP Developer Tool Add Plugin → manifest → Load → panel → pairing flow. Authenticated loopback pairing and UXP secure storage remain intact.
- **No fake connections:** all three statuses continue to reflect real runtime connection state.

## Verification executed against this edited source tree

| Check | Status | Result |
|---|---|---|
| Repository source/security lint | VERIFIED | `PATCH lint passed.` |
| TS/TSX parser pass | VERIFIED | 58 source files, 0 parse errors |
| Focused strict TypeScript | VERIFIED | companion assets/state/motion compile under strict + exact optional + unchecked index settings |
| JS/MJS/CJS syntax | VERIFIED | all non-generated scripts passed `node --check` |
| JSON/YAML parse | VERIFIED | project JSON, lock/workspace and packaging YAML parse |
| Workspace topology | VERIFIED | 14 projects including root; all 13 workspace package importers exist in lockfile |
| Sloth production assets | VERIFIED | 15/15 RGBA sheets, real alpha, manifest geometry correct |
| Companion pure runtime assertions | UNIT VERIFIED | fixed size, bands, clamp, click/drag, release cap/settle/reduced motion passed |
| Packaging command resolution | UNIT VERIFIED | active pnpm JS, shim layout, spaces, missing command and package-bin cases passed |
| Credential literal audit | STATIC VERIFIED | no real credential was found; only an intentionally fake key-shaped redaction-test fixture exists |
| Full `pnpm install --frozen-lockfile` | BLOCKED BY ENVIRONMENT | delivery Linux sandbox cannot currently resolve npm registry through Corepack |
| Full workspace `pnpm typecheck/test/build` | NOT EXECUTED on final revision | dependency-aware final pass requires restored dependencies; source/parser/focused checks above executed |
| .NET Release Windows build | BLOCKED BY ENVIRONMENT | .NET Windows Desktop runtime unavailable in this Linux sandbox |
| `pnpm package:win` / NSIS | BLOCKED BY ENVIRONMENT | Windows-only by design |
| Packaged Electron SQLite smoke | BLOCKED BY ENVIRONMENT | executed automatically by `package:win` on Windows |
| Live Gemini stages / `patch:submit` | NOT EXECUTED | requires user's private key and network runtime |
| Physical sloth transparency/drag visual inspection | NOT EXECUTED here | requires Windows transparent BrowserWindow compositor |


The user-provided `patch.jsonl` independently confirms that the 17 August diagnostic reached and passed the first four Gemini stages before failing specifically at multimodal input. That evidence is the basis for the request-shape correction; it is not inferred from a generic 400.

## Required Windows release gate

From a freshly extracted archive:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
dotnet build .\apps\windows-bridge\Patch.WindowsBridge.csproj -c Release
pnpm --filter @patch/desktop dev
```

Then validate the sloth visually and run Gemini staged diagnostics plus a real PATCH submission. Finally:

```powershell
pnpm package:win
# or complete installer flow without launching it:
.\INSTALL_PATCH.ps1 -BuildOnly
```

The release must not be called Windows-installer VERIFIED until NSIS creation and the packaged native SQLite smoke pass on Windows. The Gemini issue must not be called live VERIFIED until a real authenticated `patch:submit` completes through `GeminiProvider.planActions()`.
