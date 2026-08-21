import type { AIProvider, ProviderDescriptor, ProviderDiagnosticReport, ProviderDiagnosticSink } from "@patch/ai-core";
import { GeminiProvider, GEMINI_DESCRIPTOR } from "@patch/provider-gemini";
import { OpenAIProvider, OPENAI_DESCRIPTOR } from "@patch/provider-openai";
import type { ModelDescriptor, ProviderId, ProviderSelection } from "@patch/schemas";
import { ProviderSelectionSchema } from "@patch/schemas";
import { PatchError } from "@patch/shared";
import type { PatchDatabase } from "@patch/persistence";
import type { CredentialVault } from "./credential-vault";
import { customModelFormatIsValid } from "./provider-config";

const credentialName = (provider: ProviderId): string => `provider:${provider}`;
const descriptors: Readonly<Record<ProviderId, ProviderDescriptor>> = {
  openai: OPENAI_DESCRIPTOR,
  gemini: GEMINI_DESCRIPTOR
};

const diagnosticSettingKey = (provider: ProviderId): string => `providerDiagnostic:${provider}`;

export type ProviderStatus = Readonly<{
  provider: ProviderId;
  configured: boolean;
  defaultModel: string | null;
  visionModel: string | null;
  reasoningModel: string | null;
  descriptor: ProviderDescriptor;
  lastDiagnostic: ProviderDiagnosticReport | null;
}>;

export class ProviderManager {
  readonly #vault: CredentialVault;
  readonly #db: PatchDatabase;
  readonly #diagnostics: ProviderDiagnosticSink;

  constructor(vault: CredentialVault, db: PatchDatabase, diagnostics: ProviderDiagnosticSink = () => undefined) {
    this.#vault = vault;
    this.#db = db;
    this.#diagnostics = diagnostics;
  }

  descriptor(provider: ProviderId): ProviderDescriptor { return descriptors[provider]; }

  #construct(provider: ProviderId, apiKey: string): AIProvider {
    return provider === "openai" ? new OpenAIProvider(apiKey, this.#diagnostics) : new GeminiProvider(apiKey, this.#diagnostics);
  }

  async withProvider(provider: ProviderId): Promise<AIProvider> {
    const key = await this.#vault.read(credentialName(provider));
    if (!key) throw new PatchError("AI_PROVIDER_AUTH_FAILED", `${provider} is not configured.`);
    return this.#construct(provider, key);
  }

