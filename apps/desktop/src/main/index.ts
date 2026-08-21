import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray, type IpcMainInvokeEvent } from "electron";
import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { AnnotationSchema, ProviderIdSchema, ProviderSelectionSchema } from "@patch/schemas";
import { PatchDatabase } from "@patch/persistence";
import { PatchLogger } from "@patch/logging";
import { DEFAULT_PERMISSIONS } from "@patch/security";
import { ToolRegistry } from "@patch/tool-registry";
import { CredentialVault } from "./credential-vault";
import { ScreenCaptureService } from "./screen-capture";
import { WindowsBridgeClient } from "./windows-bridge";
import { BrowserBridgeServer } from "./browser-bridge";
import { PhotoshopBridgeServer } from "./photoshop-bridge";
import { ProviderManager } from "./provider-manager";
import { PatchOrchestrator, type ContextMode, type InvocationBootstrap } from "./orchestrator";
import { registerRuntimeTools } from "./register-tools";
import { clampCompanionPosition, fixedCompanionBounds, releaseSettleOffset } from "../shared/companion-motion";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(__dirname, "../preload/index.cjs");
const rendererPath = path.resolve(__dirname, "../renderer/index.html");
const devServer = process.env.PATCH_DEV_SERVER_URL;
const execFileAsync = promisify(execFile);

const chromeAdapterDirectory = (): string => app.isPackaged
  ? path.join(process.resourcesPath, "adapters", "chrome")
  : path.resolve(app.getAppPath(), "../../adapters/chrome/dist");

const photoshopAdapterDirectory = (): string => app.isPackaged
  ? path.join(process.resourcesPath, "adapters", "photoshop")
  : path.resolve(app.getAppPath(), "../../adapters/photoshop");

const openAdapterDirectory = async (directory: string, requiredFile: string, label: string): Promise<boolean> => {
  if (!existsSync(path.join(directory, requiredFile))) {
    throw new Error(`${label} files are not available at ${directory}. Build the adapter resources first.`);
  }
  const result = await shell.openPath(directory);
  if (result) throw new Error(`Could not open ${label} folder: ${result}`);
  return true;
};

let tray: Tray | null = null;
let settingsWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let currentInvocation: InvocationBootstrap | null = null;
let database: PatchDatabase;
let vault: CredentialVault;
let providers: ProviderManager;
let capture: ScreenCaptureService;
let windowsBridge: WindowsBridgeClient;
let browserBridge: BrowserBridgeServer;
let photoshopBridge: PhotoshopBridgeServer;
let orchestrator: PatchOrchestrator;
let logger: PatchLogger;
let registeredShortcut = "Ctrl+Shift+Space";
let isQuitting = false;
type CompanionState = "idle" | "active" | "thinking" | "success" | "error" | "listening" | "responding" | "drop";
let companionState: CompanionState = "idle";
let dragOffset: { x: number; y: number } | null = null;

const browserPreferences = () => ({
  preload: preloadPath,
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false
});

const isTrustedRendererUrl = (rawUrl: string): boolean => {
  try {
    const candidate = new URL(rawUrl);
    if (devServer) {
      const trustedDev = new URL(devServer);
      return (candidate.protocol === "http:" || candidate.protocol === "https:") && candidate.origin === trustedDev.origin;
    }
    if (candidate.protocol !== "file:") return false;
    const candidatePath = path.resolve(fileURLToPath(candidate));
    const trustedPath = path.resolve(rendererPath);
    return process.platform === "win32"
      ? candidatePath.toLowerCase() === trustedPath.toLowerCase()
      : candidatePath === trustedPath;
  } catch {
    return false;
  }
};

const loadRenderer = async (window: BrowserWindow, view: "overlay" | "settings" | "companion"): Promise<void> => {
  // Attach navigation policy before any document is loaded. Never use a prefix check here:
  // http://127.0.0.1:5173.evil.example would otherwise look deceptively similar.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  if (devServer) await window.loadURL(`${devServer}/?view=${view}`);
  else await window.loadFile(rendererPath, { query: { view } });
};

