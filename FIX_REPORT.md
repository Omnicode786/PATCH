> **Superseded runtime note (18 Aug 2026):** The Gemini Interactions transport described in older sections below is historical. The current implementation uses Gemini **GenerateContent** with `inlineData`, account model discovery/recovery, and strict post-response validation. See `GEMINI_ROOT_CAUSE.md` and `RUNTIME_FIX_REPORT_2026-08-18.md`.

# PATCH Final Repair Report

Source of truth: **`PATCH-fixed.zip`** supplied by the user.

## Problems reproduced

- Transparent Electron companion still showed a large opaque black renderer rectangle.
- Drag behavior was too aggressive and the companion needed a hard fixed-size invariant.
- Sloth animations played too quickly for the intended lazy character.
- Settings/adapters UX was visually sterile and provider failures lacked actionable staged diagnostics.
- Gemini could still surface a generic `400 Request contains an invalid argument` during real PATCH work despite the provider-native schema already existing in this archive.
- Windows packaging could fail at nested `spawnSync pnpm ENOENT` even though the outer process was already running under pnpm.
- Native SQLite needed a packaged-Electron ABI/runtime gate rather than assuming installer creation meant runtime success.

## Root causes

### Black companion surface

The BrowserWindow itself already used transparency correctly. The shared renderer `:root` painted an opaque `#0d0e11` document canvas, so transparent desktop pixels were never visible.

### Drag/growth risk

The companion lacked one authoritative movement function that guaranteed width/height stayed unchanged. Previous release physics also treated the sloth like a throwable object, with much larger rotation/release velocity and repeated post-release motion.

### Gemini diagnosis gap

A historical PATCH revision did send a general Zod JSON Schema containing provider-unsupported constraints, but the current `PATCH-fixed.zip` already has a hand-authored Gemini provider schema. Therefore the user's remaining live 400 cannot honestly be assigned to that historical field without a current network trace. The current UI/error normalization collapsed too many provider layers into one generic invalid-request message.

### Windows packaging ENOENT

Nested Node packaging code directly invoked the command name `pnpm`/Windows `.cmd` wrappers. That depends on PATH/PATHEXT/shim behavior and is less reliable than invoking the actual JavaScript CLI through the already-running Node executable.

## Files changed

Important source changes include:

- `INSTALL_PATCH.ps1`
- `package.json`
- `AUDIT_REPORT.md`
- `DECISIONS.md`
- `GEMINI_ROOT_CAUSE.md`
- `FIX_REPORT.md`
- `README.md`, `ADAPTER_SETUP.md`, `DELIVERY_MANIFEST.md`, `docs/VALIDATION.md`
- `apps/desktop/electron-builder.yml`
- `apps/desktop/scripts/package-win.mjs`
- `apps/desktop/scripts/package-tools.mjs`
- `apps/desktop/scripts/package-tools.test.mjs`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/provider-manager.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/global.d.ts`
- `apps/desktop/src/renderer/main.tsx`
- `apps/desktop/src/renderer/ui.tsx`
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/renderer/sloth-assets.ts`
- `apps/desktop/src/renderer/sloth-companion.tsx`
- `apps/desktop/src/shared/companion-motion.ts`
- companion/transparency/sloth regression tests
- `packages/ai-core/src/index.ts`
- `packages/persistence/package.json`
- `packages/persistence/scripts/smoke-native.mjs`
- `packages/provider-gemini/package.json`
- `packages/provider-gemini/src/index.ts`
- `packages/provider-gemini/src/errors.ts`
- `packages/provider-gemini/src/schema.ts`
- `packages/provider-gemini/src/diagnostics.ts`
- Gemini diagnostics/schema/error tests and developer diagnostic CLI

The supplied PNG art itself was not flattened, converted or reprocessed.

## Sloth changes

