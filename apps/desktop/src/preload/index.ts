import { contextBridge, ipcRenderer } from "electron";

const api = {
  getBootstrap: () => ipcRenderer.invoke("patch:getBootstrap"),
  openOverlay: () => ipcRenderer.invoke("patch:openOverlay"),
  openSettings: () => ipcRenderer.invoke("patch:openSettings"),
  setContextMode: (mode: "app" | "screen") => ipcRenderer.invoke("patch:setContextMode", mode),
  submit: (input: unknown) => ipcRenderer.invoke("patch:submit", input),
  confirm: (token: string) => ipcRenderer.invoke("patch:confirm", token),
  cancel: (token: string) => ipcRenderer.invoke("patch:cancel", token),
  closeOverlay: () => ipcRenderer.invoke("patch:closeOverlay"),
  companion: {
    beginDrag: (input: unknown) => ipcRenderer.invoke("companion:beginDrag", input),
    moveDrag: (input: unknown) => ipcRenderer.invoke("companion:moveDrag", input),
    endDrag: (input: unknown) => ipcRenderer.invoke("companion:endDrag", input),
    cancelDrag: () => ipcRenderer.invoke("companion:cancelDrag"),
    onState: (listener: (state: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: string) => listener(state);
      ipcRenderer.on("companion:state", handler);
      return () => ipcRenderer.removeListener("companion:state", handler);
    }
  },
  settings: {
    getProviders: () => ipcRenderer.invoke("settings:getProviders"),
    saveProviderKey: (provider: string, apiKey: string) => ipcRenderer.invoke("settings:saveProviderKey", { provider, apiKey }),
    deleteProviderKey: (provider: string) => ipcRenderer.invoke("settings:deleteProviderKey", provider),
    deleteAllCredentials: () => ipcRenderer.invoke("settings:deleteAllCredentials"),
    testProvider: (provider: string, model?: string) => ipcRenderer.invoke("settings:testProvider", { provider, model }),
    diagnoseProvider: (provider: string, model?: string) => ipcRenderer.invoke("settings:diagnoseProvider", { provider, model }),
    openLogFolder: () => ipcRenderer.invoke("settings:openLogFolder"),
    listModels: (provider: string) => ipcRenderer.invoke("settings:listModels", provider),
    setModels: (input: unknown) => ipcRenderer.invoke("settings:setModels", input),
    openProviderLink: (provider: string, kind: "credential" | "setup") => ipcRenderer.invoke("settings:openProviderLink", { provider, kind }),
    getProviderSelection: () => ipcRenderer.invoke("settings:getProviderSelection"),
    setProviderSelection: (selection: unknown) => ipcRenderer.invoke("settings:setProviderSelection", selection),
    getPrivacy: () => ipcRenderer.invoke("settings:getPrivacy"),
    setDeleteScreenshots: (enabled: boolean) => ipcRenderer.invoke("settings:setDeleteScreenshots", enabled),
    getAppearance: () => ipcRenderer.invoke("settings:getAppearance"),
    setAppearance: (value: "dark" | "light") => ipcRenderer.invoke("settings:setAppearance", value),
    getCompanion: () => ipcRenderer.invoke("settings:getCompanion"),
    setCompanionEnabled: (enabled: boolean) => ipcRenderer.invoke("settings:setCompanionEnabled", enabled),
    setStartAtLogin: (enabled: boolean) => ipcRenderer.invoke("settings:setStartAtLogin", enabled),
    getPermissions: () => ipcRenderer.invoke("settings:getPermissions"),
    setPermission: (capability: string, allowed: boolean) => ipcRenderer.invoke("settings:setPermission", { capability, allowed }),
    setShortcut: (accelerator: string) => ipcRenderer.invoke("settings:setShortcut", accelerator),
    getAdapters: () => ipcRenderer.invoke("settings:getAdapters"),
    connectWindowsAdapter: () => ipcRenderer.invoke("settings:connectWindowsAdapter"),
    openChromeExtensionFolder: () => ipcRenderer.invoke("settings:openChromeExtensionFolder"),
    registerChromeNativeHost: (extensionId: string, browser: "Chrome" | "Edge") => ipcRenderer.invoke("settings:registerChromeNativeHost", { extensionId, browser }),
    openPhotoshopPluginFolder: () => ipcRenderer.invoke("settings:openPhotoshopPluginFolder"),
    getPhotoshopPairingCode: () => ipcRenderer.invoke("settings:getPhotoshopPairingCode"),
    rotatePhotoshopPairingCode: () => ipcRenderer.invoke("settings:rotatePhotoshopPairingCode"),
    listSavedPatches: () => ipcRenderer.invoke("settings:listSavedPatches"),
    deleteSavedPatch: (id: string) => ipcRenderer.invoke("settings:deleteSavedPatch", id)
  }
};

contextBridge.exposeInMainWorld("patch", Object.freeze(api));
