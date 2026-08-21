# PATCH Security Threat Model

## Security objectives

PATCH is allowed to observe and alter user software, so its primary security objective is **bounded authority**: the AI can propose only registered operations against objects that PATCH actually discovered, and the runtime—not the model—decides whether an action is valid, permitted, confirmed and verified.

## Trust boundaries

1. **Electron renderer — untrusted/low privilege.** UI only; no Node, native process control, keys or direct provider requests.
2. **Electron main — trusted coordinator.** Owns vault, policy, provider clients, adapters, DB and tool registry.
3. **AI provider — external/untrusted output.** Output is always schema/policy validated.
4. **Screen/DOM/document content — untrusted data.** May contain prompt injection.
5. **Windows sidecar — privileged local component.** Exposes a fixed JSON-RPC allowlist.
6. **Chrome extension — privileged inside permitted web origins.** Exposes semantic extraction and restricted DSL only.
7. **Photoshop UXP — privileged inside Photoshop.** Paired to loopback desktop service with a secret token.

## Threats and controls

### Malicious webpage prompt injection
**Threat:** Page text says to ignore PATCH rules, exfiltrate secrets, or use a destructive tool.  
**Controls:** Observed page content is wrapped as untrusted; tools are supplied out-of-band; model cannot change permissions/risk; target IDs must exist; browser has no arbitrary script execution tool.

### Malicious visible screen text
Same policy as webpage injection. Pixels/OCR/vision evidence is data only and never system policy.

### Model fabricates a control/layer/DOM node
**Controls:** `ToolRegistry.validateAction` requires target membership in the current target registry plus compatible target prefix. Nested PATCH DSL target IDs are independently checked.

### Model invents a tool
**Controls:** Tool name must be registered. Unknown names fail before execution.

### Model downgrades risk
**Controls:** Runtime compares plan risk with registry-owned tool risk. Mismatch is a validation failure.

### Renderer compromise
**Controls:** context isolation, sandbox, Node disabled, restricted navigation/window opening, sender-origin checks, preload-only IPC. Renderer cannot read provider keys.

### Provider key theft
**Controls:** keys exist in renderer only while the user is entering/saving them; stored ciphertext uses Electron `safeStorage`; key is not returned after save; no secret logging; no provider key in URLs/localStorage/SQLite.

### Credential store unavailable
**Control:** fail closed; PATCH refuses persistence instead of silently writing plaintext.

### Chrome extension compromise
**Controls:** native messaging host has a fixed name/origin allowlist; native bridge does not expose a shell; desktop pipe messages still map to restricted content-adapter methods; webpage content cannot call native messaging directly.

### Native messaging host abuse
**Controls:** host only bridges framed JSON between Chrome and the desktop named pipe. It does not execute commands itself in native-host mode.

### Photoshop localhost spoofing / CSRF-like access
**Controls:** listener binds loopback only; every endpoint after pairing requires both adapter token and client ID; pairing token is random and encrypted by the desktop, stored in UXP secure storage. Browser adapter does not know the token.

### Malformed adapter response
**Controls:** Zod validates normalized browser/Photoshop/UIA context at the desktop boundary. Invalid context is rejected instead of passed to the model.

### Accidental destructive action
**Controls:** action risk policy, mutation confirmation by default, no destructive tools in initial adapter set, verification, and browser undo. UIA generic operations do not promise global undo. Coordinate fallback is a separately permissioned capability that is off by default and can only use a point derived from a real user annotation.

### Stale system state after user confirmation delay
**Controls:** confirmation expires; action target is validated before execution; Windows target is freshly resolved against foreground UIA tree.

### Secret capture from password fields
**Controls:** Windows UIA explicitly omits password values. Browser content suppresses values and credential-like autocomplete fields. Raw screenshots may still visually contain secrets, which is why capture is user-invoked and screenshots are not retained by default.

### Excessive provider spend
**Controls:** cropped selected context, model roles, local provider selection, no silent provider fallback, no AI call merely to open overlay. Future context caching can further reduce spend.

### Log exfiltration
**Controls:** structured metadata only, recursive secret-key redaction, and explicit policy against screenshot/auth/provider payload logging.

## Residual risks

- A screenshot intentionally sent for multimodal reasoning can contain sensitive pixels the OS accessibility layer cannot identify. Users must remain in control of invocation.
- UIA runtime IDs are scoped to live UI state and can change after significant app rerender; PATCH fails closed if the target cannot be resolved.
- Browser DOM locators for persistent patches can become stale after site redesign; a stale rule is skipped rather than guessed.
- Photoshop UXP/runtime API behavior must be regression-tested against each supported Photoshop major version.
- The Chrome desktop bridge currently uses a fixed local named-pipe name. Chrome native-host registration is per-user and the bridge exposes no shell, but a future signed release should add an application-level per-user IPC challenge/handshake as defense in depth against local same-machine impersonation.

## Security regression gates

`pnpm lint` rejects several forbidden source patterns. CI/release should additionally run dependency audit, code signing verification, Windows Defender/SmartScreen checks, extension/UXP packaging validation and the manual runtime matrix in `VALIDATION.md`.