const assertTrustedSender = (event: IpcMainInvokeEvent): void => {
  const senderFrame = event.senderFrame;
  const senderUrl = senderFrame?.url;
  if (!senderFrame || senderFrame !== event.sender.mainFrame || !senderUrl || !isTrustedRendererUrl(senderUrl)) {
    throw new Error("Rejected IPC from an untrusted PATCH renderer.");
  }
};

const companionEnabled = (): boolean => !isQuitting && (database?.getSetting("companionEnabled", true) ?? true);

const companionSize = { width: 154, height: 128 } as const;

const moveCompanionTo = (point: Readonly<{ x: number; y: number }>): void => {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  // Fixed-size invariant: movement is allowed to change X/Y only.
  companionWindow.setBounds(fixedCompanionBounds(point, companionSize), false);
};

const persistCompanionPosition = (): void => {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  const { x, y } = companionWindow.getBounds();
  database.setSetting("companionPosition", { x, y });
};

const positionCompanion = (): void => {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  const current = companionWindow.getBounds();
  const saved = database.getSetting<{ x: number; y: number } | null>("companionPosition", null);
  const anchor = saved ?? { x: current.x, y: current.y };
  const display = screen.getDisplayNearestPoint(anchor);
  const fallback = { x: display.workArea.x + display.workArea.width - companionSize.width - 18, y: display.workArea.y + display.workArea.height - companionSize.height - 18 };
  const next = clampCompanionPosition(saved ?? fallback, display.workArea, companionSize);
  moveCompanionTo(next);
};

const setCompanionState = (state: CompanionState): void => {
  companionState = state;
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.webContents.send("companion:state", state);
};

const showCompanion = (): void => {
  if (!companionEnabled() || !companionWindow || companionWindow.isDestroyed()) return;
  positionCompanion();
  companionWindow.showInactive();
};

const createCompanion = async (): Promise<void> => {
  if (!companionEnabled()) return;
  if (companionWindow && !companionWindow.isDestroyed()) { showCompanion(); return; }
  companionWindow = new BrowserWindow({
    width: companionSize.width,
    height: companionSize.height,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    // The floating companion must never steal the foreground app. Invocation
    // grounding happens when the user clicks the companion; keeping this window
    // non-focusable preserves Chrome/Photoshop/etc. as the original target.
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: browserPreferences()
  });
  // Keep the invariant at runtime as well as construction time. Electron on
  // Windows will otherwise focus a clickable transparent companion before the
  // main process can preserve the user's original foreground HWND.
  companionWindow.setFocusable(false);
  companionWindow.setAlwaysOnTop(true, "floating");
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  companionWindow.once("ready-to-show", () => { positionCompanion(); showCompanion(); setCompanionState(companionState); });
  companionWindow.once("closed", () => { companionWindow = null; });
  try {
    await loadRenderer(companionWindow, "companion");
  } catch (error: unknown) {
    if (companionWindow && !companionWindow.isDestroyed()) companionWindow.destroy();
    companionWindow = null;
    throw error;
  }
};

const hideCompanionForCapture = async (): Promise<boolean> => {
  const wasVisible = Boolean(companionWindow && !companionWindow.isDestroyed() && companionWindow.isVisible());
  if (wasVisible) {
    companionWindow?.hide();
    // Give Desktop Window Manager one frame to remove PATCH from the captured desktop.
    await new Promise<void>((resolve) => setTimeout(resolve, 45));
  }
  return wasVisible;
};

const closeOverlay = (): void => {
  companionWindow?.setAlwaysOnTop(true, "floating");
  setCompanionState("idle");
  const invocation = currentInvocation;
  currentInvocation = null;
  if (invocation) orchestrator.discardSession(invocation.sessionId);
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close();
  overlayWindow = null;
};

