> **Superseded runtime note (18 Aug 2026):** The Gemini Interactions transport described in older sections below is historical. The current implementation uses Gemini **GenerateContent** with `inlineData`, account model discovery/recovery, and strict post-response validation. See `GEMINI_ROOT_CAUSE.md` and `RUNTIME_FIX_REPORT_2026-08-18.md`.

# PATCH Runtime Stability Repair — 17 August 2026

## Confirmed failures addressed

- **Gemini multimodal HTTP 400:** the provider accepted authentication, text, structured output and system instruction, then rejected top-level `image` at `input[1]`. PATCH now sends explicit `user_input` steps with nested text/image content.
- **Stale Gemini default:** bundled default moved from `gemini-3.7-flash` to the currently documented GA `gemini-3.6-flash`.
- **Packaged shutdown crash:** SQLite was closed in `before-quit` before BrowserWindow `closed` callbacks finished session cleanup. Database close moved to `will-quit`.
- **Adapters had no usable setup flow:** Settings now exposes Windows connect/retry, Chrome/Edge extension + native-host registration, and Photoshop UXP folder + pairing instructions.
- **Repeated Windows adapter work:** status polling is now read-only; the sidecar starts once and retries only on explicit user action.
- **Packaged/dev bridge discovery mismatch:** development checks Debug, Release and self-contained Release publish paths; packaged builds use the bundled resource.
- **Companion startup pressure:** removed eager decode/preload of every sprite atlas and reduced provider/bootstrap refresh frequency from 4 seconds to 15 seconds.
- **Packaging resolver regression test:** explicit `npmExecPath: undefined` now remains an injected missing value instead of silently falling back to the host environment.

## Verification status

Executed in the delivery sandbox:

- PATCH source lint.
- TypeScript/TSX parse checks after edits.
- JavaScript/MJS syntax checks.
- Gemini request-shape unit/source assertions.
- packaging-resolver missing-pnpm behavioral check.
- archive integrity and checksum after final packaging.

Not executable in the delivery sandbox:

- live Gemini request with the user's private API key;
- Windows UI Automation sidecar runtime;
- Chrome native-host registry handshake on Windows;
- Photoshop UXP host runtime;
- packaged Electron/NSIS execution.

These must be run on the user's Windows machine before calling the release fully runtime-verified.
