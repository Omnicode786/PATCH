# PATCH

**An AI agent that works inside the applications on your desktop.**

PATCH doesn't just answer questions — it sees your screen, understands application context, and takes controlled actions through the apps you already use. Built for Windows, powered by OpenAI and Gemini, and designed so the AI can never do more than you explicitly allow.

<p align="center">
  <a href="https://www.mediafire.com/file/p1xbs7g9nrsqkwu/PATCH-0.1.1-x64.exe/file"><strong>⬇ Download PATCH 0.1.1 for Windows x64</strong></a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://pixel-forge-ai-hackathon-08.devpost.com/">Devpost</a>
  &nbsp;&nbsp;·&nbsp;&nbsp;
  <a href="https://github.com/Omnicode786/PATCH">GitHub</a>
</p>

---

## The Problem

You use multiple applications every day — browsers, creative tools, system utilities — and you constantly repeat the same friction:

- **Switching context** between apps to move information around  
- **Performing repetitive actions** like hiding distracting UI elements on websites you visit daily  
- **Translating intent into steps** — you know *what* you want, but you have to manually figure out *how* each application exposes it  

Conventional AI chatbots can help you think, but they can't *do* anything. They generate text in a window. They can't see your screen. They don't know what application you're in. They can't click a button, rearrange a webpage, or adjust a Photoshop layer.

**PATCH bridges that gap.** It gives AI the ability to perceive your applications and act through them — but only through explicitly defined, validated, permission-gated capabilities. The AI proposes; PATCH verifies and executes.

---

## How It Works

When you press **Ctrl + Shift + Space**, PATCH activates:

```
 You describe what you want
  │
  ▼
 PATCH captures context
  ├─ Active window metadata
  ├─ Windows UI Automation accessibility tree
  ├─ Chrome/Edge semantic DOM (via companion extension)
  └─ Photoshop document & layer tree (via UXP plugin)
  │
  ▼
 Intent classification
  │  Is this a question, a web modification, or an application action?
  │
  ▼
 AI model plans structured actions
  │  Using only the tools that are currently available and eligible
  │
  ▼
 PATCH validates the plan
  ├─ Every target ID must exist in the captured context
  ├─ Every tool must be registered and eligible
  ├─ Confidence must exceed the safety threshold
  └─ Risk level must match your permission settings
  │
  ▼
 Permission gate
  │  Mutations require your confirmation by default
  │
  ▼
 Deterministic execution through native adapters
  │
  ▼
 Post-action verification
     PATCH checks the result before reporting success
```

### What the AI decides vs. what PATCH decides

| AI Model | PATCH Runtime |
|----------|--------------|
| Interprets your goal | Verifies every target ID exists |
| Classifies the request type | Filters tools by what's actually available |
| Proposes a sequence of tool actions | Validates arguments against schemas |
| Estimates confidence | Blocks plans below the confidence threshold |
| Suggests expected outcomes | Gates execution behind permissions |
| | Executes through native bridges |
| | Verifies post-state before reporting success |

The model never receives a shell tool, a code execution tool, or raw JavaScript injection. Screen and DOM content are explicitly marked as **untrusted data, never instructions**.

---

## What PATCH Can Actually Do

### 16 registered tools across 4 application domains:

**Windows UI Automation** — interact with native desktop controls  
`windows.invoke` · `windows.toggle` · `windows.setValue` · `windows.select` · `windows.scroll`

**Browser (Chrome/Edge)** — modify live web pages with a safe declarative DSL  
`browser.applyPatch` · `browser.restorePatch` · `browser.savePatch` · `browser.highlight`

**Photoshop** — manipulate layers through the UXP plugin  
`photoshop.selectLayer` · `photoshop.duplicateLayer` · `photoshop.moveLayer` · `photoshop.resizeLayer` · `photoshop.setOpacity` · `photoshop.setBlendMode`

**Screen** — coordinate-based visual fallback (disabled by default, requires annotation)  
`screen.click`

### Example: Cleaning up a distracting website

> **You:** *"Hide the sidebar and recommendations on this page"*

