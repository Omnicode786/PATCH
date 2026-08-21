import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Annotation, ModelDescriptor, ProviderSelection } from "@patch/schemas";
import { SlothCompanion, type SlothState } from "./sloth-companion";
import { RichText } from "./rich-text";

type Tool = "select" | "draw" | "arrow";
type Point = { x: number; y: number };
type Draft = { start: Point; points: Point[] } | null;
type Bootstrap = Awaited<ReturnType<typeof window.patch.getBootstrap>>;
type ProviderStatus = Awaited<ReturnType<typeof window.patch.settings.getProviders>>[number];
type ProviderId = "openai" | "gemini";

const providerNames: Readonly<Record<ProviderId, string>> = { openai: "OpenAI", gemini: "Gemini" };
const permissionLabels: Readonly<Record<string, string>> = {
  captureScreen: "Capture screen when invoked",
  readAccessibility: "Read accessibility information",
  controlAccessibility: "Control accessible UI elements",
  coordinateControl: "Allow annotation-grounded coordinate fallback",
  modifyBrowser: "Modify browser pages",
  controlPhotoshop: "Control Photoshop through UXP",
  actionsWithoutConfirmation: "Perform reversible actions without confirmation"
};

const point = (event: ReactPointerEvent<SVGSVGElement>): Point => ({ x: event.clientX, y: event.clientY });
const rectFrom = (a: Point, b: Point) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });

function humanizeError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/^AI_PROVIDER_[A-Z_]+:\s*/i, "")
    .trim() || fallback;
}

