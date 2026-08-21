export type NativePort = Readonly<{
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}>;

export type ChromeApi = Readonly<{
  runtime: {
    connectNative(name: string): NativePort;
    onMessage: { addListener(listener: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void): void };
    lastError?: { message?: string };
    sendMessage(message: unknown, callback: (response: unknown) => void): void;
    getManifest(): Readonly<{ version: string }>;
  };
  tabs: {
    query(queryInfo: Readonly<{ active: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean }>, callback: (tabs: ReadonlyArray<{ id?: number; url?: string }>) => void): void;
    sendMessage(tabId: number, message: unknown, callback: (response: unknown) => void): void;
  };
  scripting: {
    executeScript(options: Readonly<{ target: Readonly<{ tabId: number }>; files: readonly string[] }>, callback: (results?: unknown[]) => void): void;
  };
  storage: {
    local: {
      get(keys: string | string[] | null, callback: (items: Readonly<Record<string, unknown>>) => void): void;
      set(items: Readonly<Record<string, unknown>>, callback?: () => void): void;
    };
  };
}>;

declare global { const chrome: ChromeApi; }
export {};
