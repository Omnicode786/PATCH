/// <reference types="vite/client" />

import type { Annotation, ModelDescriptor, ProviderSelection } from "@patch/schemas";
import type { ContextMode, InvocationBootstrap, SubmitResult } from "../main/orchestrator";
import type { ProviderDiagnosticReport } from "@patch/ai-core";
import type { ProviderStatus } from "../main/provider-manager";

type PatchRendererApi = Readonly<{
  getBootstrap(): Promise<Readonly<{ view: "overlay" | "settings" | "companion"; invocation: InvocationBootstrap | null; shortcut: string; providerConfigured: boolean }>>;
  openOverlay(): Promise<boolean>;
  openSettings(): Promise<boolean>;
  setContextMode(mode: ContextMode): Promise<InvocationBootstrap>;
  submit(input: Readonly<{ sessionId: string; prompt: string; annotations: Annotation[] }>): Promise<SubmitResult>;
  confirm(token: string): Promise<SubmitResult>;
  cancel(token: string): Promise<void>;
  closeOverlay(): Promise<void>;
  companion: Readonly<{
    beginDrag(input: Readonly<{ screenX: number; screenY: number }>): Promise<boolean>;
    moveDrag(input: Readonly<{ screenX: number; screenY: number }>): Promise<boolean>;
    endDrag(input: Readonly<{ vx: number; vy: number; reducedMotion: boolean }>): Promise<boolean>;
    cancelDrag(): Promise<boolean>;
    onState(listener: (state: "idle" | "active" | "thinking" | "success" | "error" | "listening" | "responding" | "drop") => void): () => void;
  }>;
  settings: Readonly<{
    getProviders(): Promise<ProviderStatus[]>;
    saveProviderKey(provider: "openai" | "gemini", apiKey: string): Promise<ProviderStatus>;
    deleteProviderKey(provider: "openai" | "gemini"): Promise<ProviderStatus[]>;
    deleteAllCredentials(): Promise<ProviderStatus[]>;
    testProvider(provider: "openai" | "gemini", model?: string): Promise<Readonly<{ ok: boolean; message: string }>>;
    diagnoseProvider(provider: "openai" | "gemini", model?: string): Promise<ProviderDiagnosticReport>;
    openLogFolder(): Promise<boolean>;
    listModels(provider: "openai" | "gemini"): Promise<ModelDescriptor[]>;
    setModels(input: Readonly<{ provider: "openai" | "gemini"; defaultModel: string; visionModel: string; reasoningModel: string; allowCustomModels?: boolean }>): Promise<ProviderStatus>;
    openProviderLink(provider: "openai" | "gemini", kind: "credential" | "setup"): Promise<boolean>;
    getProviderSelection(): Promise<ProviderSelection>;
    setProviderSelection(selection: ProviderSelection): Promise<ProviderSelection>;
    getPrivacy(): Promise<Readonly<{ deleteScreenshotsAfterRequest: boolean; screenshotHistory: false; promptLogging: false }>>;
    setDeleteScreenshots(enabled: boolean): Promise<boolean>;
    getAppearance(): Promise<"dark" | "light">;
    setAppearance(value: "dark" | "light"): Promise<"dark" | "light">;
    getCompanion(): Promise<Readonly<{ enabled: boolean; startAtLogin: boolean }>>;
    setCompanionEnabled(enabled: boolean): Promise<boolean>;
    setStartAtLogin(enabled: boolean): Promise<boolean>;
    getPermissions(): Promise<Readonly<Record<string, boolean>>>;
    setPermission(capability: string, allowed: boolean): Promise<boolean>;
    setShortcut(accelerator: string): Promise<Readonly<{ ok: boolean; message: string }>>;
    getAdapters(): Promise<Readonly<{
      windows: { connected: boolean; lastError: string | null };
      chrome: { connected: boolean; ready: boolean; pipeName: string; filesAvailable: boolean; protocolCompatible: boolean; activeTabAvailable: boolean; contentReachable: boolean; domContextAvailable: boolean; mutationCapabilityAvailable: boolean; contextVerified: boolean; observedDomNodeCount: number; failureCode: string | null; failureMessage: string | null };
      photoshop: { connected: boolean; port: number; filesAvailable: boolean };
    }>>;
    connectWindowsAdapter(): Promise<Readonly<{ ok: boolean; message: string }>>;
    openChromeExtensionFolder(): Promise<boolean>;
    registerChromeNativeHost(extensionId: string, browser: "Chrome" | "Edge"): Promise<Readonly<{ ok: boolean; message: string }>>;
    openPhotoshopPluginFolder(): Promise<boolean>;
    getPhotoshopPairingCode(): Promise<string>;
    rotatePhotoshopPairingCode(): Promise<string>;
    listSavedPatches(): Promise<Array<Readonly<{ id: string; name: string; domain: string; pathPattern: string; enabled: boolean; createdAt: string; lastAppliedAt: string | null }>>>;
    deleteSavedPatch(id: string): Promise<boolean>;
  }>;
}>;

declare global {
  interface Window { patch: PatchRendererApi; }
}
export {};