1. PATCH detects Chrome is in the foreground and retrieves semantic DOM elements via the companion extension
2. The AI classifies this as a `WEB_PATCH` and plans a `browser.applyPatch` using the declarative DSL with `HIDE` operations targeting the sidebar and recommendation containers
3. PATCH validates that the referenced DOM elements exist in the captured context
4. After your confirmation, the Chrome extension applies the changes to the live page
5. PATCH verifies the patch was applied and offers to save it as a persistent site rule

### Example: Toggling a Windows setting

> **You:** *"Turn on dark mode in this settings panel"*

1. PATCH reads the Windows UI Automation accessibility tree of the active window
2. The AI identifies the dark mode toggle control by its UIA properties and plans a `windows.toggle` action
3. PATCH validates the target ID, confirms the element supports `TogglePattern`, and checks your permissions
4. After confirmation, the C# bridge toggles the control and verifies the resulting state

---

## What Makes PATCH Different

|  | Traditional AI Chat | PATCH |
|--|---------------------|-------|
| **Interaction model** | Conversation in a window | Works inside your existing applications |
| **Application awareness** | None | Reads accessibility trees, DOM, and layer hierarchies |
| **Output** | Generates text | Executes validated actions through native adapters |
| **Safety model** | Trust the user prompt | Every action is schema-validated and permission-gated |
| **Integrations** | Generic API calls | Purpose-built adapters for Windows, Chrome, and Photoshop |
| **Provider lock-in** | Usually one provider | Swappable between OpenAI and Gemini with automatic fallback |

---

## Architecture

```
PATCH Desktop (Electron)
│
├── AI Core
│   ├── Provider-neutral interfaces & system policy
│   ├── OpenAI provider (Responses API)
│   └── Gemini provider (GenerateContent API)
│
├── Orchestrator
│   ├── Context assembly (screen + UIA + DOM + Photoshop)
│   ├── Intent classification
│   ├── Plan validation (schemas, targets, confidence, risk)
│   └── Permission engine & confirmation gate
│
├── Tool Registry
│   └── 16 tools with typed schemas, risk levels, and target prefixes
│
├── Security Layer
│   ├── Permission system with 7 capability scopes
│   ├── Risk hierarchy (READ_ONLY → REVERSIBLE → SIDE_EFFECT → DESTRUCTIVE)
│   ├── Credential vault (Windows DPAPI encryption)
│   └── Secret redaction in logs
│
└── Application Adapters
    ├── Windows Bridge (C#/.NET 8 — UI Automation + Chrome Native Messaging)
    ├── Chrome Extension (MV3 — semantic DOM extraction + declarative patch DSL)
    └── Photoshop Plugin (Adobe UXP — layer context + constrained mutations)
```

### Key Engineering Decisions

**Provider abstraction** — OpenAI and Gemini are interchangeable behind a unified `AIProvider` interface. The system supports automatic fallback routing, per-role model assignment (default, vision, reasoning), and runtime diagnostics that auto-heal stale model configurations.

**Restricted tool registry** — The AI cannot invent tools or capabilities. Every tool is explicitly registered with typed argument schemas, target ID prefixes, and risk classifications. Tools are dynamically filtered: `browser.*` tools only appear when Chrome context exists, `windows.*` tools only when a UIA tree is available.

**Declarative website patch DSL** — Instead of injecting arbitrary JavaScript, browser modifications use a restricted DSL supporting 14 safe operations (`HIDE`, `SHOW`, `MOVE`, `RESIZE`, `RESTYLE`, etc.) with CSS injection safety filters that reject `url()`, `@import`, `expression()`, and `javascript:` patterns.

**Named pipe transport** — The Chrome extension communicates through a per-user Windows named pipe (`patch-browser-bridge-v1`). No TCP port is ever opened for the browser adapter.

**Companion window design** — The floating sloth companion window is configured as `focusable: false` to preserve the foreground window's HWND, ensuring UI Automation context captures target the user's actual application rather than PATCH itself.

---

## Security & Control

PATCH is designed around the principle that **the AI should never be able to do more than the user has explicitly allowed**.