  async saveKey(provider: ProviderId, apiKey: string): Promise<ProviderStatus> {
    const trimmed = apiKey.trim();
    if (trimmed.length < 10) throw new PatchError("AI_PROVIDER_AUTH_FAILED", "API key is too short to be valid.");
    const candidate = this.#construct(provider, trimmed);
    const validation = await candidate.validateCredentials();
    if (!validation.ok) throw new PatchError(validation.errorCode, validation.message);
    await this.#vault.save(credentialName(provider), trimmed);
    const existing = this.#db.getProvider(provider);

    // Do not preserve a stale model ID forever after reconnecting a provider.
    // Model availability changes over time and can differ by account/API surface.
    // Prefer the descriptor default when the provider actually returns it; otherwise
    // select the first stable text-capable discovered model and only fall back to the
    // descriptor when discovery itself is unavailable.
    let discoveredModels: ModelDescriptor[] = [];
    try {
      discoveredModels = await candidate.listModels();
    } catch (error: unknown) {
      await this.#diagnostics("warn", "patch.provider.model_discovery_after_auth_failed", {
        provider,
        reason: error instanceof PatchError ? error.code : "unknown"
      });
    }
    const discoveredIds = new Set(discoveredModels.map((model) => model.id));
    const fallbackModel = discoveredIds.has(candidate.descriptor.defaultModel)
      ? candidate.descriptor.defaultModel
      : discoveredModels.find((model) => model.stable && model.capabilities.text)?.id
        ?? discoveredModels.find((model) => model.capabilities.text)?.id
        ?? candidate.descriptor.defaultModel;
    const validOrFallback = (model: string | null | undefined): string =>
      model && (discoveredIds.size === 0 || discoveredIds.has(model)) ? model : fallbackModel;

    this.#db.saveProvider({
      providerId: provider,
      configured: true,
      defaultModel: validOrFallback(existing?.defaultModel),
      visionModel: validOrFallback(existing?.visionModel),
      reasoningModel: validOrFallback(existing?.reasoningModel)
    });
    const selection = this.getSelection();
    const isConfigured = async (candidateId: ProviderId | null): Promise<boolean> => candidateId ? this.#vault.has(credentialName(candidateId)) : false;
    this.setSelection({
      ...selection,
      defaultProvider: await isConfigured(selection.defaultProvider) ? selection.defaultProvider : provider,
      visionProvider: await isConfigured(selection.visionProvider) ? selection.visionProvider : provider,
      reasoningProvider: await isConfigured(selection.reasoningProvider) ? selection.reasoningProvider : provider
    });
    return this.status(provider);
  }

  async deleteKey(provider: ProviderId): Promise<void> {
    await this.#vault.delete(credentialName(provider));
    const existing = this.#db.getProvider(provider);
    this.#db.saveProvider({ providerId: provider, configured: false, defaultModel: existing?.defaultModel ?? null, visionModel: existing?.visionModel ?? null, reasoningModel: existing?.reasoningModel ?? null });
    const remaining = (await this.statuses()).find((status) => status.provider !== provider && status.configured)?.provider ?? null;
    const selection = this.getSelection();
    this.setSelection({
      ...selection,
      defaultProvider: selection.defaultProvider === provider ? remaining : selection.defaultProvider,
      visionProvider: selection.visionProvider === provider ? remaining : selection.visionProvider,
      reasoningProvider: selection.reasoningProvider === provider ? remaining : selection.reasoningProvider
    });
  }

  async deleteAllCredentials(): Promise<void> {
    await this.#vault.deleteAll();
    for (const provider of ["openai", "gemini"] as const) {
      const existing = this.#db.getProvider(provider);
      this.#db.saveProvider({ providerId: provider, configured: false, defaultModel: existing?.defaultModel ?? null, visionModel: existing?.visionModel ?? null, reasoningModel: existing?.reasoningModel ?? null });
    }
    const selection = this.getSelection();
    this.setSelection({ ...selection, defaultProvider: null, visionProvider: null, reasoningProvider: null });
  }

  async test(provider: ProviderId, requestedModel?: string): Promise<Readonly<{ ok: boolean; message: string }>> {
    try {
      const instance = await this.withProvider(provider);
      const status = await this.status(provider);
      const model = requestedModel?.trim() || status.defaultModel || instance.descriptor.defaultModel;
      if (!customModelFormatIsValid(provider, model)) {
        throw new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", `Invalid ${instance.descriptor.displayName} model identifier: ${model}`);
      }
      const result = await instance.testConnection(model);
      return result.ok ? { ok: true, message: result.message ?? `Connected successfully to ${model}.` } : { ok: false, message: result.message };
    } catch (error: unknown) {
      return { ok: false, message: error instanceof Error ? error.message : "Connection failed" };
    }
  }

  async diagnose(provider: ProviderId, requestedModel?: string): Promise<ProviderDiagnosticReport> {
    const instance = await this.withProvider(provider);
    if (!instance.diagnose) throw new PatchError("AI_PROVIDER_UNSUPPORTED_CAPABILITY", `${instance.descriptor.displayName} does not expose staged diagnostics.`);
    const status = await this.status(provider);
    const model = requestedModel?.trim() || status.defaultModel || instance.descriptor.defaultModel;
    if (!customModelFormatIsValid(provider, model)) throw new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", `Invalid ${instance.descriptor.displayName} model identifier: ${model}`);
    const report = await instance.diagnose(model);
    this.#db.setSetting(diagnosticSettingKey(provider), report);

    // Gemini diagnostics may transparently recover from a stale/unavailable saved
    // model by selecting one actually returned for this API key. Heal any role that
    // was pointing at the stale ID so the UI and subsequent sessions converge on the
    // verified model instead of retrying a known-bad selection forever.
    if (provider === "gemini" && report.model !== model) {
      const metadata = this.#db.getProvider(provider);
      if (metadata) {
        this.#db.saveProvider({
          providerId: provider,
          configured: metadata.configured,
          defaultModel: metadata.defaultModel === model ? report.model : metadata.defaultModel,
          visionModel: metadata.visionModel === model ? report.model : metadata.visionModel,
          reasoningModel: metadata.reasoningModel === model ? report.model : metadata.reasoningModel
        });
      }
    }
    return report;
  }

  async listModels(provider: ProviderId): Promise<ModelDescriptor[]> { return (await this.withProvider(provider)).listModels(); }

  async status(provider: ProviderId): Promise<ProviderStatus> {
    const metadata = this.#db.getProvider(provider);
    return {
      provider,
      configured: await this.#vault.has(credentialName(provider)),
      defaultModel: metadata?.defaultModel ?? null,
      visionModel: metadata?.visionModel ?? null,
      reasoningModel: metadata?.reasoningModel ?? null,
      descriptor: descriptors[provider],
      lastDiagnostic: this.#db.getSetting<ProviderDiagnosticReport | null>(diagnosticSettingKey(provider), null)
    };
  }

  async statuses(): Promise<ProviderStatus[]> { return Promise.all((["openai", "gemini"] as const).map((provider) => this.status(provider))); }

  async setModels(provider: ProviderId, values: Readonly<{ defaultModel: string; visionModel: string; reasoningModel: string; allowCustomModels?: boolean }>): Promise<void> {
    const cleaned = {
      defaultModel: values.defaultModel.trim(),
      visionModel: values.visionModel.trim(),
      reasoningModel: values.reasoningModel.trim()
    };
    let models: ModelDescriptor[] = [];
    try {
      models = await this.listModels(provider);
    } catch (error: unknown) {
      if (!values.allowCustomModels) throw error;
      await this.#diagnostics("warn", "patch.provider.model_discovery_skipped", {
        provider,
        reason: error instanceof PatchError ? error.code : "unknown"
      });
    }
    const byId = new Map(models.map((model) => [model.id, model]));
    const roles = [
      ["Default", cleaned.defaultModel, (model: ModelDescriptor) => model.capabilities.text, "support text"],
      ["Vision", cleaned.visionModel, (model: ModelDescriptor) => model.capabilities.vision, "support images"],
      ["Reasoning", cleaned.reasoningModel, (model: ModelDescriptor) => model.capabilities.structuredOutput && model.capabilities.vision, "support structured output and image context"]
    ] as const;

    for (const [label, modelId, predicate, requirement] of roles) {
      const known = byId.get(modelId);
      if (known) {
        // Gemini model discovery is authoritative for existence, but the discovery API does not
        // expose every PATCH capability with enough fidelity to infer vision/structured-output
        // support safely. The selected model is capability-probed by Test connection / staged
        // diagnostics and every real request remains provider-preflighted and Zod-validated.
        if (provider !== "gemini" && !predicate(known)) {
          throw new PatchError("AI_PROVIDER_UNSUPPORTED_CAPABILITY", `${label} model must ${requirement}.`);
        }
        continue;
      }
      if (!values.allowCustomModels || !descriptors[provider].supportsCustomModels) {
        throw new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", `${modelId} was not returned by ${descriptors[provider].displayName} model discovery. Enable advanced custom model IDs to use it explicitly.`);
      }
      if (!customModelFormatIsValid(provider, modelId)) throw new PatchError("AI_PROVIDER_UNSUPPORTED_MODEL", `Invalid ${descriptors[provider].displayName} model identifier: ${modelId}`);
    }
    this.#db.saveProvider({ providerId: provider, configured: true, ...cleaned });
  }

  getSelection(): ProviderSelection {
    return ProviderSelectionSchema.parse(this.#db.getSetting("providerSelection", { defaultProvider: null, visionProvider: null, reasoningProvider: null, automaticFallback: false, costPreference: "balanced" }));
  }

  setSelection(selection: ProviderSelection): void { this.#db.setSetting("providerSelection", ProviderSelectionSchema.parse(selection)); }

  async resolve(role: "default" | "vision" | "reasoning"): Promise<Readonly<{ provider: AIProvider; providerId: ProviderId; model: string }>> {
    return (await this.resolveCandidates(role))[0] ?? (() => { throw new PatchError("AI_PROVIDER_AUTH_FAILED", "Connect an AI provider in Settings first."); })();
  }

  async resolveCandidates(role: "default" | "vision" | "reasoning"): Promise<ReadonlyArray<Readonly<{ provider: AIProvider; providerId: ProviderId; model: string }>>> {
    const selection = this.getSelection();
    const selected = role === "vision" ? selection.visionProvider : role === "reasoning" ? selection.reasoningProvider : selection.defaultProvider;
    const primary = selected ?? selection.defaultProvider;
    if (!primary) throw new PatchError("AI_PROVIDER_AUTH_FAILED", "Connect an AI provider in Settings first.");
    const order: ProviderId[] = [primary];
    if (selection.automaticFallback) for (const candidate of ["openai", "gemini"] as const) if (candidate !== primary) order.push(candidate);
    const resolved: Array<Readonly<{ provider: AIProvider; providerId: ProviderId; model: string }>> = [];
    for (const providerId of order) {
      const status = await this.status(providerId);
      if (!status.configured) continue;
      const model = role === "vision" ? status.visionModel : role === "reasoning" ? status.reasoningModel : status.defaultModel;
      resolved.push({ provider: await this.withProvider(providerId), providerId, model: model ?? descriptors[providerId].defaultModel });
    }
    if (resolved.length === 0) throw new PatchError("AI_PROVIDER_AUTH_FAILED", `${primary} is not configured.`);
    return resolved;
  }
}
