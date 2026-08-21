# PATCH

> **The adaptive AI layer for your computer.**  
> See anything. Ask anything. Change what you use.

PATCH is a Windows-first desktop AI application that can understand the active screen when explicitly invoked, reason over semantic application context, and perform controlled actions through deterministic adapters. It is intentionally not a chatbot embedded in Electron: the primary UX is a persistent tray/animated sloth companion plus a global command overlay with screenshot annotation.

## What is implemented

- Secure Electron desktop shell, tray, configurable global shortcut, always-available animated sloth companion, transparent capture/annotation overlay and compact result/confirmation UX.
- Rectangle, freehand, and arrow annotations tied to image-relative coordinates.
- In-memory screen capture lifecycle with deletion-after-request enabled by default.
- BYOK OpenAI and Gemini providers; raw keys stay in Electron main and are encrypted with OS-backed Electron `safeStorage`.
- Provider/model settings, official setup links, real selected-model connection testing, capability-gated model assignment, explicit custom-model mode, and advanced vision/reasoning routing.
- Structured `PatchPlan` generation, runtime Zod validation, target existence checks, tool/risk validation, permissions, confirmation and execution verification.
- Native Windows .NET UI Automation sidecar for active-window context, semantic trees and controlled Invoke/Toggle/Value/Selection/Scroll actions.
- Chrome Manifest V3 companion extension using native messaging, semantic DOM extraction, restricted live-DOM PATCH DSL, undo and persistent site rules.
- Photoshop UXP companion plugin for document/layer context and a constrained mutation set.
- SQLite/Drizzle local metadata, structured redacted logging, saved-patch management.
- Unit policy/DSL/protocol/grounding tests, Gemini provider-schema preflight tests, sloth motion tests, and repository security lint.

## Architecture

```text
User
  │
  ▼
PATCH Overlay ── prompt + capture + annotations
  │
  ▼
Context Engine
  ├─ Screen capture
  ├─ Windows UIA tree
  ├─ Chrome semantic DOM
  └─ Photoshop document/layers
  │
  ▼
AI Provider (OpenAI Responses / Gemini GenerateContent)
  │
  ▼
Structured PatchPlan
  │
  ├─ Zod schema validation
  ├─ real-target validation
  ├─ tool + argument validation
  ├─ risk + permission policy
  └─ confirmation gate
  │
  ▼
Tool Registry
  ├─ Photoshop UXP
  ├─ Chrome MV3 / PATCH DSL
  ├─ Windows UI Automation
  └─ annotation coordinate fallback
  │
  ▼
Execute → observe post-state → verify → report
```

The planner never receives a shell tool or arbitrary JavaScript tool. Observed screen/DOM text is explicitly marked untrusted and cannot redefine system policy.

## Repository

```text
apps/
  desktop/          Electron + React/Vite
  windows-bridge/   C#/.NET Windows UI Automation + Chrome native host
adapters/
  chrome/           Manifest V3 extension
  photoshop/        Adobe UXP plugin
packages/
  ai-core/          provider-neutral AI contracts and planner policy
  provider-openai/  official OpenAI JS SDK adapter
  provider-gemini/  official Google GenAI SDK adapter
  tool-registry/    executable allowlist + validation
  patch-dsl/        restricted website transformation language
  protocol/         versioned adapter envelopes
  schemas/          shared Zod contracts
  persistence/      SQLite/Drizzle
  security/         permissions, risk policy, redaction
  logging/          structured JSONL logs
  shared/           typed errors and utilities
docs/
DECISIONS.md        engineering decision log
```

## Requirements

Development host:

- Windows 10/11 for real UIA/runtime testing and final installer packaging.
- Node.js 22.16+.
- pnpm 11.21.0 (Corepack is fine).
- .NET 8 SDK with Windows Desktop targeting support.
- Chrome/Chromium for the browser companion.
- Adobe Photoshop with UXP support for the Photoshop companion.

## Fresh Windows setup

The easiest audited path from this source archive is:

```text
SETUP_PATCH.cmd
```

It invokes `INSTALL_PATCH.ps1`, checks prerequisites, installs dependencies, runs the verification gate, builds the Windows sidecar, creates the NSIS installer and launches it. See `FRESH_INSTALL.md`.

No API key is required for PATCH to launch, stay in the tray, show its animated sloth companion, or open Settings. AI requests are enabled only after the user adds an OpenAI or Gemini key.

This archive includes the real `pnpm-lock.yaml` generated from the successfully resolved Windows dependency graph. Keep release/CI installs frozen (`pnpm install --frozen-lockfile`) and update the lockfile only through an intentional dependency change.