const openOverlay = async (): Promise<void> => {
  setCompanionState("active");
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return;
  }
  let invocation: InvocationBootstrap;
  try {
    // Default to app/browser context. PATCH can identify Chrome from Windows metadata
    // and query the connected browser adapter without silently taking a screenshot.
    invocation = await orchestrator.createInvocation("app");
  } catch (error: unknown) {
    setCompanionState("error");
    setTimeout(() => setCompanionState("idle"), 1600);
    throw error;
  }
  currentInvocation = invocation;
  overlayWindow = new BrowserWindow({
    x: invocation.displayBounds.x,
    y: invocation.displayBounds.y,
    width: Math.max(320, invocation.displayBounds.width),
    height: Math.max(240, invocation.displayBounds.height),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: browserPreferences()
  });
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.once("ready-to-show", () => overlayWindow?.show());
  overlayWindow.once("closed", () => {
    overlayWindow = null;
    const active = currentInvocation;
    currentInvocation = null;
    if (active) orchestrator.discardSession(active.sessionId);
    companionWindow?.setAlwaysOnTop(true, "floating");
    showCompanion();
  });
  try {
    await loadRenderer(overlayWindow, "overlay");
    if (companionWindow && !companionWindow.isDestroyed()) {
      companionWindow.setAlwaysOnTop(true, "screen-saver", 1);
      showCompanion();
      setCompanionState("listening");
    }
  } catch (error: unknown) {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    overlayWindow = null;
    orchestrator.discardSession(invocation.sessionId);
    currentInvocation = null;
    companionWindow?.setAlwaysOnTop(true, "floating");
    showCompanion();
    setCompanionState("error");
    setTimeout(() => setCompanionState("idle"), 1600);
    throw error;
  }
};

const openSettings = async (): Promise<void> => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    title: "PATCH Settings",
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#101114",
    webPreferences: browserPreferences()
  });
  settingsWindow.once("ready-to-show", () => settingsWindow?.show());
  settingsWindow.once("closed", () => { settingsWindow = null; });
  try {
    await loadRenderer(settingsWindow, "settings");
  } catch (error: unknown) {
    if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy();
    settingsWindow = null;
    throw error;
  }
};

const shortcutHandler = (): void => {
  void openOverlay().catch((error: unknown) => logger.error("patch.overlay.open_failed", { message: error instanceof Error ? error.message : "unknown" }));
};

const registerShortcut = (accelerator: string): boolean => {
  const previous = registeredShortcut;
  if (globalShortcut.isRegistered(previous)) globalShortcut.unregister(previous);
  const ok = globalShortcut.register(accelerator, shortcutHandler);
  if (ok) {
    registeredShortcut = accelerator;
    return true;
  }
  if (previous && previous !== accelerator && !globalShortcut.isRegistered(previous)) globalShortcut.register(previous, shortcutHandler);
  return false;
};

