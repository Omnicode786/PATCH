# Adapter & API Research Notes

Research date: **2026-08-16**. These notes explain why PATCH uses the adapter surfaces present in this repository and which tempting alternatives were deliberately rejected.

## Adapter taxonomy used by PATCH

PATCH has three execution classes rather than pretending every application exposes the same automation API:

| Class | Examples | Strength | Failure mode | PATCH policy |
|---|---|---|---|---|
| Application-native adapter | Photoshop UXP, Chrome DOM companion | Highest semantic fidelity and application-specific verification | Plugin not installed / unsupported app version | Preferred |
| OS semantic adapter | Windows UI Automation | Broad coverage, real control roles/patterns | App exposes poor accessibility metadata | Second choice |
| Visual fallback | Screenshot + explicit coordinates | Works for otherwise opaque apps | Fragile, low semantic certainty | Last resort, confirmed + unverified |

This is also why PATCH does **not** implement one giant “computer control adapter.” Different surfaces provide different evidence and verification guarantees.

## Windows

### Selected: Microsoft UI Automation
UI Automation exposes semantic elements plus capability-specific control patterns such as Invoke, Toggle, Value, SelectionItem and Scroll. PATCH checks the pattern before registering/executing the corresponding operation.

Official references:
- https://learn.microsoft.com/dotnet/framework/ui-automation/ui-automation-overview
- https://learn.microsoft.com/dotnet/framework/ui-automation/ui-automation-control-patterns-overview
- https://learn.microsoft.com/dotnet/api/system.windows.automation

### Why not coordinate automation as the primary adapter?
Coordinates break with DPI, window movement, themes, localization and layout changes; they provide weak verification. PATCH keeps `SendInput` only as a low-confidence fallback attached to an explicit user annotation.

### Why not expose PowerShell / shell automation to the planner?
A shell is far broader than the user's visible intent and defeats tool-level permission/risk validation. PATCH does not register one.

## Browser

### Selected: Chrome Manifest V3 content adapter + Native Messaging
A content script can inspect and modify the actual DOM. Native Messaging is Chromium's supported bridge from an extension to a local native application.

Official references:
- https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3

### Why not remote-debugging/CDP as the normal product path?
CDP is powerful but requires a debugging connection/launch configuration, gives substantially broader authority, and is a poor default permission story for a consumer desktop overlay. A companion extension provides explicit browser installation/permissions and page-local semantics.

### Why a DSL rather than generated JS?
Generated JavaScript would combine model reasoning and execution authority. The PATCH DSL has a finite operation set and safe style allowlist, so model output is data consumed by a validator/interpreter.

### Dynamic sites
A MutationObserver reconciles stored transformations locally. It does not resend a page to the AI merely because React/Vue rerendered.

## Photoshop

### Selected: Adobe UXP
UXP is Photoshop's supported modern plugin platform. PATCH uses the Photoshop DOM for layer operations and wraps mutations in modal execution. A constrained `batchPlay` descriptor is used only for selection when needed; it is not exposed to the AI.

Official reference hub:
- https://developer.adobe.com/photoshop/uxp/

Relevant API areas:
- Photoshop `Layer` DOM (`duplicate`, `translate`, `scale`, `opacity`, `blendMode`)
- `core.executeAsModal`
- UXP secure storage

### Why not UIA for Photoshop first?
UIA can manipulate Photoshop chrome but cannot reliably express document-layer semantics. UXP can act on actual layer IDs and verify document state.

### Why not expose arbitrary `batchPlay`?
`batchPlay` can reach a very large portion of Photoshop's action system. Exposing raw descriptors to a planner recreates arbitrary-code-like authority. PATCH exposes named operations with fixed arguments instead.

## AI providers

### OpenAI
Selected current API surface: **Responses API** via the official JavaScript SDK. PATCH uses multimodal input and JSON-schema structured output, with provider-side storage disabled by default.

References:
- https://platform.openai.com/docs/api-reference/responses
- https://platform.openai.com/docs/guides/structured-outputs

### Google Gemini
Selected current API surface: **GenerateContent API** via `@google/genai`. PATCH uses multimodal `Part.inlineData` input, system instructions, and JSON-schema structured output followed by strict local Zod validation. This supersedes the earlier Interactions choice after live Windows diagnostics showed repeated Interactions request-shape incompatibilities.

References:
- https://ai.google.dev/api/generate-content
- https://googleapis.github.io/js-genai/

## Desktop / capture / credentials

### Electron capture
Selected: `desktopCapturer.getSources()` in the trusted main process, requested only when PATCH is invoked.
- https://www.electronjs.org/docs/latest/api/desktop-capturer

### Electron credential protection
Selected: `safeStorage` and a main-process-only vault. PATCH refuses plaintext fallback.
- https://www.electronjs.org/docs/latest/api/safe-storage

## Adapters not implemented in V1

The master specification explicitly lists macOS, Linux, Safari, Firefox, Office, VS Code and Figma automation as V1 non-goals. Their absence is intentional rather than an unfinished fake adapter. The adapter boundaries are designed so those can be added later without giving the model new generic execution powers.

Possible future surfaces that should be researched at implementation time:

- macOS Accessibility + ScreenCaptureKit;
- Linux AT-SPI + portal-based capture;
- Firefox WebExtensions/native messaging;
- application-native APIs for Figma/Office/VS Code when product scope calls for them.

Do not pre-implement those from memory. Recheck current official APIs when they enter scope.
