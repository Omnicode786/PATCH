# PATCH Runtime Repair — 18 August 2026

## Repaired in this revision

- Gemini production transport moved from Interactions to `models.generateContent`.
- Screenshot/image input uses `inlineData.data` + `inlineData.mimeType`.
- Structured responses use GenerateContent JSON mode/JSON Schema followed by strict PATCH Zod validation.
- One controlled schema-transport fallback handles model revisions that reject a JSON-Schema keyword without weakening PATCH's final validation boundary.
- Stale/unavailable Gemini models are resolved against account model discovery **before user content is sent**; if a provider still rejects a verified model-specific request, PATCH retries exactly one different discovered GenerateContent model.
- Provider reconnect and successful diagnostics heal stale saved model role IDs.
- Gemini default changed to `gemini-3.5-flash`; account discovery remains authoritative.
- Development Windows UI Automation now publishes a **self-contained win-x64** bridge before Electron starts.
- Development bridge discovery accepts **only self-contained** Debug/Release publish output; stale framework-dependent binaries are deliberately ignored so a missing machine-wide .NET 8 x64 runtime cannot be selected by accident.
- Installed packaging already publishes and bundles the bridge self-contained; that behavior is preserved.
- If action planning fails because of provider request/schema/model incompatibility, PATCH safely degrades to a **read-only grounded answer** against the same frozen context rather than becoming completely unusable; no tool can execute on this path.
- Existing SQLite `will-quit` lifecycle repair, adapter setup UI, reduced adapter polling, companion preload reduction, and Windows-safe packaging CLI resolution are preserved.
- Windows NSIS packaging now retries **only transient EBUSY/resource-locked Electron Builder failures** up to three attempts, reducing antivirus/indexer file-lock flakiness without hiding real packaging failures.
- Desktop package version bumped to 0.1.1 and packaging metadata completed.

## Why the .NET error occurred

The user's development run selected `apps/windows-bridge/bin/Release/net8.0-windows/Patch.WindowsBridge.exe`, which is framework-dependent. The machine had .NET 10 x64 and .NET 8 x86, but not Microsoft.NETCore.App 8 x64, so that executable could not start. A self-contained win-x64 publish includes the target runtime and avoids that machine-wide runtime dependency.

## Verification performed in the delivery environment

- PATCH source lint passed.
- All TS/TSX sources parsed successfully after edits.
- JavaScript/MJS syntax checks passed for development and packaging scripts.
- Windows pnpm resolver's explicit-missing regression behavior passed directly.
- Provider source/tests were updated to assert GenerateContent transport and model fallback behavior.

## Environment-limited verification

The delivery container cannot reach the npm registry, so dependencies could not be installed and the complete pnpm/Vitest/TypeScript workspace gate could not be executed here. It also cannot execute Windows UI Automation, NSIS, Electron-on-Windows, or the user's private Gemini API key.

Run `pnpm verify` and the seven-stage live Gemini diagnostic on Windows before treating this build as live-provider verified.