function Overlay({ bootstrap }: { bootstrap: Bootstrap }) {
  const [invocation, setInvocation] = useState(bootstrap.invocation);
  const [tool, setTool] = useState<Tool>("select");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState<Draft>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof window.patch.submit>> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.patch.closeOverlay();
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void submit();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") setAnnotations((items) => items.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!invocation) return <div className="center-message">Capture context unavailable.</div>;

  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    setDraft({ start, points: [start] });
  };

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draft || busy) return;
    const current = point(event);
    if (tool === "draw") setDraft({ ...draft, points: [...draft.points, current] });
    else setDraft({ ...draft, points: [draft.start, current] });
  };

  const end = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!draft || busy) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const current = point(event);
    const id = `annotation-${crypto.randomUUID()}`;
    if (tool === "select") {
      const bounds = rectFrom(draft.start, current);
      if (bounds.width > 5 && bounds.height > 5) setAnnotations((items) => [...items, { id, kind: "rectangle", bounds }]);
    } else if (tool === "arrow") {
      setAnnotations((items) => [...items, { id, kind: "arrow", from: draft.start, to: current }]);
    } else if (draft.points.length > 1) {
      setAnnotations((items) => [...items, { id, kind: "freehand", points: [...draft.points, current] }]);
    }
    setDraft(null);
  };

  async function switchContextMode(mode: "app" | "screen") {
    if (!invocation || busy || invocation.contextMode === mode) return;
    setBusy(true);
    setResult(null);
    setProgress(mode === "screen" ? "Capturing the screen you chose to share…" : "Switching to app context…");
    try {
      const next = await window.patch.setContextMode(mode);
      setInvocation(next);
      setAnnotations([]);
      setDraft(null);
      setProgress("");
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch (error: unknown) {
      setProgress("");
      setResult({ kind: "answer", text: humanizeError(error, "Could not change context mode.") });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!prompt.trim() || busy || !invocation) return;
    setBusy(true);
    setResult(null);
    setProgress(invocation.contextMode === "screen" ? "Looking at the shared screen…" : "Reading app and browser context…");
    try {
      window.setTimeout(() => setProgress((value) => value ? "Grounding targets…" : value), 800);
      window.setTimeout(() => setProgress((value) => value ? "Planning safely…" : value), 1700);
      const response = await window.patch.submit({ sessionId: invocation.sessionId, prompt: prompt.trim(), annotations });
      setProgress("");
      setResult(response);
    } catch (error: unknown) {
      setProgress("");
      setResult({ kind: "answer", text: humanizeError(error, "PATCH could not process this request.") });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(token: string) {
    setBusy(true);
    setProgress("Applying and verifying…");
    try {
      setResult(await window.patch.confirm(token));
    } catch (error: unknown) {
      setResult({ kind: "answer", text: humanizeError(error, "Action failed.") });
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  const draftPath = draft?.points.map((p, index) => `${index === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ") ?? "";

  const screenVisible = invocation.contextMode === "screen" && Boolean(invocation.imageDataUrl);

  return <main className={`overlay-shell ${screenVisible ? "screen-context" : "app-context"}`}>
    {screenVisible && <img className="capture-image" src={invocation.imageDataUrl} alt="Current screen capture" draggable={false} />}
    {screenVisible ? <div className="capture-dim" /> : <div className="live-context-vignette" />}
    {screenVisible && <svg className="annotation-layer" onPointerDown={begin} onPointerMove={move} onPointerUp={end}>
      <defs><marker id="arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="currentColor" /></marker></defs>
      {annotations.map((annotation) => {
        if (annotation.kind === "rectangle") return <rect key={annotation.id} className="annotation-shape" x={annotation.bounds.x} y={annotation.bounds.y} width={annotation.bounds.width} height={annotation.bounds.height} rx="8" />;
        if (annotation.kind === "arrow") return <line key={annotation.id} className="annotation-line" x1={annotation.from.x} y1={annotation.from.y} x2={annotation.to.x} y2={annotation.to.y} markerEnd="url(#arrowhead)" />;
        return <polyline key={annotation.id} className="annotation-line" points={annotation.points.map((p) => `${p.x},${p.y}`).join(" ")} />;
      })}
      {draft && tool === "select" && <rect className="annotation-shape draft" {...rectFrom(draft.start, draft.points.at(-1) ?? draft.start)} rx="8" />}
      {draft && tool === "arrow" && <line className="annotation-line draft" x1={draft.start.x} y1={draft.start.y} x2={(draft.points.at(-1) ?? draft.start).x} y2={(draft.points.at(-1) ?? draft.start).y} markerEnd="url(#arrowhead)" />}
      {draft && tool === "draw" && <path className="annotation-line draft" d={draftPath} />}
    </svg>}

    <div className="overlay-topbar">
      <div className="brand-chip"><span className="brand-mark" aria-hidden="true"><img src="./sloth/sloth_idle_breathe.png" alt="" /></span><span>PATCH</span></div>
      <div className="context-chip">{invocation.activeApplication.processName || "App"}{invocation.activeApplication.windowTitle ? ` · ${invocation.activeApplication.windowTitle.slice(0, 70)}` : ""}</div>
      <div className="context-mode-switch" role="group" aria-label="PATCH context mode">
        <button className={invocation.contextMode === "app" ? "active" : ""} disabled={busy} onClick={() => void switchContextMode("app")}>Just talk</button>
        <button className={invocation.contextMode === "screen" ? "active" : ""} disabled={busy} onClick={() => void switchContextMode("screen")}>Show screen</button>
      </div>
      <button className="icon-button" onClick={() => void window.patch.closeOverlay()} aria-label="Close PATCH">×</button>
    </div>

    {screenVisible && <div className="annotation-toolbar" aria-label="Annotation tools">
      <button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")}>▱ <span>Select</span></button>
      <button className={tool === "draw" ? "active" : ""} onClick={() => setTool("draw")}>✎ <span>Draw</span></button>
      <button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")}>↗ <span>Arrow</span></button>
      <div className="toolbar-separator" />
      <button disabled={!annotations.length} onClick={() => setAnnotations((items) => items.slice(0, -1))}>↶ <span>Undo</span></button>
      <button disabled={!annotations.length} onClick={() => setAnnotations([])}>⌫ <span>Clear</span></button>
    </div>}

    <section className="command-dock">
      {!bootstrap.providerConfigured && <div className="provider-needed">
        <div><strong>PATCH is with you — connect an AI when you're ready.</strong><span>Add an OpenAI or Gemini key in Settings. The overlay and local app stay usable without a key.</span></div>
        <button onClick={() => void window.patch.openSettings()}>Connect AI</button>
      </div>}
      {progress && <div className="progress-row"><span className="thinking-dot" />{progress}</div>}
      {result && <ResultCard result={result} busy={busy} onConfirm={confirm} />}
      <div className="prompt-row">
        <div className="spark">✦</div>
        <textarea ref={inputRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={bootstrap.providerConfigured ? (screenVisible ? "Ask PATCH about this screen, or tell it what to change…" : `Ask PATCH about ${invocation.activeApplication.processName || "this app"}, or tell it what to change…`) : "Connect OpenAI or Gemini to start asking PATCH…"} rows={1} disabled={busy || !bootstrap.providerConfigured} />
        <button className="send-button" disabled={!bootstrap.providerConfigured || !prompt.trim() || busy} onClick={() => void submit()} aria-label="Send to PATCH">↑</button>
      </div>
      <div className="dock-hint"><span>{screenVisible ? (annotations.length ? `${annotations.length} annotation${annotations.length === 1 ? "" : "s"}` : "Screen shared · draw to point at anything") : "App + connected adapter context · no screenshot shared"}</span><span>Ctrl + Enter to run</span></div>
    </section>
  </main>;
}

function ResultCard({ result, busy, onConfirm }: { result: Awaited<ReturnType<typeof window.patch.submit>>; busy: boolean; onConfirm: (token: string) => Promise<void> }) {
  if (result.kind === "confirmation") return <div className="result-card confirmation-card">
    <div className="result-kicker">PATCH wants to</div>
    <div className="result-title">{result.title}</div>
    <ul>{result.actions.map((action) => <li key={action}>{action}</li>)}</ul>
    <div className="result-actions"><button onClick={() => void window.patch.cancel(result.token)}>Cancel</button><button className="primary" disabled={busy} onClick={() => void onConfirm(result.token)}>Apply</button></div>
  </div>;
  if (result.kind === "done") return <div className={`result-card ${result.verified ? "success" : "warning"}`}><div className="result-kicker">{result.verified ? "✓ Verified" : "⚠ Verification incomplete"}</div><RichText text={result.text} /></div>;
  return <div className="result-card"><div className="result-kicker">PATCH</div><RichText text={result.text} /></div>;
}

function ProviderCard({ status, onChanged }: { status: ProviderStatus; onChanged: () => Promise<void> }) {
  const id = status.provider;
  const [key, setKey] = useState("");
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [defaultModel, setDefaultModel] = useState(status.defaultModel ?? status.descriptor.defaultModel);
  const [visionModel, setVisionModel] = useState(status.visionModel ?? status.descriptor.defaultModel);
  const [reasoningModel, setReasoningModel] = useState(status.reasoningModel ?? status.descriptor.defaultModel);
  const [customModels, setCustomModels] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [connectionState, setConnectionState] = useState<"connected" | "error" | "not-configured">(status.configured ? "connected" : "not-configured");
  const [diagnostic, setDiagnostic] = useState(status.lastDiagnostic);
  const [showDiagnostics, setShowDiagnostics] = useState(Boolean(status.lastDiagnostic));

  useEffect(() => {
    setDefaultModel(status.defaultModel ?? status.descriptor.defaultModel);
    setVisionModel(status.visionModel ?? status.descriptor.defaultModel);
    setReasoningModel(status.reasoningModel ?? status.descriptor.defaultModel);
    setConnectionState(status.configured ? "connected" : "not-configured");
    setDiagnostic(status.lastDiagnostic);
  }, [status]);

  async function loadModels() {
    if (!status.configured) return; setBusy(true);
    try { const list = await window.patch.settings.listModels(id); setModels(list); setMessage(id === "gemini" ? `${list.length} GenerateContent-capable Gemini models discovered for this API key.` : `${list.length} compatible model records loaded from ${status.descriptor.displayName}.`); }
    catch (error: unknown) { setMessage(humanizeError(error, "Could not load models.")); } finally { setBusy(false); }
  }
  async function saveKey() {
    if (!key.trim()) return; setBusy(true); setMessage("Authenticating before storing the credential…");
    try { await window.patch.settings.saveProviderKey(id, key); setKey(""); setConnectionState("connected"); setMessage("Connected. The raw key left the renderer and is encrypted with Windows-backed storage."); await onChanged(); }
    catch (error: unknown) { setConnectionState("error"); setMessage(humanizeError(error, "Credential validation failed.")); } finally { setBusy(false); }
  }
  async function saveModels() {
    setBusy(true);
    try { await window.patch.settings.setModels({ provider: id, defaultModel, visionModel, reasoningModel, allowCustomModels: customModels }); setMessage(customModels ? "Custom model IDs saved. Use Test selected model / staged diagnostics to confirm compatibility; PATCH still validates every request at runtime." : id === "gemini" ? "Gemini model roles saved from provider discovery. Run capability probes to verify the selected roles." : "Model roles saved after discovered-capability validation."); await onChanged(); }
    catch (error: unknown) { setMessage(humanizeError(error, "Model settings were rejected.")); } finally { setBusy(false); }
  }
  async function testSelectedModel() {
    setBusy(true); setMessage(`Testing ${defaultModel} with PATCH's structured-output contract…`);
    try {
      const result = await window.patch.settings.testProvider(id, defaultModel);
      setConnectionState(result.ok ? "connected" : "error");
      setMessage(result.message);
    } catch (error: unknown) {
      setConnectionState("error");
      setMessage(humanizeError(error, "Connection test failed."));
    } finally { setBusy(false); }
  }
  async function runDiagnostics() {
    if (id !== "gemini") return;
    setBusy(true); setShowDiagnostics(true); setMessage(`Running staged Gemini diagnostics for ${defaultModel}…`);
    try {
      const report = await window.patch.settings.diagnoseProvider(id, defaultModel);
      setDiagnostic(report);
      setConnectionState(report.success ? "connected" : "error");
      setMessage(report.success
        ? `Gemini diagnostics passed all ${report.stages.length} stages using ${report.model}.`
        : `Gemini diagnostics failed at ${report.failedStage ?? "unknown stage"} using ${report.model}. Diagnostic ID: ${report.diagnosticId}`);
      await onChanged();
    } catch (error: unknown) {
      setConnectionState("error");
      setMessage(humanizeError(error, "Gemini diagnostics could not run."));
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    try { await window.patch.settings.deleteProviderKey(id); setConnectionState("not-configured"); setMessage("Disconnected and removed the saved credential."); await onChanged(); }
    catch (error: unknown) { setMessage(humanizeError(error, "Could not disconnect provider.")); } finally { setBusy(false); }
  }
  function resetModels() {
    setCustomModels(false);
    setDefaultModel(status.descriptor.defaultModel);
    setVisionModel(status.descriptor.defaultModel);
    setReasoningModel(status.descriptor.defaultModel);
    setMessage(`Default model staged: ${status.descriptor.defaultModel}. Save model roles to apply it.`);
  }
  const modelInput = (label: string, value: string, setter: (value: string) => void, filtered: ModelDescriptor[]) => customModels
    ? <label>{label}<input value={value} onChange={(event) => setter(event.target.value)} placeholder={status.descriptor.defaultModel} /></label>
    : <ModelSelect label={label} value={value} onChange={setter} models={filtered} />;

  const connectionLabel = connectionState === "connected" ? "Connected" : connectionState === "error" ? "Error" : "Not configured";
  const endpointHost = (() => { try { return new URL(status.descriptor.baseUrl).host; } catch { return status.descriptor.baseUrl; } })();

  return <div className="provider-card">
    <div className="provider-heading"><div><h3>{status.descriptor.displayName}</h3><p>{connectionLabel} · {status.descriptor.apiInterface} API {status.descriptor.apiVersion}</p></div><span className={`status-dot ${connectionState === "connected" ? "online" : connectionState === "error" ? "error" : ""}`} /></div>
    <div className="provider-meta"><span>Default · {status.descriptor.defaultModel}</span><span>Endpoint · {endpointHost}</span><span>Structured output · {status.descriptor.apiInterface}</span><span>Streaming · {status.descriptor.supportsStreaming ? "Supported" : "No"}</span></div>
    <div className="provider-actions"><button onClick={() => void window.patch.settings.openProviderLink(id, "credential")}>Get API key ↗</button><button onClick={() => void window.patch.settings.openProviderLink(id, "setup")}>Setup instructions ↗</button></div>
    <label>API key<div className="inline-field"><input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder={status.configured ? "Enter a replacement key" : "Paste your API key"} /><button disabled={!key.trim() || busy} onClick={() => void saveKey()}>Save securely</button></div></label>
    {status.configured && <>
      <div className="provider-actions"><button disabled={busy} onClick={() => void testSelectedModel()}>Test selected model</button>{id === "gemini" && <button disabled={busy} onClick={() => void runDiagnostics()}>Run 7-stage diagnostics</button>}<button disabled={busy} onClick={() => void loadModels()}>Refresh models</button><button disabled={busy} onClick={resetModels}>Reset models to default</button><button className="danger-text" disabled={busy} onClick={() => void disconnect()}>Disconnect</button></div>
      <ToggleRow title="Advanced custom model IDs" detail="Try an explicit Gemini/OpenAI model ID even if discovery did not return it. If Gemini explicitly reports that model unavailable, PATCH may recover to a discovered compatible model and records that fallback in diagnostics." enabled={customModels} onChange={setCustomModels} />
      <div className="model-grid">
        {modelInput("Default model", defaultModel, setDefaultModel, id === "gemini" ? models : models.filter((m) => m.capabilities.text))}
        {modelInput("Vision model", visionModel, setVisionModel, id === "gemini" ? models : models.filter((m) => m.capabilities.vision))}
        {modelInput("Reasoning model", reasoningModel, setReasoningModel, id === "gemini" ? models : models.filter((m) => m.capabilities.structuredOutput && m.capabilities.vision))}
        <button className="primary compact" disabled={busy || !defaultModel || !visionModel || !reasoningModel} onClick={() => void saveModels()}>Save model roles</button>
      </div>
    </>}
    {id === "gemini" && diagnostic && <div className="diagnostic-summary">
      <div className="diagnostic-heading"><strong>Gemini diagnostics</strong><button onClick={() => setShowDiagnostics((value) => !value)}>{showDiagnostics ? "Hide" : "Show diagnostics"}</button></div>
      {showDiagnostics && <>
        <div className="diagnostic-grid">
          <span>Diagnostic ID<strong>{diagnostic.diagnosticId}</strong></span>
          <span>Model<strong>{diagnostic.model}</strong></span>
          <span>Interface<strong>{diagnostic.apiInterface} · {diagnostic.apiVersion}</strong></span>
          <span>SDK<strong>@google/genai {diagnostic.sdkVersion}</strong></span>
          <span>Last successful stage<strong>{diagnostic.lastSuccessfulStage ?? "None"}</strong></span>
          <span>Failed stage<strong>{diagnostic.failedStage ?? "None"}</strong></span>
        </div>
        <div className="diagnostic-stages">{diagnostic.stages.map((stage, index) => <div className={stage.ok ? "diagnostic-stage ok" : "diagnostic-stage failed"} key={stage.stage}><span>{index + 1}. {stage.stage}</span><strong>{stage.ok ? `Passed · ${stage.durationMs} ms` : `${stage.errorCode ?? "FAILED"}${stage.httpStatus ? ` · HTTP ${stage.httpStatus}` : ""}`}</strong>{!stage.ok && stage.reason && <small>{stage.reason}</small>}</div>)}</div>
        <div className="provider-actions"><button onClick={() => void window.patch.settings.openLogFolder()}>Open PATCH log folder</button></div>
      </>}
    </div>}
    {message && <div className="field-message">{message}</div>}
  </div>;
}

function ModelSelect({ label, value, onChange, models }: { label: string; value: string; onChange: (value: string) => void; models: ModelDescriptor[] }) {
  const known = models.some((model) => model.id === value);
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Choose model</option>{value && !known && <option value={value}>{value} · current</option>}{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}{model.stable ? "" : " · preview"}</option>)}</select></label>;
}

function Companion({ bootstrap }: { bootstrap: Bootstrap }) {
  const [liveBootstrap, setLiveBootstrap] = useState(bootstrap);
  const [slothState, setSlothState] = useState<SlothState>("idle");
  useEffect(() => {
    let active = true;
    const refresh = () => void window.patch.getBootstrap().then((next) => { if (active) setLiveBootstrap(next); }).catch(() => undefined);
    const timer = window.setInterval(refresh, 15000);
    const unsubscribe = window.patch.companion.onState((next) => setSlothState(next));
    return () => { active = false; window.clearInterval(timer); unsubscribe(); };
  }, []);
  return <SlothCompanion providerConfigured={liveBootstrap.providerConfigured} shortcut={liveBootstrap.shortcut} externalState={slothState} />;
}

type SettingsTab = "General" | "AI & Adapters" | "Privacy" | "Permissions" | "Shortcuts" | "Adapters" | "Saved Patches" | "Appearance" | "Developer";
const tabs: SettingsTab[] = ["General", "AI & Adapters", "Privacy", "Permissions", "Shortcuts", "Adapters", "Saved Patches", "Appearance", "Developer"];

function Settings({ bootstrap }: { bootstrap: Bootstrap }) {
  const [tab, setTab] = useState<SettingsTab>("General");
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [selection, setSelection] = useState<ProviderSelection | null>(null);
  const [permissions, setPermissions] = useState<Readonly<Record<string, boolean>>>({});
  const [privacy, setPrivacy] = useState<Awaited<ReturnType<typeof window.patch.settings.getPrivacy>> | null>(null);
  const [adapters, setAdapters] = useState<Awaited<ReturnType<typeof window.patch.settings.getAdapters>> | null>(null);
  const [savedPatches, setSavedPatches] = useState<Awaited<ReturnType<typeof window.patch.settings.listSavedPatches>>>([]);
  const [shortcut, setShortcut] = useState(bootstrap.shortcut);
  const [notice, setNotice] = useState("");
  const [appearance, setAppearance] = useState<"dark" | "light">("dark");
  const [companion, setCompanion] = useState<Awaited<ReturnType<typeof window.patch.settings.getCompanion>> | null>(null);

  const refreshProviders = async () => { setProviders(await window.patch.settings.getProviders()); setSelection(await window.patch.settings.getProviderSelection()); };
  const refreshAdapters = async () => { setAdapters(await window.patch.settings.getAdapters()); };
  useEffect(() => {
    void refreshProviders();
    void window.patch.settings.getPermissions().then(setPermissions);
    void window.patch.settings.getPrivacy().then(setPrivacy);
    void refreshAdapters();
    void window.patch.settings.listSavedPatches().then(setSavedPatches);
    void window.patch.settings.getAppearance().then(setAppearance);
    void window.patch.settings.getCompanion().then(setCompanion);
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = appearance; }, [appearance]);
  useEffect(() => {
    let active = true;
    const refresh = () => void window.patch.settings.getAdapters().then((next) => { if (active) setAdapters(next); }).catch(() => undefined);
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function updateSelection(patch: Partial<ProviderSelection>) {
    if (!selection) return;
    const next = { ...selection, ...patch };
    setSelection(await window.patch.settings.setProviderSelection(next));
  }

  return <main className="settings-shell">
    <aside className="settings-sidebar">
      <div className="settings-brand"><span className="brand-mark" aria-hidden="true"><img src="./sloth/sloth_idle_breathe.png" alt="" /></span><div><strong>PATCH</strong><small>Settings</small></div></div>
      <nav>{tabs.map((item) => <button key={item} className={tab === item ? "selected" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
      <div className="privacy-foot">Your provider keys stay encrypted on this device.</div>
    </aside>
    <section className="settings-content">
      <header><div><h1>{tab}</h1><p>{tabDescription(tab)}</p></div></header>
      {notice && <div className="settings-notice">{notice}</div>}

      {tab === "General" && <div className="settings-stack">
        {companion && <div className="setting-panel"><h2>Companion presence</h2><p>Keep PATCH close without taking over your desktop. The companion hides itself before captures so it does not appear in your screen context.</p>
          <ToggleRow title="Show floating PATCH companion" detail="The animated PATCH sloth can be dragged anywhere, summons PATCH on click, and stays useful even before an AI provider is configured." enabled={companion.enabled} onChange={(enabled) => { setCompanion({ ...companion, enabled }); void window.patch.settings.setCompanionEnabled(enabled); }} />
          <ToggleRow title="Start PATCH with Windows" detail="Optional. PATCH stays in the tray and shows the companion after you sign in." enabled={companion.startAtLogin} onChange={(enabled) => void window.patch.settings.setStartAtLogin(enabled).then((startAtLogin) => setCompanion({ ...companion, startAtLogin }))} />
        </div>}
        <div className="setting-panel"><h2>Provider routing</h2><p>Keep it simple with one provider, or route vision and reasoning separately.</p>{selection && <div className="form-grid">
          <ProviderRouteSelect label="Default provider" value={selection.defaultProvider} providers={providers} onChange={(value) => void updateSelection({ defaultProvider: value })} />
          <ProviderRouteSelect label="Vision provider" value={selection.visionProvider} providers={providers} onChange={(value) => void updateSelection({ visionProvider: value })} />
          <ProviderRouteSelect label="Reasoning provider" value={selection.reasoningProvider} providers={providers} onChange={(value) => void updateSelection({ reasoningProvider: value })} />
        </div>}</div>
        <div className="setting-panel"><h2>Automatic provider fallback</h2><ToggleRow title="Allow automatic fallback" detail="When enabled, PATCH may use another configured provider after an availability or rate-limit failure. This can spend against that provider's account." enabled={selection?.automaticFallback ?? false} onChange={(enabled) => void updateSelection({ automaticFallback: enabled })} /></div>
      </div>}

      {tab === "AI & Adapters" && <div className="provider-list">
        {providers.map((status) => <ProviderCard key={status.provider} status={status} onChanged={refreshProviders} />)}
        {adapters && <div className="setting-panel"><h2>Native adapter health</h2><p>PATCH prefers deterministic adapters before accessibility or coordinate fallback.</p><div className="adapter-health-grid"><span>Windows UI Automation <strong>{adapters.windows.connected ? "Connected" : "Not connected"}</strong></span><span>Chrome browser agent <strong>{adapters.chrome.ready ? "Ready" : adapters.chrome.connected ? "Connected / not ready" : "Not connected"}</strong></span><span>Photoshop UXP <strong>{adapters.photoshop.connected ? "Connected" : "Not connected"}</strong></span></div><div className="provider-actions"><button onClick={() => setTab("Adapters")}>Open adapter setup</button></div></div>}
        <div className="setting-panel danger-panel"><h2>Credential reset</h2><p>Delete all provider and adapter credentials stored by PATCH on this Windows profile.</p><button className="danger-button" onClick={() => void window.patch.settings.deleteAllCredentials().then(() => { setNotice("All PATCH credentials were deleted."); void refreshProviders(); })}>Delete all PATCH credentials</button></div>
      </div>}

      {tab === "Privacy" && privacy && <div className="settings-stack"><div className="setting-panel"><h2>Capture lifecycle</h2><ToggleRow title="Delete captured screenshots after request" detail="Recommended. If disabled, completed captures are retained in memory for at most 15 minutes and are never written to screenshot history." enabled={privacy.deleteScreenshotsAfterRequest} onChange={(enabled) => { setPrivacy({ ...privacy, deleteScreenshotsAfterRequest: enabled }); void window.patch.settings.setDeleteScreenshots(enabled); }} /><StaticSetting title="Screenshot history" value="Off" /><StaticSetting title="Prompt logging" value="Off" /><StaticSetting title="Analytics containing images" value="Never" /></div><div className="setting-panel"><h2>BYOK path</h2><p className="code-flow">PATCH Desktop → your provider account → OpenAI / Gemini</p><p>Provider keys are not routed through a PATCH-owned cloud backend.</p></div></div>}

      {tab === "Permissions" && <div className="setting-panel"><h2>Capabilities</h2>{Object.entries(permissionLabels).map(([key, label]) => <ToggleRow key={key} title={label} detail={key === "actionsWithoutConfirmation" ? "Side-effect, destructive, and security-sensitive operations still require confirmation." : key === "coordinateControl" ? "Off by default. PATCH can click only a point derived from your own annotation, never model-supplied coordinates." : "You can turn this capability off at any time."} enabled={permissions[key] ?? false} onChange={(allowed) => { setPermissions({ ...permissions, [key]: allowed }); void window.patch.settings.setPermission(key, allowed); }} />)}</div>}

      {tab === "Shortcuts" && <div className="setting-panel"><h2>Summon PATCH</h2><label>Global shortcut<div className="inline-field narrow"><input value={shortcut} onChange={(event) => setShortcut(event.target.value)} /><button onClick={() => void window.patch.settings.setShortcut(shortcut).then((result) => setNotice(result.message))}>Apply</button></div></label><p>Default: Ctrl + Shift + Space. Electron accelerator syntax is accepted.</p></div>}

      {tab === "Adapters" && <div className="settings-stack">
        <div className="setting-panel"><h2>How PATCH chooses an adapter</h2><p>You do not manually choose an adapter for each request. Connect the integrations you want below; PATCH uses the active application and available deterministic capabilities to route Windows, browser, or Photoshop actions. Permissions still control what each adapter is allowed to do.</p></div>
        {adapters && <>
          <WindowsAdapterPanel status={adapters.windows} onRefresh={refreshAdapters} />
          <ChromeAdapterPanel status={adapters.chrome} onRefresh={refreshAdapters} />
          <PhotoshopPanel status={adapters.photoshop} onRefresh={refreshAdapters} />
        </>}
      </div>}

      {tab === "Saved Patches" && <div className="setting-panel"><h2>Persistent website transformations</h2>{savedPatches.length === 0 ? <div className="empty-state">No saved website PATCH rules yet.</div> : <div className="patch-list">{savedPatches.map((patch) => <div className="patch-row" key={patch.id}><div><strong>{patch.name}</strong><span>{patch.domain}{patch.pathPattern}</span></div><button className="danger-text" onClick={() => void window.patch.settings.deleteSavedPatch(patch.id).then(() => setSavedPatches((items) => items.filter((item) => item.id !== patch.id)))}>Delete</button></div>)}</div>}</div>}

      {tab === "Appearance" && <div className="setting-panel"><h2>Theme</h2><div className="theme-options"><button className={appearance === "dark" ? "chosen" : ""} onClick={() => { setAppearance("dark"); void window.patch.settings.setAppearance("dark"); }}>Dark</button><button className={appearance === "light" ? "chosen" : ""} onClick={() => { setAppearance("light"); void window.patch.settings.setAppearance("light"); }}>Light</button></div><p>Appearance changes only PATCH UI. Website patches are controlled separately.</p></div>}

      {tab === "Developer" && <div className="settings-stack"><div className="setting-panel"><h2>Runtime</h2><StaticSetting title="Protocol version" value="1" /><StaticSetting title="Desktop security" value="contextIsolation + sandbox" /><StaticSetting title="Planner execution" value="Whitelisted tools only" /><StaticSetting title="Provider state" value="Stateless by default" /></div><div className="setting-panel"><h2>Diagnostics</h2><p>Structured logs contain event names, IDs, durations, and redacted metadata. Screenshots and API keys are excluded.</p></div></div>}
    </section>
  </main>;
}

function ProviderRouteSelect({ label, value, providers, onChange }: { label: string; value: ProviderId | null; providers: ProviderStatus[]; onChange: (value: ProviderId | null) => void }) {
  return <label>{label}<select value={value ?? ""} onChange={(event) => onChange(event.target.value ? event.target.value as ProviderId : null)}><option value="">Not selected</option>{providers.filter((item) => item.configured).map((item) => <option key={item.provider} value={item.provider}>{providerNames[item.provider]}</option>)}</select></label>;
}

function ToggleRow({ title, detail, enabled, onChange }: { title: string; detail: string; enabled: boolean; onChange: (value: boolean) => void }) {
  return <div className="toggle-row"><div><strong>{title}</strong><p>{detail}</p></div><button className={`toggle ${enabled ? "on" : ""}`} onClick={() => onChange(!enabled)} role="switch" aria-checked={enabled}><span /></button></div>;
}

function StaticSetting({ title, value }: { title: string; value: string }) { return <div className="static-setting"><span>{title}</span><strong>{value}</strong></div>; }
function WindowsAdapterPanel({ status, onRefresh }: { status: { connected: boolean; lastError?: string | null }; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const connect = async () => {
    setBusy(true);
    setMessage("");
    try {
      const result = await window.patch.settings.connectWindowsAdapter();
      setMessage(result.message);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Windows UI Automation could not be connected.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="setting-panel">
    <div className="adapter-panel"><div><h2>Windows UI Automation</h2><p>Native .NET sidecar using capability-based Windows UI Automation control patterns.</p></div><span className={`adapter-status ${status.connected ? "connected" : ""}`}>{status.connected ? "Connected" : "Not connected"}</span></div>
    {!status.connected && <p className="adapter-help">PATCH starts the bridge once automatically. Use Connect / retry to start it again and get a concrete error if Windows blocks or cannot find the packaged sidecar.</p>}
    {status.lastError && !status.connected && <div className="adapter-error">{status.lastError}</div>}
    <div className="provider-actions"><button disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : status.connected ? "Reconnect" : "Connect / retry"}</button></div>
    {message && <div className="field-message">{message}</div>}
  </div>;
}

function ChromeAdapterPanel({ status, onRefresh }: { status: { connected: boolean; ready: boolean; pipeName: string; filesAvailable: boolean; protocolCompatible: boolean; activeTabAvailable: boolean; contentReachable: boolean; domContextAvailable: boolean; mutationCapabilityAvailable: boolean; contextVerified: boolean; observedDomNodeCount: number; failureCode: string | null; failureMessage: string | null }; onRefresh: () => Promise<void> }) {
  const [extensionId, setExtensionId] = useState("");
  const [browser, setBrowser] = useState<"Chrome" | "Edge">("Chrome");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const validExtensionId = /^[a-p]{32}$/.test(extensionId.trim().toLowerCase());

  const openFolder = async () => {
    try {
      await window.patch.settings.openChromeExtensionFolder();
      setMessage("Opened the packaged browser extension folder.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open the Chrome extension folder.");
    }
  };

  const register = async () => {
    if (!validExtensionId) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await window.patch.settings.registerChromeNativeHost(extensionId.trim().toLowerCase(), browser);
      setMessage(result.message);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not register the Chrome native messaging host.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="setting-panel">
    <div className="adapter-panel"><div><h2>Chrome / Edge</h2><p>Manifest V3 extension using native messaging · pipe {status.pipeName}</p></div><span className={`adapter-status ${status.ready ? "connected" : ""}`}>{status.ready ? "Ready" : status.connected ? "Connected / not ready" : "Not connected"}</span></div>
    <div className="adapter-health-grid">
      <span>Native bridge <strong>{status.connected ? "Connected" : "Not connected"}</strong></span>
      <span>Protocol <strong>{status.protocolCompatible ? "Compatible" : "Mismatch / unavailable"}</strong></span>
      <span>Active tab <strong>{status.activeTabAvailable ? "Reachable" : "Unavailable"}</strong></span>
      <span>Content adapter <strong>{status.contentReachable ? "Reachable" : "Unavailable"}</strong></span>
      <span>Semantic DOM <strong>{status.contextVerified ? `Available · ${status.observedDomNodeCount} nodes` : status.domContextAvailable ? "Ping ready / context failed" : "Unavailable"}</strong></span>
      <span>Live mutation <strong>{status.mutationCapabilityAvailable && status.contextVerified ? "Available" : "Unavailable"}</strong></span>
    </div>
    {status.failureMessage && <div className="adapter-error">{status.failureCode ? `${status.failureCode}: ` : ""}{status.failureMessage}</div>}
    <div className="adapter-setup">
      <strong>Connect the browser adapter</strong>
      <ol><li>Open the packaged extension folder below.</li><li>In Chrome or Edge extensions, enable Developer mode and choose Load unpacked, then select that folder.</li><li>Copy the 32-character extension ID shown by the browser, paste it here, select the browser, then register the native host.</li><li>Reload the extension once after registration. PATCH will show Connected when the native pipe is live.</li></ol>
      <div className="provider-actions"><button disabled={!status.filesAvailable} onClick={() => void openFolder()}>Open extension folder</button></div>
      {!status.filesAvailable && <div className="adapter-error">The packaged Chrome extension files were not found. Rebuild the Chrome adapter before packaging PATCH.</div>}
      <div className="form-grid adapter-form-grid">
        <label>Extension ID<input value={extensionId} onChange={(event) => setExtensionId(event.target.value)} placeholder="32 characters, a–p only" spellCheck={false} /></label>
        <label>Browser<select value={browser} onChange={(event) => setBrowser(event.target.value as "Chrome" | "Edge")}><option value="Chrome">Google Chrome</option><option value="Edge">Microsoft Edge</option></select></label>
      </div>
      <div className="provider-actions"><button disabled={busy || !validExtensionId || !status.filesAvailable} onClick={() => void register()}>{busy ? "Registering…" : "Register native host"}</button></div>
      {extensionId && !validExtensionId && <div className="adapter-inline-note">Chrome/Edge extension IDs contain exactly 32 lowercase letters from a through p.</div>}
      {message && <div className="field-message">{message}</div>}
    </div>
  </div>;
}

function PhotoshopPanel({ status, onRefresh }: { status: { connected: boolean; port: number; filesAvailable: boolean }; onRefresh: () => Promise<void> }) {
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const openFolder = async () => {
    try {
      await window.patch.settings.openPhotoshopPluginFolder();
      setMessage("Opened the packaged Photoshop UXP plugin folder.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open the Photoshop UXP plugin folder.");
    }
  };
  const showCode = async (rotate: boolean) => {
    const next = rotate ? await window.patch.settings.rotatePhotoshopPairingCode() : await window.patch.settings.getPhotoshopPairingCode();
    setCode(next);
    await onRefresh();
  };
  return <div className="setting-panel">
    <div className="adapter-panel"><div><h2>Photoshop UXP</h2><p>Authenticated local adapter on 127.0.0.1:{status.port}. The PATCH UXP panel must be loaded in Photoshop and paired once.</p></div><span className={`adapter-status ${status.connected ? "connected" : ""}`}>{status.connected ? "Connected" : "Not connected"}</span></div>
    <div className="adapter-setup">
      <strong>Connect Photoshop</strong>
      <ol><li>Open the PATCH plugin folder below.</li><li>In Adobe UXP Developer Tool choose Add Plugin, select the PATCH manifest from that folder, then Load the plugin into Photoshop.</li><li>Open the PATCH plugin panel in Photoshop.</li><li>Show a pairing code here and enter it in the plugin panel. The status will change to Connected after authentication.</li></ol>
      <div className="provider-actions"><button disabled={!status.filesAvailable} onClick={() => void openFolder()}>Open plugin folder</button><button onClick={() => void showCode(false)}>Show pairing code</button><button onClick={() => void showCode(true)}>Rotate code</button></div>
      {!status.filesAvailable && <div className="adapter-error">The packaged Photoshop adapter files were not found. Rebuild/package PATCH with the Photoshop adapter resource.</div>}
      {code && <div className="pairing-code">{code}</div>}
      {message && <div className="field-message">{message}</div>}
    </div>
  </div>;
}

function tabDescription(tab: SettingsTab): string {
  const descriptions: Readonly<Record<SettingsTab, string>> = {
    General: "Choose how PATCH stays with you and how it routes intelligence without making the simple path complicated.",
    "AI & Adapters": "Connect AI providers with OS-protected credentials, choose model roles, test real requests, and open official setup resources.",
    Privacy: "Control capture retention and what PATCH is allowed to remember.",
    Permissions: "Explicit capability gates sit between model plans and execution.",
    Shortcuts: "Choose how PATCH appears from anywhere on your computer.",
    Adapters: "Deterministic integrations are preferred over coordinate automation.",
    "Saved Patches": "Review website transformations configured to reapply on matching pages.",
    Appearance: "Keep PATCH quiet, legible, and native-feeling.",
    Developer: "Inspect architectural safety guarantees and runtime protocol information."
  };
  return descriptions[tab];
}

export function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const viewParam = useMemo(() => new URLSearchParams(location.search).get("view"), []);
  useEffect(() => { void window.patch.getBootstrap().then(setBootstrap); }, []);
  if (!bootstrap) return <div className="center-message">Starting PATCH…</div>;
  const view = viewParam === "settings" || viewParam === "overlay" || viewParam === "companion" ? viewParam : bootstrap.view;
  if (view === "overlay") return <Overlay bootstrap={bootstrap} />;
  if (view === "companion") return <Companion bootstrap={bootstrap} />;
  return <Settings bootstrap={bootstrap} />;
}