const createTray = (): void => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#111318"/><path fill="#fff" d="M8 7h9.5c5 0 8 2.7 8 7.1s-3 7.2-8 7.2H13V26H8V7zm5 4.4v5.5h4c2.2 0 3.4-1 3.4-2.8 0-1.7-1.2-2.7-3.4-2.7h-4z"/></svg>`;
  tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`));
  tray.setToolTip("PATCH");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open PATCH", click: () => void openOverlay().catch((error: unknown) => logger.error("patch.overlay.open_failed", { message: error instanceof Error ? error.message : "unknown" })) },
    { label: "Settings", click: () => void openSettings().catch((error: unknown) => logger.error("patch.settings.open_failed", { message: error instanceof Error ? error.message : "unknown" })) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() }
  ]));
  tray.on("double-click", () => void openOverlay().catch((error: unknown) => logger.error("patch.overlay.open_failed", { message: error instanceof Error ? error.message : "unknown" })));
};

const providerModelsInput = z.object({
  provider: ProviderIdSchema,
  defaultModel: z.string(),
  visionModel: z.string(),
  reasoningModel: z.string(),
  allowCustomModels: z.boolean().default(false)
}).strict();const permissionName = z.enum(["captureScreen", "readAccessibility", "controlAccessibility", "coordinateControl", "modifyBrowser", "controlPhotoshop", "actionsWithoutConfirmation"]);

const registerIpc = (): void => {
  ipcMain.handle("patch:getBootstrap", async (event) => {
    assertTrustedSender(event);
    const view = event.sender === overlayWindow?.webContents ? "overlay" : event.sender === companionWindow?.webContents ? "companion" : "settings";
    const statuses = await providers.statuses();
    return {
      view,
      invocation: view === "overlay" ? currentInvocation : null,
      shortcut: registeredShortcut,
      providerConfigured: statuses.some((status) => status.configured)
    };
  });

  ipcMain.handle("patch:openOverlay", async (event) => { assertTrustedSender(event); await openOverlay(); return true; });
  ipcMain.handle("patch:setContextMode", async (event, raw: unknown) => {
    assertTrustedSender(event);
    if (event.sender !== overlayWindow?.webContents) throw new Error("Context mode can only be changed from the PATCH overlay.");
    const mode = z.enum(["app", "screen"]).parse(raw) as ContextMode;
    const current = currentInvocation;
    if (!current || !overlayWindow || overlayWindow.isDestroyed()) throw new Error("PATCH overlay session is not active.");
    if (current.contextMode === mode) return current;

    const switchingToScreen = mode === "screen";
    let companionWasVisible = false;
    if (switchingToScreen) {
      // Do not include PATCH itself in the explicit screenshot. The orchestrator reuses
      // the original active-app metadata, so hiding the overlay cannot change the target.
      overlayWindow.hide();
      companionWasVisible = await hideCompanionForCapture();
      await new Promise<void>((resolve) => setTimeout(resolve, 45));
    }
    try {
      const next = await orchestrator.switchInvocation(current.sessionId, mode);
      currentInvocation = next;
      overlayWindow.setBounds({ x: next.displayBounds.x, y: next.displayBounds.y, width: Math.max(320, next.displayBounds.width), height: Math.max(240, next.displayBounds.height) }, false);
      if (switchingToScreen) overlayWindow.show();
      overlayWindow.focus();
      return next;
    } catch (error) {
      if (switchingToScreen && overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.show();
      throw error;
    } finally {
      if (companionWasVisible) {
        companionWindow?.setAlwaysOnTop(true, "screen-saver", 1);
        showCompanion();
      }
    }
  });
  ipcMain.handle("patch:openSettings", async (event) => {
    assertTrustedSender(event);
    // A screen-saver-level overlay would otherwise cover the Settings window. Closing it also releases its capture.
    if (event.sender === overlayWindow?.webContents) closeOverlay();
    await openSettings();
    return true;
  });

  ipcMain.handle("patch:submit", async (event, raw: unknown) => {
    assertTrustedSender(event);
    setCompanionState("thinking");
    const input = z.object({ sessionId: z.string().uuid(), prompt: z.string().min(1).max(20000), annotations: z.array(AnnotationSchema).max(100) }).strict().parse(raw);
    try {
      const result = await orchestrator.submit(input.sessionId, input.prompt, input.annotations);
      setCompanionState(result.kind === "done" ? (result.verified ? "success" : "error") : result.kind === "answer" ? "responding" : "active");
      if (result.kind === "done") setTimeout(() => closeOverlay(), 900);
      else setTimeout(() => setCompanionState("idle"), 1300);
      return result;
    } catch (error) {
      setCompanionState("error");
      setTimeout(() => setCompanionState("idle"), 1600);
      throw error;
    }
  });

  ipcMain.handle("patch:confirm", async (event, token: unknown) => {
    assertTrustedSender(event);
    setCompanionState("thinking");
    try {
      const result = await orchestrator.confirm(z.string().uuid().parse(token));
      setCompanionState(result.kind === "done" && result.verified ? "success" : "error");
      if (result.kind === "done") setTimeout(() => closeOverlay(), 900);
      return result;
    } catch (error) { setCompanionState("error"); setTimeout(() => setCompanionState("idle"), 1600); throw error; }
  });

  ipcMain.handle("patch:cancel", (event, token: unknown) => {
    assertTrustedSender(event);
    orchestrator.cancel(z.string().uuid().parse(token));
    closeOverlay();
  });

  ipcMain.handle("patch:closeOverlay", (event) => { assertTrustedSender(event); closeOverlay(); });
  ipcMain.handle("settings:getProviders", async (event) => { assertTrustedSender(event); return providers.statuses(); });
  ipcMain.handle("settings:saveProviderKey", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const { provider, apiKey } = z.object({ provider: ProviderIdSchema, apiKey: z.string().min(10).max(1000) }).strict().parse(raw);
    return providers.saveKey(provider, apiKey);
  });
  ipcMain.handle("settings:deleteProviderKey", async (event, raw: unknown) => { assertTrustedSender(event); await providers.deleteKey(ProviderIdSchema.parse(raw)); return providers.statuses(); });
  ipcMain.handle("settings:deleteAllCredentials", async (event) => { assertTrustedSender(event); await providers.deleteAllCredentials(); return providers.statuses(); });
  ipcMain.handle("settings:testProvider", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const input = z.object({ provider: ProviderIdSchema, model: z.string().min(1).max(200).optional() }).strict().parse(raw);
    return providers.test(input.provider, input.model);
  });
  ipcMain.handle("settings:diagnoseProvider", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const input = z.object({ provider: ProviderIdSchema, model: z.string().min(1).max(200).optional() }).strict().parse(raw);
    return providers.diagnose(input.provider, input.model);
  });
  ipcMain.handle("settings:openLogFolder", async (event) => {
    assertTrustedSender(event);
    const result = await shell.openPath(path.join(app.getPath("userData"), "logs"));
    if (result) throw new Error(`Could not open PATCH log folder: ${result}`);
    return true;
  });
  ipcMain.handle("settings:listModels", async (event, raw: unknown) => { assertTrustedSender(event); return providers.listModels(ProviderIdSchema.parse(raw)); });
  ipcMain.handle("settings:setModels", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const input = providerModelsInput.parse(raw);
    await providers.setModels(input.provider, input);
    return providers.status(input.provider);
  });
  ipcMain.handle("settings:openProviderLink", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const input = z.object({ provider: ProviderIdSchema, kind: z.enum(["credential", "setup"]) }).strict().parse(raw);
    const auth = providers.descriptor(input.provider).auth[0];
    if (!auth) throw new Error("Provider has no setup URL.");
    await shell.openExternal(input.kind === "credential" ? auth.credentialUrl : auth.setupUrl);
    return true;
  });
  ipcMain.handle("companion:beginDrag", (event, raw: unknown) => {
    assertTrustedSender(event);
    if (event.sender !== companionWindow?.webContents || !companionWindow) return false;
    const input = z.object({ screenX: z.number(), screenY: z.number() }).strict().parse(raw);
    const { x, y } = companionWindow.getBounds();
    dragOffset = { x: input.screenX - x, y: input.screenY - y };
    return true;
  });
  ipcMain.handle("companion:moveDrag", (event, raw: unknown) => {
    assertTrustedSender(event);
    if (event.sender !== companionWindow?.webContents || !companionWindow || !dragOffset) return false;
    const input = z.object({ screenX: z.number(), screenY: z.number() }).strict().parse(raw);
    const desired = { x: input.screenX - dragOffset.x, y: input.screenY - dragOffset.y };
    const display = screen.getDisplayNearestPoint({ x: input.screenX, y: input.screenY });
    const next = clampCompanionPosition(desired, display.workArea, companionSize);
    moveCompanionTo(next);
    return true;
  });
  ipcMain.handle("companion:cancelDrag", (event) => { assertTrustedSender(event); dragOffset = null; return true; });
  ipcMain.handle("companion:endDrag", (event, raw: unknown) => {
    assertTrustedSender(event);
    if (event.sender !== companionWindow?.webContents || !companionWindow) return false;
    const input = z.object({ vx: z.number(), vy: z.number(), reducedMotion: z.boolean() }).strict().parse(raw);
    dragOffset = null;

    const { x, y } = companionWindow.getBounds();
    const offset = releaseSettleOffset(input.vx, input.vy, input.reducedMotion);
    const display = screen.getDisplayNearestPoint({
      x: x + companionSize.width / 2,
      y: y + companionSize.height / 2
    });
    const settled = clampCompanionPosition({ x: x + offset.x, y: y + offset.y }, display.workArea, companionSize);
    moveCompanionTo(settled);
    persistCompanionPosition();
    setCompanionState("drop");
    setTimeout(() => setCompanionState("idle"), input.reducedMotion ? 120 : 420);
    return true;
  });
  ipcMain.handle("settings:getProviderSelection", (event) => { assertTrustedSender(event); return providers.getSelection(); });
  ipcMain.handle("settings:setProviderSelection", (event, raw: unknown) => { assertTrustedSender(event); providers.setSelection(ProviderSelectionSchema.parse(raw)); return providers.getSelection(); });
  ipcMain.handle("settings:getPrivacy", (event) => {
    assertTrustedSender(event);
    return { deleteScreenshotsAfterRequest: database.getSetting("deleteScreenshotsAfterRequest", true), screenshotHistory: false, promptLogging: false };
  });
  ipcMain.handle("settings:setDeleteScreenshots", (event, raw: unknown) => { assertTrustedSender(event); database.setSetting("deleteScreenshotsAfterRequest", z.boolean().parse(raw)); return true; });
  ipcMain.handle("settings:getAppearance", (event) => { assertTrustedSender(event); return z.enum(["dark", "light"]).catch("dark").parse(database.getSetting("appearance", "dark")); });
  ipcMain.handle("settings:setAppearance", (event, raw: unknown) => { assertTrustedSender(event); const value = z.enum(["dark", "light"]).parse(raw); database.setSetting("appearance", value); return value; });
  ipcMain.handle("settings:getCompanion", (event) => {
    assertTrustedSender(event);
    return { enabled: companionEnabled(), startAtLogin: process.platform === "win32" ? app.getLoginItemSettings().openAtLogin : false };
  });
  ipcMain.handle("settings:setCompanionEnabled", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const enabled = z.boolean().parse(raw);
    database.setSetting("companionEnabled", enabled);
    if (enabled) await createCompanion(); else { companionWindow?.close(); companionWindow = null; }
    return enabled;
  });
  ipcMain.handle("settings:setStartAtLogin", (event, raw: unknown) => {
    assertTrustedSender(event);
    const enabled = z.boolean().parse(raw);
    if (process.platform !== "win32") return false;
    app.setLoginItemSettings({ openAtLogin: enabled });
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle("settings:getPermissions", (event) => {
    assertTrustedSender(event);
    return Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map((name) => [name, database.getPermission(name) ?? DEFAULT_PERMISSIONS[name as keyof typeof DEFAULT_PERMISSIONS]]));
  });
  ipcMain.handle("settings:setPermission", (event, raw: unknown) => {
    assertTrustedSender(event);
    const input = z.object({ capability: permissionName, allowed: z.boolean() }).strict().parse(raw);
    database.setPermission(input.capability, input.allowed);
    return true;
  });
  ipcMain.handle("settings:setShortcut", (event, raw: unknown) => {
    assertTrustedSender(event);
    const accelerator = z.string().min(3).max(100).parse(raw);
    if (!registerShortcut(accelerator)) return { ok: false, message: "That shortcut is already in use by another application." };
    database.setSetting("globalShortcut", accelerator);
    return { ok: true, message: "Shortcut updated." };
  });
  ipcMain.handle("settings:getAdapters", async (event) => {
    assertTrustedSender(event);
    const chromeDirectory = chromeAdapterDirectory();
    const photoshopDirectory = photoshopAdapterDirectory();
    const browserProbe = await browserBridge.probeReadiness();
    const browserStatus = browserProbe.status;
    return {
      windows: { connected: windowsBridge.connected, lastError: windowsBridge.lastError },
      chrome: {
        connected: browserStatus.nativeBridgeConnected,
        ready: browserStatus.nativeBridgeConnected && browserStatus.protocolCompatible && browserStatus.activeTabAvailable && browserStatus.contentReachable && browserStatus.domContextAvailable && browserStatus.mutationCapabilityAvailable && browserProbe.contextVerified,
        pipeName: browserBridge.pipeName,
        filesAvailable: existsSync(path.join(chromeDirectory, "manifest.json")),
        protocolCompatible: browserStatus.protocolCompatible,
        activeTabAvailable: browserStatus.activeTabAvailable,
        contentReachable: browserStatus.contentReachable,
        domContextAvailable: browserStatus.domContextAvailable,
        mutationCapabilityAvailable: browserStatus.mutationCapabilityAvailable,
        contextVerified: browserProbe.contextVerified,
        observedDomNodeCount: browserProbe.observedDomNodeCount,
        failureCode: browserStatus.failureCode ?? null,
        failureMessage: browserStatus.failureMessage ?? null
      },
      photoshop: { connected: photoshopBridge.connected, port: photoshopBridge.port, filesAvailable: existsSync(path.join(photoshopDirectory, "manifest.json")) }
    };
  });
  ipcMain.handle("settings:connectWindowsAdapter", async (event) => {
    assertTrustedSender(event);
    try {
      await windowsBridge.start();
      await windowsBridge.request("ping", {}, 2500);
      await logger.info("adapter.windows.connected", {});
      return { ok: true, message: "Windows UI Automation connected." };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Windows UI Automation could not connect.";
      await logger.warn("adapter.windows.connect_failed", { message });
      return { ok: false, message };
    }
  });
  ipcMain.handle("settings:openChromeExtensionFolder", async (event) => {
    assertTrustedSender(event);
    return openAdapterDirectory(chromeAdapterDirectory(), "manifest.json", "PATCH Chrome extension");
  });
  ipcMain.handle("settings:registerChromeNativeHost", async (event, raw: unknown) => {
    assertTrustedSender(event);
    const input = z.object({
      extensionId: z.string().regex(/^[a-p]{32}$/, "Extension ID must be 32 characters using a-p."),
      browser: z.enum(["Chrome", "Edge"])
    }).strict().parse(raw);
    if (process.platform !== "win32") return { ok: false, message: "Chrome native-host registration is available only on Windows." };
    try {
      const directory = chromeAdapterDirectory();
      const script = path.join(directory, "install-native-host.ps1");
      if (!existsSync(script)) throw new Error("The packaged Chrome native-host installer is missing.");
      const bridgeExe = await windowsBridge.getExecutablePath();
      await execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script,
        "-ExtensionId", input.extensionId, "-BridgeExe", bridgeExe, "-Browser", input.browser
      ], { windowsHide: true, timeout: 15_000 });
      await logger.info("adapter.chrome.native_host_registered", { browser: input.browser });
      return { ok: true, message: `Native messaging host registered for ${input.browser}. Reload the PATCH extension; it will connect automatically.` };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Chrome native-host registration failed.";
      await logger.warn("adapter.chrome.native_host_registration_failed", { browser: input.browser, message });
      return { ok: false, message };
    }
  });
  ipcMain.handle("settings:openPhotoshopPluginFolder", async (event) => {
    assertTrustedSender(event);
    return openAdapterDirectory(photoshopAdapterDirectory(), "manifest.json", "PATCH Photoshop plugin");
  });
  ipcMain.handle("settings:getPhotoshopPairingCode", async (event) => { assertTrustedSender(event); return photoshopBridge.getPairingCode(); });
  ipcMain.handle("settings:rotatePhotoshopPairingCode", async (event) => { assertTrustedSender(event); return photoshopBridge.rotatePairingCode(); });
  ipcMain.handle("settings:listSavedPatches", (event) => { assertTrustedSender(event); return database.listSavedPatches(); });
  ipcMain.handle("settings:deleteSavedPatch", async (event, raw: unknown) => { assertTrustedSender(event); const id = z.string().uuid().parse(raw); if (browserBridge.connected) { try { await browserBridge.request("browser.deleteSavedPatch", { id }); } catch (error: unknown) { await logger.warn("adapter.chrome.saved_patch_delete_failed", { id, message: error instanceof Error ? error.message : "unknown" }); } } database.deleteSavedPatch(id); return true; });
};

app.setAppUserModelId("com.patch.desktop");
const nativeSmokeMode = process.argv.includes("--patch-smoke-native");
const gotSingleInstanceLock = nativeSmokeMode ? true : app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
  if (!app.isReady()) return;
  if (settingsWindow && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); }
  else void openSettings().catch((error: unknown) => logger?.error("patch.settings.open_failed", { message: error instanceof Error ? error.message : "unknown" }));
});
// PATCH is a tray/companion app. Closing visible windows must not terminate the process.
app.on("window-all-closed", () => undefined);
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  // BrowserWindow "closed" handlers may finalize active sessions. Keep SQLite open
  // until every window has closed, then release it at the final quit boundary.
  database?.close();
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  Menu.setApplicationMenu(null);

  if (nativeSmokeMode) {
    const smokePath = path.join(app.getPath("temp"), `patch-native-smoke-${process.pid}.sqlite3`);
    try {
      const smokeDb = new PatchDatabase(smokePath);
      smokeDb.setSetting("nativeSmoke", { ok: true });
      const result = smokeDb.getSetting("nativeSmoke", { ok: false });
      smokeDb.close();
      if (!result.ok) throw new Error("SQLite smoke readback failed.");
      rmSync(smokePath, { force: true });
      rmSync(`${smokePath}-shm`, { force: true });
      rmSync(`${smokePath}-wal`, { force: true });
      console.log("PATCH_NATIVE_SMOKE_OK");
      app.exit(0);
      return;
    } catch (error: unknown) {
      console.error("PATCH_NATIVE_SMOKE_FAILED", error instanceof Error ? error.message : String(error));
      app.exit(17);
      return;
    }
  }

  const userData = app.getPath("userData");
  database = new PatchDatabase(path.join(userData, "patch.sqlite3"));
  vault = new CredentialVault(userData);
  logger = new PatchLogger(path.join(userData, "logs"));
  providers = new ProviderManager(vault, database, (level, event, metadata) => logger.log(level, event, metadata));
  capture = new ScreenCaptureService();
  windowsBridge = new WindowsBridgeClient();
  browserBridge = new BrowserBridgeServer();
  photoshopBridge = new PhotoshopBridgeServer(vault);
  const tools = new ToolRegistry();
  registerRuntimeTools(tools, windowsBridge, browserBridge, photoshopBridge, database);
  orchestrator = new PatchOrchestrator({ providers, capture, windows: windowsBridge, browser: browserBridge, photoshop: photoshopBridge, db: database, logger, tools });

  await browserBridge.start().catch((error: unknown) => logger.warn("adapter.chrome.start_failed", { message: error instanceof Error ? error.message : "unknown" }));
  await photoshopBridge.start().catch((error: unknown) => logger.warn("adapter.photoshop.start_failed", { message: error instanceof Error ? error.message : "unknown" }));
  const preferredShortcut = database.getSetting("globalShortcut", "Ctrl+Shift+Space");
  if (!registerShortcut(preferredShortcut)) {
    await logger.warn("patch.shortcut.registration_failed", { accelerator: preferredShortcut, activeFallback: registeredShortcut });
  }
  registerIpc();
  // Start the Windows bridge once without blocking app readiness. Adapter status polling
  // is read-only and will not repeatedly launch a failing sidecar.
  void windowsBridge.start()
    .then(() => logger.info("adapter.windows.connected", {}))
    .catch((error: unknown) => logger.warn("adapter.windows.start_failed", { message: error instanceof Error ? error.message : "unknown" }));
  createTray();
  await createCompanion().catch((error: unknown) => logger.warn("patch.companion.start_failed", { message: error instanceof Error ? error.message : "unknown" }));
  screen.on("display-added", positionCompanion);
  screen.on("display-removed", positionCompanion);
  screen.on("display-metrics-changed", positionCompanion);
  await logger.info("patch.ready", { version: app.getVersion(), platform: process.platform, companionEnabled: companionEnabled() });
}).catch((error: unknown) => {
  console.error(error);
  app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  capture?.clear();
  windowsBridge?.stop();
  void browserBridge?.close();
  void photoshopBridge?.close();
});
