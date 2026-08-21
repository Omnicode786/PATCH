import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  ["apps/desktop/src/main/orchestrator.ts", "classifyRuntimeActionIntent"],
  ["apps/desktop/src/main/index.ts", "focusable: false"],
  ["apps/desktop/src/main/browser-bridge.ts", "probeReadiness"],
  ["apps/desktop/src/main/orchestrator.ts", "Browser adapter is connected, but the preserved invocation target"],
  ["apps/desktop/src/main/orchestrator.ts", "PLANNER_DID_NOT_RETURN_ACTION"],
  ["apps/desktop/src/main/orchestrator.ts", "browser.applyPatch is registered but was removed"],
  ["apps/desktop/src/main/browser-bridge.ts", "browser.getStatus"],
  ["apps/desktop/src/main/browser-bridge.ts", "mutationCapabilityAvailable"],
  ["apps/desktop/src/main/register-tools.ts", "browser.verifyPatch"],
  ["adapters/chrome/src/service-worker.ts", "lastFocusedWindow: true"],
  ["adapters/chrome/src/service-worker.ts", "injectBundledContentAdapter"],
  ["adapters/chrome/src/content.ts", "browser.verifyPatch"],
  ["adapters/chrome/src/content.ts", "reconcilePatch"],
  ["packages/provider-gemini/src/index.ts", "RUNTIME DIRECTIVE"],
  ["packages/provider-openai/src/index.ts", "RUNTIME DIRECTIVE"],
  ["apps/desktop/src/renderer/ui.tsx", "Live mutation"],
  ["adapters/chrome/scripts/install-native-host.ps1", "allowed_origins"],
  ["apps/desktop/src/main/action-intent.test.ts", "Use your Chrome extension and remove the sidebar"]
];

let passed = 0;
for (const [file, marker] of checks) {
  const content = readFileSync(path.join(root, file), "utf8");
  if (!content.includes(marker)) throw new Error(`Agentic browser runtime validation failed: ${file} is missing ${JSON.stringify(marker)}`);
  passed += 1;
}
console.log(`PATCH agentic browser runtime validation passed (${passed}/${checks.length}).`);