- renderer document/root is transparent for the companion;
- Settings owns its own opaque warm background;
- BrowserWindow remains transparent/frameless/shadowless;
- outer companion size is fixed at approximately 154×128 and movement changes only X/Y;
- sprite viewport is square and keeps 512×512 cell registration;
- animation playback is slowed to 2–6 FPS depending on state;
- rotation is capped around ±3°;
- no scaling/growing window during drag;
- release speed is capped and mapped to at most ~12 px of one-shot lazy settling;
- no bounce/ricochet/long inertial loop;
- reduced motion eliminates release inertia;
- click-vs-drag, multi-monitor clamping, settled-position persistence and capture avoidance remain intact;
- all 15 sprite sheets were verified as RGBA with real alpha and correct manifest dimensions.

## Gemini changes

- keeps current Interactions API architecture instead of blindly migrating interfaces;
- stable `v1`, `@google/genai` 2.17.0 and current structured/image request shapes retained;
- seven-stage diagnostic identifies auth/text/structured/system/multimodal/context/plan failure separately;
- safe diagnostic ID, stage, model, API/SDK version, HTTP/provider code and sanitized reason surfaced in Settings;
- safe Open log folder IPC added;
- developer `pnpm diagnose:gemini` utility added;
- model discovery establishes availability but no longer guesses Gemini vision/structured/tool capabilities from names;
- provider schema/input preflight retained and aligned with current documented schema subset needed by PATCH;
- strict application Zod validation still occurs after model output;
- permanent request/auth/model errors never use automatic provider fallback.

**Live provider acceptance was not executed.** Run the staged diagnostic on the user's Windows machine to identify the exact remaining provider stage if a 400 persists.

## Installer changes

- nested pnpm invocation resolves `npm_execpath` and executes the pnpm JS entry via `process.execPath`;
- Electron Builder's real JS bin entry is resolved from installed package metadata rather than executing `.cmd`;
- argument arrays preserve paths containing spaces without shell quoting bugs;
- `package:win` independently publishes the self-contained .NET bridge and builds the full monorepo;
- NSIS artifact presence is verified;
- unpacked packaged `PATCH.exe --patch-smoke-native` performs a real SQLite write/read before packaging is accepted;
- installer stages report tool, stage, exit code and actionable next step.

## Validation

Executed in this delivery environment:

- `node scripts/lint.mjs` — PASS
- TS/TSX source parser — PASS, 58 files / 0 parse errors
- focused strict TypeScript on pure companion modules — PASS
- all source JS-family `node --check` — PASS
- JSON/YAML parse — PASS
- workspace topology and lockfile importer audit — PASS, 14 projects including root
- companion runtime assertions — PASS
- Windows package-command resolver assertions — PASS
- sloth asset RGBA/alpha/geometry audit — PASS, 15/15
- source credential scan — no real credentials; only deliberate fake redaction-test data

Not executed in this Linux delivery environment:

- final dependency-aware whole-workspace `pnpm typecheck/test/build` after all edits;
- Windows .NET Desktop Release execution;
- Electron transparent-window visual compositor test;
- NSIS build/install/launch;
- Chrome native-host or Photoshop UXP runtime;
- live Gemini request with the user's key.

## Remaining limitations

- Windows-specific packaging/runtime behavior must pass the release gate on Windows.
- Live Gemini root cause remains stage-dependent until the staged diagnostic is run with the user's configured account/model.
- Chrome unpacked extension installation and Photoshop UXP signing remain external platform deployment steps.

## Fresh-install instructions

From a clean Windows extraction:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
dotnet build .\apps\windows-bridge\Patch.WindowsBridge.csproj -c Release
pnpm --filter @patch/desktop dev
```

Or use the production bootstrap:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\INSTALL_PATCH.ps1 -BuildOnly
```

For an explicit Gemini developer diagnostic without storing the environment key:

```powershell
$env:GEMINI_API_KEY="<temporary key>"
pnpm diagnose:gemini
Remove-Item Env:GEMINI_API_KEY
```

After runtime validation, build the standalone installer directly with:

```powershell
pnpm package:win
```