## Development

Build the Windows sidecar once:

```powershell
dotnet build .\apps\windows-bridge\Patch.WindowsBridge.csproj
```

Then:

```powershell
pnpm verify
pnpm --filter @patch/desktop dev
```

Default invoke shortcut: **Ctrl + Shift + Space**.

## Configure an AI provider

Open **Settings → AI & Adapters**. Add an OpenAI or Gemini API key and test it. The renderer never gets the stored key back. PATCH makes direct local-to-provider API calls.

Current provider integration choices are documented in `DECISIONS.md` and should be rechecked against official provider docs when dependencies are upgraded.

## Chrome adapter

1. Build all workspaces: `pnpm build`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `adapters/chrome/dist`.
3. Copy the extension ID.
4. Register the native host (PowerShell):

```powershell
.\adapters\chrome\dist\install-native-host.ps1 `
  -ExtensionId <32-character-extension-id> `
  -BridgeExe <absolute-path-to-Patch.WindowsBridge.exe>
```

The desktop listens on a per-user Windows named pipe. Chrome native messaging frames are forwarded by the Windows bridge executable; no local TCP port is exposed for the browser adapter.

## Photoshop adapter

1. Open PATCH **Settings → Adapters** and reveal/copy the Photoshop pairing code.
2. Load `adapters/photoshop` in Adobe UXP Developer Tool during development, or package/sign it for normal distribution.
3. Open the **PATCH** panel in Photoshop.
4. Enter the pairing code once. The plugin stores it using UXP secure storage and communicates only with `http://127.0.0.1:49373`.

The initial supported mutation set is deliberately small: select, duplicate, translate, scale, opacity and blend mode. It does not expose the entire Photoshop API.

## Security model

Key properties:

- Renderer isolation and narrow preload IPC.
- No raw provider-key getter.
- Fail-closed credential persistence if OS encryption is unavailable.
- Screen capture only on invocation by default.
- Screen/DOM content is data, not instructions.
- Model-generated plans cannot invent target IDs, tools, or risk classifications.
- No generic shell or JavaScript execution tool.
- Deterministic adapter priority over coordinate fallback.
- Confirmation for mutations by default.
- Post-action verification before reporting success.
- Redacted metadata logs; no screenshot/provider-secret logging.

Read `docs/THREAT_MODEL.md` for abuse cases and controls, and `AUDIT_REPORT.md` for the 2026-08-16 production audit and corrected-delivery notes.

## Privacy defaults

- Continuous recording: **not implemented / off**.
- Delete captured screenshot after request: **on**.
- Screenshot history: **off**.
- Prompt logging: **off**.
- Image analytics: **never**.
- API-key logging: **never**.

## Local storage

`patch.sqlite3` stores preferences, provider metadata (not raw keys), permissions and saved website patches. Encrypted secret material lives separately in the credential vault file managed by Electron main.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then run Windows adapter/integration checks on Windows. See `docs/VALIDATION.md` for the exact validation status of this delivered archive.

## Windows package

```powershell
pnpm package:win
```

This publishes a self-contained x64 Windows sidecar, builds all monorepo workspaces/adapters, and runs Electron Builder to create an NSIS installer under `release/`.

## Known limitations

- V1 is intentionally Windows-first; macOS/Linux adapters are interfaces/roadmap, not fake implementations.
- Generic `InvokePattern` cannot prove an arbitrary application-specific outcome; PATCH reports it as unverified unless a concrete postcondition exists.
- Coordinate automation is a low-confidence fallback, requires a real user annotation, is permission-gated off by default, never accepts model-supplied coordinates, and never masquerades as deterministic control.
- Chrome extension load/signing and Photoshop UXP packaging/signing are deployment steps outside the source archive.
- Real provider calls require the user’s own key and incur that provider’s usage costs.

## Roadmap

After V1 stability: richer Photoshop operations, explicit Windows app adapters, Firefox/Safari only if product demand warrants them, macOS Accessibility adapter, local-model provider, optional enterprise policy, and signed auto-update distribution.

## Research references

- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
- OpenAI Structured Outputs: https://platform.openai.com/docs/guides/structured-outputs
- Gemini GenerateContent: https://ai.google.dev/api/generate-content
- Electron `desktopCapturer`: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
- Chrome Native Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Chrome Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- Microsoft UI Automation: https://learn.microsoft.com/dotnet/framework/ui-automation/ui-automation-overview
- Adobe Photoshop UXP: https://developer.adobe.com/photoshop/uxp/