- **7 permission scopes** control what PATCH can perceive and modify — screen capture, accessibility reading/control, browser modification, Photoshop control, coordinate automation, and confirmation bypass
- **Coordinate-based clicking is disabled by default** — and even when enabled, the AI never supplies coordinates; it can only click the center of a user-drawn annotation
- **Credentials are encrypted at rest** using Windows DPAPI via Electron `safeStorage`. If OS encryption is unavailable, the vault fails closed rather than storing plaintext
- **Confirmation is required for all mutations by default** — with a 120-second expiring confirmation token
- **Post-action verification** — if an action reports `changed` but cannot verify the result, execution halts immediately
- **30 strongly-typed error codes** ensure failures are specific and actionable, not generic
- **Structured JSONL logs** automatically redact API keys, tokens, and secrets before writing

---

## Download & Install

### For users — try PATCH immediately

**[⬇ Download PATCH 0.1.1 — Windows x64 Installer](https://www.mediafire.com/file/p1xbs7g9nrsqkwu/PATCH-0.1.1-x64.exe/file)**

The installer sets up everything you need. After launching:

1. PATCH appears as a **floating sloth companion** and a **system tray icon**
2. Open **Settings → AI & Adapters** and add your OpenAI or Gemini API key
3. Press **Ctrl + Shift + Space** to invoke PATCH in any application
4. Draw annotations on your screen if needed, type your request, and confirm

No API key is required for PATCH to launch. AI features activate once you configure a provider.

> **Alternative:** You can also rebuild the installer from source — the release binaries are available in [`release_binaries/`](./release_binaries/) with a [`stitch-release.ps1`](./release_binaries/stitch-release.ps1) script to reconstruct the full installer.

### For developers — build from source

**Prerequisites:** Windows 10/11 · Node.js ≥ 22.16.0 · pnpm 11.21.0 · .NET 8 SDK

```powershell
# Install dependencies
pnpm install --frozen-lockfile

# Build the Windows UI Automation bridge
dotnet build .\apps\windows-bridge\Patch.WindowsBridge.csproj

# Run the full verification suite (lint + typecheck + test + build)
pnpm verify

# Start in development mode
pnpm --filter @patch/desktop dev
```

### Adapter setup

**Chrome extension:** Build all workspaces (`pnpm build`), load `adapters/chrome/dist` as an unpacked extension, and register the native messaging host via the included PowerShell script.

**Photoshop plugin:** Load `adapters/photoshop` through Adobe UXP Developer Tool and pair using the code from PATCH Settings → Adapters.

See [`ADAPTER_SETUP.md`](./ADAPTER_SETUP.md) for detailed instructions.

---

## Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Desktop Shell** | Electron · React · Vite · TypeScript |
| **AI Providers** | OpenAI (Responses API) · Google Gemini (GenerateContent) |
| **Validation** | Zod (schema contracts + JSON schema generation) |
| **Windows Integration** | C# · .NET 8 · UI Automation · Chrome Native Messaging |
| **Browser Adapter** | Chrome Manifest V3 · Content Scripts · Service Worker |
| **Creative Adapter** | Adobe UXP (Photoshop plugin) |
| **Persistence** | SQLite · Drizzle ORM · better-sqlite3 |
| **Build System** | Turborepo · pnpm workspaces |
| **CI** | GitHub Actions (Windows runner) |

---

## Project Structure

```
apps/
  desktop/              Electron main + preload + React renderer
  windows-bridge/       C#/.NET 8 UI Automation sidecar
adapters/
  chrome/               Manifest V3 companion extension
  photoshop/            Adobe UXP companion plugin
packages/
  ai-core/              Provider-neutral AI interfaces & system policy
  provider-openai/      OpenAI SDK integration
  provider-gemini/      Gemini SDK integration
  tool-registry/        Registered tool definitions & execution
  patch-dsl/            Restricted website transformation DSL
  protocol/             Versioned adapter communication envelopes
  schemas/              Shared Zod validation contracts
  security/             Permissions, risk policy, secret redaction
  logging/              Structured JSONL logging with auto-redaction
  persistence/          SQLite/Drizzle local database
  shared/               Typed errors, branded IDs, utilities
```

---

## Hackathon

PATCH was built for the [**Pixel Forge AI Hackathon**](https://pixel-forge-ai-hackathon-08.devpost.com/) (August 15–22, 2026).

---

## License

PATCH is available under the terms specified in [`LICENSE`](./LICENSE).
