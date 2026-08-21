# PATCH Delivery Manifest

This corrected source archive, derived only from the user-provided `PATCH-fixed.zip`, contains the PATCH implementation, provider/adapters, supplied production sloth assets, build configuration, regression tests, Windows bootstrap/install tooling, security documentation, and the original master specification used for the build.

## Primary deliverables

- `apps/desktop` — Electron/React desktop application.
- `apps/windows-bridge` — .NET 8 Windows UI Automation sidecar and Chromium native-messaging bridge mode.
- `adapters/chrome` — Chrome Manifest V3 companion with live DOM extraction, PATCH DSL, undo and persistent rules.
- `adapters/photoshop` — Adobe Photoshop UXP companion with paired loopback control.
- `packages/*` — provider-neutral AI contracts, OpenAI/Gemini providers, policy, schemas, tool registry, persistence, logging and DSL.
- `DECISIONS.md` — durable engineering decision log.
- `ADAPTER_SETUP.md` — implemented provider/native-adapter setup, testing, security and troubleshooting guide.
- `GEMINI_ROOT_CAUSE.md` — historical Gemini schema defect plus current staged-diagnostic investigation and live-verification boundary.
- `apps/desktop/public/sloth` — the supplied 512 px production sprite sheets and manifest used by the persistent companion.
- `docs/MASTER_SPEC.md` — the source specification supplied for this build.
- `docs/RESEARCH.md` — current adapter/API research and rejected alternatives.
- `docs/THREAT_MODEL.md` — security threat model.
- `docs/VALIDATION.md` — exact executed-vs-runtime-required validation record.
- `.github/workflows/ci.yml` — Windows verification + installer packaging pipeline.
- `AUDIT_REPORT.md` — corrected-source production audit and residual release gates.
- `SETUP_PATCH.cmd` / `INSTALL_PATCH.ps1` — fresh Windows source-to-installer bootstrap.
- `FRESH_INSTALL.md` — fresh-machine instructions.

## Deliberately not included

- API keys or any credentials.
- User screenshots, prompts, databases or logs.
- `node_modules`.
- Generated installer/binaries, because this delivery environment is Linux and does not contain the .NET SDK/Windows UI runtime required to truthfully validate a Windows release build.
- Generated `node_modules`, `.turbo`, `dist`, `.NET bin/obj`, `release`, or coverage directories.

The archive **does include** the real `pnpm-lock.yaml` from the successfully resolved Windows dependency graph so fresh installs can use `--frozen-lockfile`.

See `docs/VALIDATION.md` before treating a commit as release-ready.
