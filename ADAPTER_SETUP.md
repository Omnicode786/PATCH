# PATCH Adapter & Provider Setup

This document describes the setup surfaces that actually exist in PATCH. Provider credentials are handled in Electron main and stored with the existing OS-backed credential vault; the renderer never receives saved raw secrets.

## AI providers

Open **Settings → AI & Adapters**. PATCH can keep OpenAI and Gemini configured at the same time and route default, vision, and reasoning roles independently from **Settings → General**.

### Google Gemini

**What it does:** multimodal screen understanding and structured PATCH planning through the Google GenAI SDK GenerateContent API.

**Account/service:** a Google account/project with Gemini API access.

**Get credentials:** click **Get API key** in PATCH. It opens the official Google AI Studio API-key page.

**Configuration:**
1. Open **Settings → AI & Adapters → Google Gemini**.
2. Click **Get API key**, create/copy the key, paste it into PATCH, and choose **Save securely**.
3. PATCH authenticates the key before persisting it.
4. Choose **Refresh models** to use provider-discovered model IDs.
5. Assign Default, Vision, and Reasoning model roles and save.
6. Choose **Test selected model**. PATCH performs a small authenticated structured-output GenerateContent request against the model ID currently visible in the Default model field, even before you persist a changed custom ID.
7. Choose **Run staged diagnostics** when a request still fails. PATCH isolates authentication, bare text generation, tiny structured output, system instruction, a safe one-pixel multimodal fixture, the PATCH context schema, and the PATCH plan schema. The report contains a diagnostic ID and sanitized metadata only.
8. **Reset models to default** stages the provider default for all three roles; choose **Save model roles** to apply it.

**Default model:** `gemini-3.5-flash` (PATCH refreshes account model discovery and can recover from an unavailable saved model).

**API/interface:** `models.generateContent` through `@google/genai` using the SDK default Gemini Developer API beta surface (`v1beta`); images use `inlineData` and structured output uses JSON mode/JSON Schema.

**Custom model IDs:** enable **Advanced custom model IDs** only when you intentionally want a compatible model that model discovery did not return. PATCH validates identifier shape and resolves the requested ID against account model discovery before sending user content. If the provider still rejects a locally valid request for that model, PATCH can retry exactly one different discovered GenerateContent model and records the fallback in diagnostics. Use **Test selected model** and staged diagnostics to prove the selected transport/capabilities.

**Environment variables:** `GEMINI_API_KEY` and `GOOGLE_API_KEY` are documented compatibility names for external tooling; PATCH's desktop UI stores its own encrypted credential and does not require an `.env` file.

**Common errors:**
- `AI_PROVIDER_AUTH_FAILED`: key rejected or provider not configured.
- `AI_PROVIDER_INVALID_REQUEST`: PATCH/provider request rejected; developer diagnostics include stage/status/code but never the key or payload content.
- `AI_PROVIDER_UNSUPPORTED_MODEL`: selected model is unavailable or identifier is invalid.
- `AI_PROVIDER_UNSUPPORTED_CAPABILITY`: the selected model failed or cannot satisfy a capability PATCH requires. Gemini model discovery is not used to guess these capabilities from the model name; connection tests/staged probes establish compatibility.
- `AI_PROVIDER_RATE_LIMITED`, `AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_NETWORK_ERROR`, `AI_PROVIDER_UNAVAILABLE`: transient failures. These are the only classes eligible for automatic provider fallback when the user enabled it.

**Disconnect:** choose **Disconnect** on the Gemini card. The encrypted key is deleted and routing roles are repaired to another configured provider where possible.

### OpenAI

**What it does:** multimodal screen understanding and structured PATCH planning through the OpenAI Responses API.

**Account/service:** an OpenAI API account/project with API access.

**Get credentials:** click **Get API key** in PATCH. It opens the official OpenAI API-key page. **Setup instructions** opens the official platform quickstart.

**Configuration:** the flow is the same as Gemini: save the key, refresh provider-discovered models, assign model roles, then **Test selected model**. The test performs a minimal structured-output request against the model ID currently visible in the Default model field rather than a plain-text ping.

**Default model:** `gpt-5.6`.

**API/interface:** Responses API `v1`, `store=false`.

**Environment variable:** `OPENAI_API_KEY` for external tooling. PATCH's UI does not require it.

**Custom model IDs:** available through **Advanced custom model IDs**. PATCH does not silently remap a custom ID. Use the connection test to verify account/model availability.

