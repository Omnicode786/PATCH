# Adapter Architecture

## Routing rule

PATCH routes actions in this order:

1. **Specialized application adapter** — semantic and application-native.
2. **Windows UI Automation** — semantic OS accessibility/control pattern.
3. **Visual coordinate fallback** — only when no deterministic integration exists.

The planner is told only about tools available for the current context.

## Windows UI Automation adapter

**Process:** `Patch.WindowsBridge.exe` (.NET 8 Windows Desktop).  
**Transport:** JSON Lines over child-process stdin/stdout.  
**Discovery:** active HWND + Control View tree.  
**Target format:** `uia-<runtime-id-hash>`.  
**Actions:** Invoke, Toggle, Value, SelectionItem, Scroll.  
**Fallback:** guarded `SendInput` coordinate click only for an explicit annotation target.

The sidecar checks supported control patterns rather than assuming a Button/Switch/Edit control supports a given operation. Password values are omitted.

## Chrome adapter

**Runtime:** Manifest V3 extension.  
**Transport:** Chrome native messaging → `Patch.WindowsBridge.exe` native-host mode → per-user named pipe → Electron main.  
**Target format:** ephemeral `dom-*`.  
**Read surface:** URL, title, visible/semantic elements, sanitized attributes, bounds, interactive status.  
**Write surface:** restricted PATCH DSL only.

### Native host installation

Chromium requires a native messaging host manifest registered in the browser-specific Windows registry location. The shipped `install-native-host.ps1` creates the host manifest and registers it under the current user. The extension ID is required so `allowed_origins` can be exact.

### Persistent site transforms

A live `dom-*` target cannot be stored. Before save, the content adapter compiles references to stable locators:

1. DOM `id`;
2. approved attributes (`data-testid`, `data-test`, `name`, `aria-label`);
3. semantic role + normalized text + occurrence;
4. bounded DOM child-index path as last resort.

A saved rule that no longer resolves is skipped. PATCH does not ask the model to invent a replacement during page rerender.

## Photoshop adapter

**Runtime:** Adobe UXP plugin.  
**Transport:** authenticated loopback long-poll protocol on `127.0.0.1:49373`.  
**Target format:** `ps-layer-<native-layer-id>`.  
**Read surface:** active document and recursive layer metadata.  
**Write surface:** select, duplicate, translate, scale, opacity, blend mode.

Each state-changing command executes inside Photoshop modal execution and returns a post-state verification result. Desktop stops a multi-action plan when a deterministic mutation reports unverified.

## Adding a future adapter

A new adapter should:

1. define normalized observed objects with stable-in-context IDs;
2. expose the smallest useful command set, never a generic script/shell command;
3. register tools with runtime-owned risk classifications;
4. validate all external responses at the boundary;
5. implement post-state verification for mutations;
6. document undo semantics honestly;
7. add target/tool grounding tests;
8. add a decision entry in `DECISIONS.md`;
9. add an integration test to the release runtime matrix.

Do not add an adapter merely by teaching the LLM where to click. Coordinate behavior is the fallback layer, not an application adapter.
