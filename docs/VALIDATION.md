# PATCH Delivery Validation Record

Validation date: **2026-08-18**  
Source basis: the user's **`PATCH-fixed.zip`** only.

This record separates checks executed against this edited source tree from Windows/provider checks that cannot truthfully be executed in the Linux delivery environment.

## Executed

| Check | Status | Notes |
|---|---|---|
| Repository source/security lint (`node scripts/lint.mjs`) | VERIFIED | `PATCH lint passed.` |
| TypeScript/TSX parser | VERIFIED | 59 non-generated `.ts/.tsx` files; zero parse errors |
| Focused strict TypeScript | VERIFIED | companion motion/assets/state modules compile with strict, exact-optional and unchecked-index settings |
| JavaScript-family syntax | VERIFIED | non-generated `.js/.mjs/.cjs` passed `node --check` |
| JSON/YAML | VERIFIED | package/config/lock/workspace/manifest files parse |
| Workspace topology | VERIFIED | root + 13 packages = 14 projects; all workspace package importers are present in `pnpm-lock.yaml` |
| Sloth sprite audit | VERIFIED | all 15 sheets are RGBA with real 0–255 alpha and dimensions matching 512×512 cells declared by the manifest |
| Companion pure logic | UNIT VERIFIED | fixed-size bounds, drag bands, clamp, click threshold, release cap, ≤12 px settle, reduced-motion zero inertia |
| Windows package CLI resolver | UNIT VERIFIED | active pnpm JS entry, Windows-shim layout, paths with spaces, missing-command error, real package bin resolution |
| Secret literal scan | STATIC VERIFIED | no real credential stored; Gemini error-redaction test intentionally contains a fake key-shaped fixture |
| Gemini API implementation review | STATIC VERIFIED | GenerateContent/inlineData/structured-output choices reviewed against current official Google SDK/API docs |
| Gemini provider schemas/preflight | STATIC + TEST-SOURCE VERIFIED | strict provider-facing preflight and regression tests present; final live acceptance still requires a real key |

## Not executed in this environment

| Check | Status | Reason |
|---|---|---|
| `pnpm install --frozen-lockfile` from a freshly cleaned tree | BLOCKED BY ENVIRONMENT | Corepack/npm registry resolution is unavailable from the delivery Linux sandbox |
| dependency-aware whole-workspace `pnpm typecheck` | NOT EXECUTED on final edit | dependencies are intentionally removed from the delivery; run on Windows after frozen install |
| `pnpm test` / `pnpm build` on final edit | NOT EXECUTED on final edit | same dependency/network constraint |
| .NET Release Windows Desktop build | BLOCKED BY ENVIRONMENT | target runtime/toolchain is Windows-specific |
| transparent Electron compositor visual check | BLOCKED BY ENVIRONMENT | requires Windows transparent BrowserWindow compositor |
| `pnpm package:win` / NSIS | BLOCKED BY ENVIRONMENT | script deliberately rejects non-Windows hosts |
| packaged Electron `better-sqlite3` smoke | BLOCKED BY ENVIRONMENT | automatically run by Windows packaging after Electron Builder |
| Chrome native-host round trip | NOT EXECUTED | requires Chrome + Windows native host registration |
| Photoshop UXP pairing/runtime | NOT EXECUTED | requires Photoshop/UXP runtime |
| live Gemini staged diagnostic and real `patch:submit` | NOT EXECUTED | requires the user's private API key/account/network |

## Required Windows release gate

From a fresh extraction:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
dotnet build .\apps\windows-bridge\Patch.WindowsBridge.csproj -c Release
pnpm --filter @patch/desktop dev
```

In the running app:

1. verify there is no opaque companion rectangle or startup flash;
2. verify dragging never changes the compact outer size and release settles only slightly;
3. verify slow idle/deep-sleep/hover/click/thinking/success/error state pacing;
4. run **Settings → AI & Adapters → Gemini → Run staged diagnostics**;
5. if stages 1–7 pass, submit a real PATCH request and confirm `GeminiProvider.planActions()` returns a plan accepted by strict `PatchPlanSchema`;
6. test an invalid key and confirm it reports authentication rather than generic invalid request;
7. verify Windows UIA/Chrome/Photoshop statuses reflect real connectivity.

Then package:

```powershell
pnpm package:win
# or
.\INSTALL_PATCH.ps1 -BuildOnly
```

Packaging is accepted only if the self-contained bridge publishes, the monorepo builds, Electron Builder creates `release/PATCH-<version>-x64.exe`, and `win-unpacked/PATCH.exe --patch-smoke-native` successfully performs its SQLite write/read.

## Release truth rule

- Do not call **Gemini live VERIFIED** until an authenticated real `patch:submit` succeeds through `GeminiProvider.planActions()` and `PatchOrchestrator.submit()`.
- Do not call **Windows installer VERIFIED** until `pnpm package:win`/NSIS and the packaged native smoke pass on Windows.