**Disconnect:** choose **Disconnect** on the OpenAI card.

## Provider routing and fallback

Open **Settings → General** to choose Default, Vision, and Reasoning providers. **Automatic provider fallback** is off by default. When enabled, fallback may occur only for rate limits, provider outages, network failures, or timeouts. Authentication failures, malformed provider requests, unsupported models, unsupported capabilities, and validation failures do not bounce to another provider and hide the bug.

## Native adapters

### Windows UI Automation

**What it does:** reads semantic Windows accessibility/UI Automation context and executes supported control patterns such as Invoke, Toggle, Value, Selection, and Scroll through the .NET sidecar.

**Requirement:** Windows 10/11. Source development needs an x64 .NET SDK capable of targeting .NET 8; `pnpm --filter @patch/desktop dev` publishes the bridge self-contained before Electron starts, so a separate .NET 8 x64 runtime is not required. The packaged app also bundles a self-contained bridge.

**Development:** run `pnpm --filter @patch/desktop dev`. On Windows this command first creates a self-contained Debug `win-x64` publish of the bridge and then launches Vite/Electron. Do not rely on the framework-dependent `bin/Debug/net8.0-windows` or `bin/Release/net8.0-windows` executables; PATCH intentionally ignores those outputs.

Open **Settings → Adapters** to inspect connection health. Packaged PATCH starts the sidecar once automatically; **Connect / retry** performs an explicit ping and surfaces the concrete sidecar error instead of silently retrying in the background. In development, PATCH uses only self-contained Debug/Release publish locations. UI Automation permissions are separately controlled in **Settings → Permissions**.

### Chrome / Chromium

**What it does:** provides semantic DOM context, constrained PATCH DSL transformations, undo/restore, and persistent site rules through a Manifest V3 extension plus native messaging.

**Setup from PATCH Settings (recommended):**
1. Open **Settings → Adapters → Chrome / Edge**.
2. Choose **Open extension folder**.
3. Open `chrome://extensions` (or `edge://extensions`), enable Developer mode, choose **Load unpacked**, and select the folder PATCH opened.
4. Copy the 32-character extension ID shown by the browser.
5. Paste the ID into PATCH, select Chrome or Edge, and choose **Register native host**. PATCH writes the user-level native-messaging manifest/registry entry for that exact extension origin and the packaged Windows bridge.
6. Reload the extension once. PATCH changes to **Connected** when the native messaging port reaches the desktop bridge.

**Development/manual equivalent:** run `pnpm build`, load `adapters/chrome/dist`, then run:

```powershell
.\adapters\chrome\dist\install-native-host.ps1 `
  -ExtensionId <extension-id> `
  -BridgeExe <absolute-path-to-Patch.WindowsBridge.exe>
```

Browser modification can be disabled under **Permissions**.

### Photoshop UXP

**What it does:** deterministic document/layer context plus the intentionally constrained PATCH mutation set (selection, duplicate, translate, scale, opacity, blend mode).

**Setup from PATCH Settings:**
1. Open **Settings → Adapters → Photoshop UXP** and choose **Open plugin folder**.
2. In Adobe UXP Developer Tool choose **Add Plugin / Add Existing Plugin**, select that folder's `manifest.json`, then use the plugin Actions menu to **Load** it into Photoshop.
3. Open the PATCH Photoshop panel.
4. Back in PATCH choose **Show pairing code** and enter the code in the plugin panel.
5. PATCH changes to **Connected** after the local authenticated handshake succeeds. Use **Rotate code** if an old pairing credential must be invalidated.

The plugin communicates only with the local PATCH bridge and stores its pairing secret with UXP secure storage. Use **Rotate code** to invalidate an old pairing credential.

## Secret-storage and logging rules

- Saved provider keys never return to the renderer.
- Keys are not stored in localStorage, plaintext JSON, logs, source, URLs, or PATCH cloud infrastructure.
- Provider diagnostics log provider ID, model, capability, tool count, schema-preflight result, diagnostic ID, API interface/version/SDK version where available, duration, normalized error category, HTTP status/provider error code, sanitized provider reason, and failure stage.
- Diagnostics deliberately exclude API keys, auth headers, prompts, screenshot base64, provider response bodies, tokens, passwords, and sensitive environment variables.

## Complete reset

**Settings → AI & Adapters → Delete all PATCH credentials** removes provider and adapter secrets from PATCH's credential vault. Provider model metadata may remain as non-secret local settings, while all provider routing roles become unconfigured until a credential is added again.
