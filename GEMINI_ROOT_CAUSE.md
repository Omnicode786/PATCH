# Gemini Provider Failure Investigation — superseded transport repaired 18 August 2026

## Status

The previous Interactions repair was **not sufficient**. User runtime evidence on 18 August 2026 showed two distinct failures:

1. the old Interactions multimodal diagnostic still rejected `image` as a top-level step; and
2. after wrapping multimodal input in `user_input`, normal planning requests still failed with generic HTTP 400 `Request contains an invalid argument.`

The provider transport has therefore been moved off the experimental/churn-prone Interactions request path for PATCH's core reasoning calls and onto `models.generateContent`, using the official SDK `Part.inlineData` image representation and GenerateContent structured-output config.

**Live provider acceptance was not executed in this delivery environment.** The user's private API key is not available here. The corrected code must still be exercised on the user's Windows machine with staged diagnostics and a real PATCH submission.

## Runtime evidence

The user's live diagnostic on `gemini-3.5-flash` proved authentication, text generation, structured output and system instruction succeeded, while the Interactions multimodal request failed HTTP 400 because `image` was interpreted as an unsupported Step type.

A later PATCH revision nested image content under `user_input`, but normal planning then failed with the less-specific provider response `400 Request contains an invalid argument.` This means the prior change removed one ambiguity without establishing an end-to-end-compatible production request across the selected model/API revision.

The same runtime also reported that at least one saved/selected Gemini model was unavailable for the user's account or active API interface. Persisting a stale model ID must therefore not make PATCH unusable.

## Current architecture

PATCH now uses `@google/genai` `models.generateContent` for:

- text connection tests;
- structured output;
- system instructions;
- multimodal screenshot reasoning;
- context analysis;
- action planning.

Images are sent as SDK Parts:

```text
{
  inlineData: {
    data: "<base64>",
    mimeType: "image/png"
  }
}
```

Structured responses use:

```text
config.responseMimeType = "application/json"
config.responseJsonSchema = <provider-safe JSON Schema>
```

PATCH still validates the returned JSON with strict Zod schemas before any tool/action execution.

If a model revision rejects provider-enforced `responseJsonSchema` with HTTP 400, PATCH makes one controlled JSON-mode retry with the same schema included in the prompt and **still performs the strict Zod validation afterward**. Authentication, unsupported-model, rate-limit and outage failures are not hidden by that retry.

## Model availability repair

- Default Gemini model is now `gemini-3.5-flash`, which the user's live diagnostic already proved reachable for basic generation.
- Model discovery filters to general Gemini models capable of GenerateContent.
- Before sending user content, a persisted/requested model is resolved against the account's current GenerateContent model list. If a validated request is still rejected with an unsupported-model or generic model-specific HTTP 400, PATCH retries exactly once with a different discovered model.
- Re-saving a provider key no longer preserves stale model IDs that discovery does not return.
- Successful staged diagnostics heal saved Gemini role selections that pointed at an unavailable model.

## Regression coverage

The Gemini test suite now covers:

- provider-safe JSON Schema validation;
- official GenerateContent `text` + `inlineData` Part shape;
- rejection of the old Interactions `{type:"image", mime_type:...}` transport shape;
- all seven diagnostic stages using `models.generateContent`;
- production `analyzeContext` sending `inlineData` rather than Interactions Steps;
- preflight recovery from an unavailable saved Gemini model through model discovery;
- one alternate-model retry after a provider-side generic 400 that survives the schema transport fallback;
- provider error normalization and credential redaction.

## Acceptance test on Windows

1. Start PATCH from the repaired source.
2. Open Settings → AI & Adapters → Gemini.
3. Press Refresh models.
4. Run seven-stage diagnostics.
5. Confirm the report says `GenerateContent · v1beta` and all seven stages pass.
6. Submit a real PATCH request with a captured screen.
7. Confirm the log contains `patch.provider.request_success` and no Interactions `input[1] image` error.

If a live provider request still fails, use the new diagnostic ID and provider message. The old Interactions payload diagnosis should not be applied to the GenerateContent transport.
