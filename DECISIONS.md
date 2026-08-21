# PATCH Engineering Decisions

This file is the durable decision log for PATCH. It records design choices that affect correctness, security, compatibility, or maintainability. Research baseline: **2026-08-16**. When an external API changes, update the relevant decision before changing code.

## D-001 — Windows-first, adapter-oriented core
**Status:** Accepted  
**Decision:** V1 is Windows-first. OS behavior is isolated behind a native sidecar/client boundary rather than being spread through renderer code.  
**Why:** Windows UI Automation is the deterministic system integration required by the product; macOS/Linux are explicit V1 non-goals.  
**Consequence:** A future OS adapter can implement the same normalized context/action semantics without replacing the planner.

## D-002 — Electron main process is the trust boundary
**Status:** Accepted  
**Decision:** Renderer runs with `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; it receives a narrow preload API only.  
**Why:** Provider secrets, native control, filesystem paths, adapters, and policy decisions must not be available to page JavaScript.  
**Reference:** Electron security guidance and context isolation documentation.

## D-003 — Capture only on invocation
**Status:** Accepted  
**Decision:** PATCH does not continuously capture. The active screen is captured before the transparent overlay is shown; the in-memory capture is deleted after the request by default.  
**Why:** Privacy, lower attack surface, no accidental capture loop where PATCH captures its own overlay.  
**Consequence:** Re-opening PATCH creates fresh evidence rather than reusing stale pixels.

## D-004 — OS-backed encrypted credential vault
**Status:** Accepted  
**Decision:** API keys stay in Electron main and are persisted only as `safeStorage.encryptString()` ciphertext. Renderer can save/delete/test a provider but cannot retrieve its raw key.  
**Why:** Satisfies BYOK without plaintext settings or renderer exposure.  
**Fail-closed behavior:** If `safeStorage.isEncryptionAvailable()` is false, PATCH refuses to persist a key.

## D-005 — No PATCH cloud relay for BYOK
**Status:** Accepted  
**Decision:** Provider requests originate locally from the desktop main process and go directly to the selected provider.  
**Why:** Minimizes custody of user secrets/data and matches local BYOK positioning.

## D-006 — OpenAI uses Responses API
**Status:** Accepted  
**Decision:** Use the current official OpenAI JS SDK and `client.responses.create()`, with multimodal `input_image`, JSON-schema structured outputs, and `store: false`.  
**Why:** Official OpenAI documentation recommends Responses for new work; it supports the required multimodal and structured-output surfaces.  
**References:** https://platform.openai.com/docs/api-reference/responses and https://platform.openai.com/docs/guides/structured-outputs

## D-007 — Gemini uses Interactions API
**Status:** Accepted  
**Decision:** Use `@google/genai` Interactions for multimodal planning/analysis, response schema, and `store: false`.  
**Why:** Current Google documentation positions Interactions as the surface where new agent/model capabilities launch.  
**Reference:** https://ai.google.dev/gemini-api/docs/interactions

## D-008 — Local app owns conversation state
**Status:** Accepted  
**Decision:** Provider-side storage is disabled by default. PATCH owns session references/context locally.  
**Why:** Predictable privacy semantics and provider portability.

## D-009 — Provider code cannot leak into core policy
**Status:** Accepted  
**Decision:** `AIProvider` abstracts validation, model discovery, analysis, planning, and response. OpenAI/Gemini packages remain separate.  
**Why:** Provider replacement/fallback must not rewrite the planner, tool registry, or adapter code.

## D-010 — Capability-gated model assignment
**Status:** Accepted  
**Decision:** Settings rejects a vision model without `vision` capability and a reasoning model without structured-output capability.  
**Why:** Prevents invalid configurations from failing only at action time.  
**Caveat:** Model-list APIs do not expose a uniform capability matrix. Known documented model families are conservatively classified; unknown models should not be promoted to vision/planning without verification.

## D-011 — Structured plan is mandatory for actions
**Status:** Accepted  
**Decision:** Executable work must parse as `PatchPlan` and pass Zod, target, tool, permission, risk, and argument validation.  
**Why:** Natural-language pseudo-actions are not an execution interface.

## D-012 — Model cannot invent tools or targets
**Status:** Accepted  
**Decision:** Every action target must exist in current discovered context and use a registered prefix (`uia-`, `dom-`, `ps-layer-`, `annotation-`). Every tool name must be in the runtime registry.  
**Why:** Core anti-hallucination property.

## D-013 — Screen and webpage content is untrusted data
**Status:** Accepted  
**Decision:** Observed content is serialized inside an explicitly untrusted block. It cannot define tools, permissions, system policy, or risk levels.  
**Why:** Prompt-injection defense. A webpage saying “ignore PATCH policy” is content, not authority.

## D-014 — Risk cannot be downgraded by the model
**Status:** Accepted  
**Decision:** Each registered tool owns its risk classification. A plan whose claimed risk differs is rejected.  
**Why:** The model cannot label a destructive/side-effect operation as read-only to bypass confirmation.

## D-015 — Default confirmation for mutations
**Status:** Accepted  
**Decision:** With default permissions, any non-read-only action requires user confirmation. `actionsWithoutConfirmation` can relax reversible actions but never silently relax higher-risk policy.  
**Why:** User trust over apparent autonomy.

## D-016 — Adapter priority: native > UIA > coordinates
**Status:** Accepted  
**Decision:** Specialized adapters are preferred, then Windows UI Automation, then visual coordinate fallback.  
**Why:** Deterministic semantic APIs are more reliable than screen coordinates.

## D-017 — Windows UI Automation uses control patterns
**Status:** Accepted  
**Decision:** .NET sidecar enumerates Control View and exposes only capabilities actually present: Invoke, Toggle, Value, SelectionItem, Scroll, etc.  
**Why:** UIA control patterns are the official semantic automation mechanism rather than app-specific coordinate scripts.  
**References:** https://learn.microsoft.com/dotnet/framework/ui-automation/ui-automation-control-patterns-overview and https://learn.microsoft.com/dotnet/api/system.windows.automation

## D-018 — UIA IDs are derived from runtime IDs, then re-resolved
**Status:** Accepted  
**Decision:** `uia-*` identifiers are hashes of UIA runtime IDs. Before acting, the sidecar traverses the current foreground UIA tree and resolves the target again.  
**Why:** Avoids blindly retaining stale `AutomationElement` references across rerenders/window changes.  
**Consequence:** If the element disappeared, action fails with `TARGET_NOT_FOUND`.

## D-019 — Password UIA values are never serialized
**Status:** Accepted  
**Decision:** When UIA marks an element as password, PATCH omits its value and replaces its name with a generic label.  
**Why:** Context minimization and secret handling.

## D-020 — Generic InvokePattern is not falsely “verified”
**Status:** Accepted  
**Decision:** A generic button invoke returns `verified: false` unless a deterministic postcondition can be observed. Toggle/value/selection/scroll are re-read and can be verified.  
**Why:** “The call did not throw” is not proof of requested application state.

## D-021 — Coordinate click is explicit low-confidence fallback
**Status:** Accepted  
**Decision:** Coordinate click is available only against a real user annotation, the runtime derives the point itself, the model cannot supply x/y coordinates, the capability is permission-gated off by default, it is a side effect, and it reports unverified.  
**Why:** Keeps unsupported apps usable without pretending coordinates are deterministic or allowing the model to redirect a visual fallback outside the user-grounded selection.

## D-022 — Chrome uses Manifest V3 + native messaging
**Status:** Accepted  
**Decision:** Companion extension uses MV3. Desktop owns a Windows named-pipe server; Chrome launches the registered native host, which frames Chromium native messages and bridges them to the pipe.  
**Why:** Native messaging is Chrome’s supported extension-to-native-app mechanism.  
**Reference:** https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

## D-023 — Browser adapter never accepts arbitrary JavaScript
**Status:** Accepted  
**Decision:** The only page mutation surface is the declarative PATCH DSL. No `eval`, generated script, arbitrary selector script, or body replacement tool exists.  
**Why:** Limits model authority and webpage compromise blast radius.

## D-024 — DOM identifiers are ephemeral
**Status:** Accepted  
**Decision:** Live page elements receive temporary `dom-*` IDs. Saved transformations compile those IDs to stable locators (ID, approved attributes, semantic role/text occurrence, then DOM path).  
**Why:** Raw temporary IDs do not survive page reloads.

## D-025 — Browser transformations preserve undo information
**Status:** Accepted  
**Decision:** Before changing an element, the content adapter records its inline style, hidden state, parent, and sibling position; created nodes are tracked.  
**Why:** “Restore original page” must be real rather than a reload-only approximation.

## D-026 — Persistent patches exist in extension storage and desktop metadata DB
**Status:** Accepted  
**Decision:** Chrome storage contains rules required for automatic page-time reapplication; desktop SQLite also records saved-patch metadata/DSL.  
**Why:** The extension must work during browser navigation, while desktop Settings must remain the management/source-of-truth UI.

## D-027 — Dynamic pages reapply persistent rules incrementally
**Status:** Accepted  
**Decision:** Content adapter observes DOM mutations and debounces saved-rule reconciliation, without sending the entire page to AI again.  
**Why:** React/Vue rerenders should not erase a saved transformation or trigger repeated model spend.

## D-028 — Photoshop uses UXP, not coordinate scripting
**Status:** Accepted  
**Decision:** Photoshop operations go through a small UXP plugin. DOM API methods/properties are used for duplicate/translate/scale/opacity/blend mode; selection uses a constrained `batchPlay` select descriptor when needed. Mutations run inside `core.executeAsModal`.  
**Why:** Adobe’s supported plugin surface is more deterministic and survives UI rearrangement.  
**References:** https://developer.adobe.com/photoshop/uxp/ and Adobe Photoshop UXP Layer / `executeAsModal` reference pages.

## D-029 — Photoshop bridge is loopback-only and paired
**Status:** Accepted  
**Decision:** Desktop listens only on `127.0.0.1:49373`. A random per-install adapter token is generated in the desktop vault. UXP stores it in UXP secure storage and receives a short-lived desktop client ID after pairing.  
**Why:** A local webpage or unrelated process should not be able to enqueue Photoshop commands merely because a port exists.

## D-030 — Photoshop action verification comes from post-state
**Status:** Accepted  
**Decision:** Selection, opacity, translation, scale, duplicate existence, and blend mode are checked after mutation. Desktop honors the plugin’s `verified` value rather than setting success unconditionally.  
**Why:** Same verification contract as Windows/browser adapters.

## D-031 — SQLite + WAL for local metadata
**Status:** Accepted  
**Decision:** Use SQLite with WAL and a versioned schema for settings, provider metadata, permissions, saved patches, and optional metadata—not raw provider keys.  
**Why:** Simple local durability, transactional behavior, no background cloud dependency.

## D-032 — Structured/redacted logs only
**Status:** Accepted  
**Decision:** Logs are JSONL metadata and recursively redact secret-looking fields. They do not store screenshots, auth headers, passwords, or raw provider payloads.  
**Why:** Observability must not become a data-exfiltration channel.

## D-033 — No silent provider fallback
**Status:** Accepted  
**Decision:** The data model supports automatic fallback, but provider switching is not silently performed unless the user has enabled that behavior.  
**Why:** BYOK requests cost money and can have different privacy/quality behavior.

## D-034 — Fail closed when adapter state is stale
**Status:** Accepted  
**Decision:** Confirmation tokens expire. Targets are validated against the captured/discovered context again before tool execution.  
**Why:** Long delays can make the screen/UI tree materially different from the plan evidence.

## D-035 — Source tree contains no fake production completions
**Status:** Accepted  
**Decision:** A repository lint gate rejects unfinished markers, explicit TypeScript `any`, unsafe Electron preferences, arbitrary body replacement, generic shell/JS planner tools, and obvious provider-key localStorage usage.  
**Why:** Enforces several non-negotiable requirements mechanically.

## D-036 — Windows installer build runs the whole monorepo first
**Status:** Accepted  
**Decision:** Packaging builds all pnpm/Turbo workspaces (including Chrome output), publishes the .NET sidecar self-contained, then runs `electron-builder`.  
**Why:** Prevents an installer from silently shipping stale/missing adapter assets.

## D-037 — Current environment limitations must be reported, not hidden
**Status:** Accepted  
**Decision:** A build/adapter is never claimed runtime-verified unless it was actually run against that runtime.  
**Why:** The coding environment used for this delivery is Linux, has no .NET SDK/Windows UIA/Photoshop, and registry access was unavailable during final dependency installation. Those facts are recorded in `docs/VALIDATION.md` rather than converted into fake green checks.

## Change rule
When a decision changes, do not delete history. Mark it **Superseded**, add the new decision, and point to the superseding ID.

## D-038 — Historical Gemini 400 defect: provider response schema
**Status:** Superseded/qualified by D-056  
**Problem:** An earlier PATCH revision repeatedly received HTTP 400 `Request contains an invalid argument` from `POST /interactions` while using a raw application schema.  
**Historical root cause:** PATCH passed `z.toJSONSchema(PatchPlanSchema)` directly as `response_format.schema`. The application schema uses constraints such as `z.string().min(1)`, which become JSON-Schema keywords such as `minLength`, and Zod emits schema metadata such as `$schema`. Gemini structured output accepts a documented JSON-Schema subset and rejects unsupported/over-complex schema parameters. The outer Interactions fields were retained. **Superseded by D-060/D-061:** later live diagnostics proved the direct top-level multimodal content array ambiguous under the current step schema, and the bundled `gemini-3.7-flash` default was replaced with the currently documented `gemini-3.6-flash`.  
**Decision:** Keep the Interactions API, move schema translation/validation into `@patch/provider-gemini`, and send a provider-native schema containing only the Google-supported subset. D-056 clarifies that this historical defect is not automatically asserted to explain a later live 400 once the provider-native schema is already present. Keep the stricter Zod `PatchPlanSchema` as the post-response runtime validator.  
**Reason:** Provider transport contracts and application-domain validation are different responsibilities. This fixes the malformed request without weakening PATCH's execution contract.  
**Alternative considered:** migrate back to `generateContent`. Rejected because Interactions is GA and Google's recommended surface for new development.  
**Files changed:** `packages/provider-gemini/src/index.ts`, `packages/provider-gemini/src/schema.ts`, `packages/provider-gemini/src/schema.test.ts`.

## D-039 — Gemini uses stable v1 Interactions
**Status:** Accepted  
**Problem:** The SDK defaults to `v1beta` even though PATCH does not depend on preview-only request fields.  
**Decision:** Construct `GoogleGenAI` with `httpOptions.apiVersion = "v1"`.  
**Reason:** Google documents Interactions, structured output, function calling, and system instructions as GA in `v1`; PATCH should prefer the stable major API unless it explicitly adopts a beta-only feature.  
**Alternative considered:** remain on implicit `v1beta`. Rejected to reduce API-shape churn.

## D-040 — Provider diagnostics are structured and payload-free
**Status:** Accepted  
**Problem:** Provider failures previously surfaced too little context while dumping raw requests would risk screenshots/prompts/secrets.  
**Decision:** Provider adapters emit redacted diagnostic events with provider, model, capability, tool count, schema-preflight status, API interface/version, duration, normalized error class, status/provider code, and failure stage.  
**Reason:** Enough information to diagnose transport/configuration failures without turning logs into a sensitive-data store.  
**Files changed:** `packages/ai-core/src/index.ts`, provider packages, `apps/desktop/src/main/provider-manager.ts`.

## D-041 — Fallback is transient-only
**Status:** Accepted  
**Problem:** Malformed provider requests must not appear to "work" only because another provider hid the bug.  
**Decision:** Automatic fallback is eligible only for rate limit, service unavailability, network failure, or timeout. Authentication, invalid request, unsupported model/capability, and application validation errors fail immediately.  
**Reason:** Preserves debuggability, user cost control, and correctness.  
**Files changed:** `apps/desktop/src/main/orchestrator.ts`.

## D-042 — Custom model IDs are explicit developer configuration
**Status:** Accepted  
**Problem:** Model configuration was limited to IDs returned by provider discovery, preventing intentional testing of a newer compatible model.  
**Decision:** Discovered models remain the safe default; an explicit **Advanced custom model IDs** mode permits syntactically valid provider model IDs without silently substituting them. Known discovered capabilities remain enforced; unknown models must pass provider/runtime checks.  
**Reason:** Flexibility without making unknown capability claims.  
**Files changed:** `apps/desktop/src/main/provider-manager.ts`, renderer provider settings.

## D-043 — Supplied sloth assets replace the floating P
**Status:** Accepted  
**Problem:** The floating `P` felt like a utility button instead of PATCH's persistent companion identity.  
**Decision:** Use the supplied 512px production sprite pack and its manifest as the character source. Runtime states map PATCH lifecycle to idle variants, wake/active, thinking, success, error, listening/responding, drag speed groups, and drop/settle. Frames are advanced by direct sprite transforms rather than React renders per frame.  
**Reason:** Expressive, consistent companion behavior with bounded CPU/GC overhead and no asset reinterpretation.  
**Alternative considered:** GIF/video or emoji. Rejected because they cannot provide state-aware animation, drag reactions, registration control, or the supplied character identity.  
**Files changed:** `apps/desktop/public/sloth/*`, `sloth-assets.ts`, `sloth-companion.tsx`, `shared/companion-motion.ts`, renderer styles/UI.

## D-044 — Companion motion is bounded and settled positions persist
**Status:** Superseded in part by D-055  
**Problem:** Dragging must feel physical without allowing an always-on-top window to become inaccessible or continuously write state.  
**Decision:** Originally used click/drag thresholding, velocity bands, capped release velocity, short damped inertia, work-area clamping, reduced-motion bypass, and a single persisted position only after settling. D-055 supersedes the release-motion portion with a much calmer one-shot settle of at most 12 px and no inertial timer/bounce. Stored coordinates are clamped against the current display work area on restore/display changes.  
**Reason:** Gives personality while preserving accessibility, reachability, and predictable resource usage.  
**Files changed:** `apps/desktop/src/main/index.ts`, `apps/desktop/src/shared/companion-motion.ts`, `sloth-companion.tsx`.

## D-045 — Provider validation preserves failure taxonomy
**Status:** Accepted  
**Problem:** Credential saving previously converted every failed provider validation into `AI_PROVIDER_AUTH_FAILED`, so a DNS outage, timeout, invalid provider request, or provider outage could be misreported as a bad key.  
**Decision:** `ProviderValidationResult` carries the normalized `PatchErrorCode` on failures, and `ProviderManager.saveKey()` preserves it.  
**Reason:** Setup UX and automation policy must distinguish credential problems from transient infrastructure and PATCH request-shape bugs.  
**Alternative considered:** infer the class from validation message text. Rejected because messages are provider-specific and brittle.  
**Files changed:** `packages/ai-core/src/index.ts`, `packages/ai-core/package.json`, `packages/provider-gemini/src/index.ts`, `packages/provider-openai/src/index.ts`, `apps/desktop/src/main/provider-manager.ts`, `pnpm-lock.yaml`.

## D-046 — Test Connection exercises PATCH's structured-output contract
**Status:** Accepted  
**Problem:** A plain-text ping proves authentication and basic generation but does not prove that the selected model can satisfy the structured response contract PATCH planning depends on.  
**Decision:** Gemini and OpenAI connection tests perform the lightest structured JSON request and validate the returned `{ ok: true }` object.  
**Reason:** This catches an unavailable/incompatible selected model during setup instead of waiting for the user's first PATCH plan.  
**Alternative considered:** list models only. Rejected because discovery does not prove per-model request compatibility for the selected API surface.  
**Files changed:** `packages/provider-gemini/src/index.ts`, `packages/provider-openai/src/index.ts`, `apps/desktop/src/renderer/ui.tsx`.

## D-047 — Renderer trust is origin/path exact and installed before navigation
**Status:** Accepted  
**Problem:** Development navigation used a raw string-prefix test, and navigation handlers were registered only after the initial renderer load.  
**Decision:** Use one `isTrustedRendererUrl()` policy: exact configured development origin, or exact packaged renderer file path. Register window-open/navigation denial before loading any document; privileged IPC additionally requires the main frame.  
**Reason:** Keeps the development IPC fix without accepting lookalike origins or nested untrusted frames.  
**Alternative considered:** trust all localhost/file URLs. Rejected because those origins can host unrelated content.  
**Files changed:** `apps/desktop/src/main/index.ts`.

## D-048 — Sloth sprite registration is square and pointer IPC is frame-coalesced
**Status:** Accepted  
**Problem:** Supplied animation cells are 512×512, but the companion viewport was slightly rectangular, subtly distorting the character. Raw pointer events also produced one Electron IPC move per browser event. Reduced-motion drag release could remain stuck in the `drop` main-process state.  
**Decision:** Render the sprites into a fixed square viewport, coalesce drag-position IPC to `requestAnimationFrame`, explicitly settle reduced-motion drops to idle, and keep disk persistence limited to settled positions.  
**Reason:** Preserves the supplied art registration, keeps an always-visible companion lightweight, and prevents an accessibility-specific state lock.  
**Alternative considered:** stretch sprites to available window bounds and send every pointer event. Rejected for visual consistency and unnecessary IPC load.  
**Files changed:** `apps/desktop/src/renderer/styles.css`, `apps/desktop/src/renderer/sloth-companion.tsx`, `apps/desktop/src/renderer/sloth-state.ts`, `apps/desktop/src/shared/companion-motion.ts`, related tests, `apps/desktop/src/main/index.ts`.

## D-049 — Sloth public assets use an explicit Vite public directory
**Status:** Accepted  
**Problem:** The renderer Vite root is `apps/desktop/src/renderer`, while the supplied production sprites live in `apps/desktop/public/sloth`. Without an explicit `publicDir`, Vite would neither serve those files in development nor copy them beside the packaged renderer output.  
**Decision:** Set `publicDir` to `apps/desktop/public` in `vite.renderer.config.ts` and keep runtime URLs relative to the renderer document (`./sloth/...`).  
**Reason:** One asset path now works in both the Vite dev server and packaged `file://` renderer without bundling 48 MB of sprite bytes into JavaScript.  
**Alternative considered:** import every PNG from React source. Rejected because it unnecessarily couples a large sprite pack to the JS module graph.  
**Files changed:** `apps/desktop/vite.renderer.config.ts`, `apps/desktop/public/sloth/*`.

## D-050 — Test the model currently selected in Settings

**Problem**  
The provider card allowed editing a model ID, but `Test selected model` called the main process with only the provider ID. The main process therefore tested the last persisted default model instead of the value visible in the UI.

**Root cause**  
The IPC contract did not carry a model override for connection testing.

**Decision**  
`settings:testProvider` now accepts `{ provider, model? }`, validates the model identifier in the main process, and passes the explicit model to the provider's structured-output test request.

**Reason**  
The UI must test what it says it is testing, especially for advanced/custom model IDs.

**Alternative considered**  
Force the user to save model roles before testing. Rejected because it makes diagnosis destructive to previously working configuration.

**Files changed**  
`apps/desktop/src/main/provider-manager.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/global.d.ts`, `apps/desktop/src/renderer/ui.tsx`.

## D-051 — Provider errors do not echo raw upstream error bodies

**Problem**  
Raw provider error messages can include request fragments or other context that should not be persisted or surfaced verbatim.

**Decision**  
Normalize user/developer-visible provider failures to PATCH error categories and redacted metadata (`provider`, HTTP status, provider code, stage). Raw upstream error bodies are not copied into PATCH messages or diagnostic metadata.

**Reason**  
Preserves useful diagnosis without risking prompt, screenshot metadata, or request-content leakage.

**Files changed**  
`packages/provider-gemini/src/index.ts`, `packages/provider-openai/src/index.ts`.

## D-052 — Credential signals outrank generic Gemini 400 classification

**Problem**  
Gemini provider failures can contain credential-specific signals even when the HTTP layer is a client error. A generic `status === 400` branch would mislabel a bad/expired key as a malformed PATCH request.

**Decision**  
Classify explicit API-key/authentication signals before generic invalid-request handling. Project/billing prerequisite failures are also kept non-transient so automatic provider fallback cannot hide account configuration errors.

**Reason**  
Connection testing and support diagnostics must distinguish a bad credential from a malformed provider payload.

**Files changed**  
`packages/provider-gemini/src/index.ts`.

## D-053 — Transparent renderer canvas is the companion transparency boundary
**Status:** Accepted  
**Problem:** A transparent Electron BrowserWindow still showed a large black rectangle behind the sloth.  
**Root cause:** The renderer document itself painted an opaque `:root` background. Window-level transparency cannot reveal desktop pixels if the renderer paints an opaque canvas.  
**Decision:** Keep the base `html/body/#root` transparent, mark the renderer view before React mounts, explicitly keep the companion view/shell transparent, and let full application views such as `.settings-shell` own their opaque background.  
**Reason:** Removes the rectangle and startup flash without weakening Electron security or making Settings unreadable.  
**Alternative considered:** Only set `BrowserWindow.transparent=true`. Rejected because that flag was already present and did not address the painted renderer surface.  
**Files changed:** `apps/desktop/src/renderer/main.tsx`, `apps/desktop/src/renderer/styles.css`, transparency regression test.

## D-054 — Companion movement changes position only
**Status:** Accepted  
**Problem:** Drag effects and release physics must never grow an always-on-top companion window.  
**Decision:** Route every companion move through a fixed-bounds helper that always reapplies the constant 154×128 size while changing X/Y only. Clamp settled positions to the display work area.  
**Reason:** Makes outer-size invariance explicit and testable rather than depending on callers to remember current dimensions.  
**Alternative considered:** Continue using independent `setPosition`/effect transforms without a size invariant. Rejected because future bounds changes could regress the expanding-box bug.  
**Files changed:** `apps/desktop/src/main/index.ts`, `apps/desktop/src/shared/companion-motion.ts`, tests.

## D-055 — Sloth motion favors calm settling over game physics
**Status:** Accepted  
**Problem:** High release velocity, ±12° lean and repeated post-release movement made PATCH feel like a physics toy rather than a lazy desktop companion.  
**Decision:** Cap visual lean around ±3°, cap release velocity at 420 px/s, map momentum to one displacement of at most 12 px, remove bounce/ricochet loops, and make reduced-motion release inertial-free. Retune supplied animations to 2–6 FPS.  
**Reason:** Matches the product character target while reducing CPU/IPC load and preserving accurate pointer tracking.  
**Alternative considered:** Keep high-energy physics and only slow sprite playback. Rejected because the window motion itself was the larger distraction.  
**Files changed:** sloth manifest/assets controller, `sloth-companion.tsx`, `companion-motion.ts`, styles and tests.

## D-056 — Remaining Gemini 400 is isolated by staged diagnostics, not guessed
**Status:** Accepted  
**Problem:** The historical raw-schema defect was real, but the current source already contains a provider-native schema and the user still reports a generic 400. Repeating the old diagnosis without a live request would be unsupported.  
**Decision:** Keep the current documented Interactions request architecture and add seven sequential probes: auth, bare text, tiny structured output, system instruction, safe multimodal fixture, context schema and planning schema. Store/display only sanitized stage metadata with a diagnostic ID.  
**Reason:** The first failing stage proves which API layer is rejected without sending private screenshots or weakening validation.  
**Alternative considered:** Migrate to `generateContent`, disable structured output, or silently route to OpenAI. Rejected because none proves the malformed layer and each can hide a PATCH defect.  
**Files changed:** Gemini provider/diagnostics/errors/schema/tests/CLI, AI-core diagnostic types, provider manager, preload/global typings, Settings UI and main IPC.

## D-057 — Gemini discovery proves existence; probes prove capability
**Status:** Accepted  
**Problem:** Model-name heuristics were being used to claim vision, structured-output and tool capabilities not explicitly guaranteed by model-discovery metadata.  
**Decision:** Treat Gemini `models.list()` as authoritative for existence only. Do not mark vision/structured/tool capabilities true solely from the name. Use Test Connection/staged diagnostics and real request preflight to prove required capabilities.  
**Reason:** Prevents an available model from being incorrectly labeled compatible with every PATCH role.  
**Files changed:** `packages/provider-gemini/src/index.ts`, provider manager behavior/documentation.

## D-058 — Windows packaging executes JavaScript CLIs through Node
**Status:** Accepted  
**Problem:** `package-win.mjs` failed with `spawnSync pnpm ENOENT` even though its parent was launched by pnpm; Windows `.cmd` shim/PATH resolution was the fragile nested boundary.  
**Decision:** Resolve the active pnpm JS entry from `npm_execpath` and execute it via `process.execPath`. Resolve Electron Builder's actual package bin JS entry the same way. Never construct an unquoted shell command.  
**Reason:** Works with repository/tool paths containing spaces and avoids PATHEXT/shell-shim ambiguity.  
**Alternative considered:** `shell:true` or hard-coded global pnpm paths. Rejected for quoting/security/portability reasons.  
**Files changed:** `apps/desktop/scripts/package-win.mjs`, `package-tools.mjs`, package-tool tests.

## D-059 — Installer acceptance includes packaged native SQLite execution
**Status:** Accepted  
**Problem:** A successful Electron Builder run does not prove `better-sqlite3` can load under the packaged Electron runtime.  
**Decision:** Keep `better-sqlite3`, avoid unnecessary node-gyp rebuilds, unpack the native package from ASAR, and make Windows packaging launch the unpacked executable in `--patch-smoke-native` mode to perform an actual temporary SQLite write/read before accepting the installer.  
**Reason:** Converts a native ABI/runtime assumption into a release gate.  
**Files changed:** `apps/desktop/electron-builder.yml`, `package-win.mjs`, Electron main smoke mode, persistence smoke helper, installer.

## D-060 — Explicit `user_input` steps remove Gemini multimodal input ambiguity
**Status:** Accepted  
**Supersedes:** the multimodal-input portion of D-038 and the “request shape remains unexplained” portion of D-056.

**Problem**  
The user's 17 August 2026 staged diagnostic passed authentication, text generation, structured output and system instruction, then Gemini v1 rejected the multimodal request with `The value 'image' is not supported for 'type' at 'input[1]'`.

**Root cause**  
PATCH sent `[TextContent, ImageContent]` directly as the top-level `input`. The current Interactions schema also accepts `Step[]`; in the user's live request the array was interpreted as steps, where `image` is not a valid step discriminator.

**Decision**  
Represent every PATCH Gemini turn as an explicit `user_input` step and place text/image blocks inside its `content` array. Preflight validates this shape and rejects ambiguous direct content arrays before network dispatch.

**Reason**  
The current v1 API explicitly defines `UserInputStep { type: "user_input", content: Content[] }`. The representation remains valid for multimodal input while eliminating union-shape ambiguity introduced by the step-oriented Interactions schema.

**Files changed**  
`packages/provider-gemini/src/schema.ts`, `index.ts`, `diagnostics.ts`, and provider tests.

## D-061 — PATCH defaults Gemini to the current documented GA Flash model
**Status:** Accepted

**Problem**  
The archive defaulted to `gemini-3.7-flash`, while the current public Gemini model/deprecation documentation lists `gemini-3.6-flash` as the GA Flash production model and does not list a stable 3.7 Flash identifier.

**Decision**  
Use `gemini-3.6-flash` as the bundled default. Continue to discover models from the provider and permit explicitly entered compatible custom IDs rather than hard-remapping user choices.

**Files changed**  
Gemini provider, setup documentation and model-configuration tests.

## D-062 — SQLite outlives BrowserWindow close/finalization handlers
**Status:** Accepted

**Problem**  
The installed app could throw `TypeError: The database connection is not open` during shutdown. Overlay `closed` handlers can discard/finalize a session, and session cleanup reads settings from SQLite.

**Root cause**  
PATCH closed the database in Electron's `before-quit` event. Electron emits `before-quit` before it starts closing windows; those window `closed` handlers therefore ran after the database had already been closed.

**Decision**  
`before-quit` marks the process as quitting, clears captures and stops adapters, but leaves SQLite open. Close SQLite in `will-quit`, after Electron has closed the windows.

**Reason**  
It aligns resource lifetime with Electron's documented lifecycle and prevents teardown callbacks from using a closed database.

**Files changed**  
`apps/desktop/src/main/index.ts`.

## D-063 — Adapter status polling is observational; connection is explicit
**Status:** Accepted

**Problem**  
The Adapters page showed only “Not connected” for Windows and Chrome with no practical setup path. Its Windows status check called an availability method that could start/ping the sidecar on every poll, amplifying startup failures and perceived lag.

**Decision**  
Expose read-only adapter connection state for polling. Start the Windows bridge once during app startup and expose **Connect / retry** for an explicit retry with a useful error. Add first-class Chrome/Edge extension-folder/native-host registration controls and Photoshop UXP folder/pairing instructions in Settings.

**Reason**  
Status UI should not cause side effects, and deterministic adapters need a complete user-visible onboarding path rather than a documentation-only hint.

**Files changed**  
Electron main/preload/types, `windows-bridge.ts`, Settings UI/styles and setup documentation.

## D-064 — Companion sprites load on demand
**Status:** Accepted

**Problem**  
The companion eagerly created browser `Image` objects for every large sprite sheet at startup. The supplied atlas set is large enough that eager decode/texture allocation can create avoidable memory pressure and jank in the packaged app.

**Decision**  
Do not preload all sprite sheets. Let the current animation image load as the state machine selects it; browser caching handles sheets that are actually used.

**Reason**  
Reduces startup work and memory pressure without changing animation identity or security boundaries.

**Files changed**  
`apps/desktop/src/renderer/sloth-companion.tsx`.

## D-064 — Core Gemini transport uses GenerateContent (supersedes D-007, D-039, D-056 and D-060)

**Date:** 18 August 2026

**Evidence:** The user's live Interactions diagnostic rejected top-level image content as a Step. A subsequent explicit `user_input` wrapper removed that exact error but normal planning still returned HTTP 400 `Request contains an invalid argument.` Google documents the same current Gemini models as supporting the GenerateContent API, multimodal `Part.inlineData`, system instructions and structured output.

**Decision:** PATCH's core Gemini connection test, multimodal analysis, context schema and planning schema now use `@google/genai` `models.generateContent`. Images use `inlineData: { data, mimeType }`; structured results use JSON mode plus `responseJsonSchema`, followed by PATCH's strict Zod validation. Interactions is no longer a dependency of the core reasoning path.

**Compatibility fallback:** If a model rejects provider-enforced `responseJsonSchema` with a client-invalid-request error, retry once in JSON mode with the schema embedded in the request, then apply the exact same strict Zod runtime validation. Never use this retry for authentication, unsupported-model, quota, timeout or outage failures.

## D-065 — Gemini model availability is account-discovered and recoverable (supersedes D-061's fixed-default assumption)

**Date:** 18 August 2026

**Decision:** Use `gemini-3.5-flash` as a conservative initial default because the user's live account already proved basic access to it, but treat `models.list()` as authoritative for the active key. Filter discovery to GenerateContent-capable general Gemini models and resolve stale persisted/custom IDs **before sending user content**. If a locally validated GenerateContent request still survives schema fallback but returns an unsupported-model or generic model-specific 400, retry exactly once with a different discovered model and log the substitution. Reconnecting a key and successful diagnostics heal stale saved role IDs.

**Reason:** A globally valid GA model can still be unavailable for a specific account/API surface; a stale database selection should not make PATCH unable to answer any prompt.

## D-066 — Development Windows bridge is self-contained

**Date:** 18 August 2026

**Evidence:** The user's development run selected a framework-dependent net8.0-windows bridge and failed because the machine had .NET 10 x64 plus .NET 8 x86, but no .NET 8 x64 runtime.

**Decision:** `apps/desktop/scripts/dev.mjs` publishes the Windows bridge as self-contained `win-x64` before launching Electron. Development bridge discovery accepts only self-contained Debug/Release publish outputs; stale framework-dependent binaries are intentionally ignored. Production packaging continues to publish and bundle the sidecar self-contained.
