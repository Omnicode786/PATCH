import { GeminiProvider } from "../src/index.ts";

const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!key?.trim()) {
  console.error("PATCH Gemini diagnostic requires GEMINI_API_KEY or GOOGLE_API_KEY in the current process environment.");
  process.exitCode = 2;
} else {
  const model = process.env.GEMINI_MODEL?.trim() || undefined;
  const provider = new GeminiProvider(key, (level, event, metadata) => {
    // Provider diagnostics are already redacted at the provider boundary. Keep CLI
    // output metadata-only and never print the credential or request content.
    if (event.endsWith("_failed")) {
      console.error(`[${level}] ${event}`, metadata);
    }
  });

  try {
    const report = await provider.diagnose(model);
    console.log(`Gemini staged diagnostics · ${report.model}`);
    for (const [index, stage] of report.stages.entries()) {
      const suffix = stage.ok
        ? `${stage.durationMs} ms`
        : `${stage.errorCode ?? "FAILED"}${stage.httpStatus ? ` · HTTP ${stage.httpStatus}` : ""}${stage.reason ? ` · ${stage.reason}` : ""}`;
      console.log(`${index + 1}. ${stage.stage}: ${stage.ok ? "PASS" : "FAIL"} · ${suffix}`);
    }
    console.log(`Diagnostic ID: ${report.diagnosticId}`);
    if (!report.success) process.exitCode = 1;
  } catch (error: unknown) {
    console.error("Gemini diagnostic could not run:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  }
}
