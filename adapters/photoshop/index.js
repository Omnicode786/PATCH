const { app, core, action, constants } = require("photoshop");
const { storage } = require("uxp");
const secureStorage = storage.secureStorage;
const BASE = "http://127.0.0.1:49373";
const TOKEN_KEY = "patch.photoshop.pairingToken.v1";
let token = null;
let clientId = null;
let stopped = false;
const status = document.getElementById("status");
const pairing = document.getElementById("pairing");
const pairButton = document.getElementById("pair");
const forgetButton = document.getElementById("forget");

function textBytes(value) { return new TextEncoder().encode(value); }
function bytesText(value) { return new TextDecoder().decode(value); }
async function readToken() {
  const stored = await secureStorage.getItem(TOKEN_KEY);
  return stored ? bytesText(stored) : null;
}
async function saveToken(value) { await secureStorage.setItem(TOKEN_KEY, textBytes(value)); }
async function removeToken() { try { await secureStorage.removeItem(TOKEN_KEY); } catch { } }
function headers(includeClient = true) {
  const result = { "X-PATCH-Adapter-Token": token, "Content-Type": "application/json" };
  if (includeClient && clientId) result["X-PATCH-Client-Id"] = clientId;
  return result;
}
async function pair() {
  if (!token) throw new Error("Enter the pairing code shown in PATCH Settings → Adapters.");
  const response = await fetch(`${BASE}/v1/pair`, { method: "POST", headers: headers(false), body: "{}" });
  const body = await response.json();
  if (!response.ok || !body.ok || !body.clientId) throw new Error("Pairing was rejected by PATCH Desktop.");
  clientId = body.clientId;
  status.textContent = "Connected";
  await saveToken(token);
}
function layerId(nativeId) { return `ps-layer-${nativeId}`; }
function numeric(value) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && typeof value._value === "number") return value._value;
  return 0;
}
function serializeBounds(bounds) {
  if (!bounds) return null;
  return { x: numeric(bounds.left), y: numeric(bounds.top), width: Math.max(0, numeric(bounds.right) - numeric(bounds.left)), height: Math.max(0, numeric(bounds.bottom) - numeric(bounds.top)) };
}
function layerLocked(layer) {
  try { return Boolean(layer.locked || layer.allLocked || layer.positionLocked || layer.pixelsLocked); } catch { return false; }
}
function serializeLayer(layer) {
  const children = [];
  try { for (const child of layer.layers || []) children.push(serializeLayer(child)); } catch { }
  let bounds = null;
  try { bounds = serializeBounds(layer.bounds); } catch { }
  return { id: layerId(layer.id), nativeId: layer.id, name: String(layer.name || ""), kind: String(layer.kind || "unknown"), opacity: Number(layer.opacity ?? 100), visible: Boolean(layer.visible), locked: layerLocked(layer), bounds, children };
}
function documentContext() {
  const document = app.activeDocument;
  if (!document) throw new Error("No active Photoshop document.");
  const layers = [];
  for (const layer of document.layers) layers.push(serializeLayer(layer));
  const active = document.activeLayers && document.activeLayers[0] ? layerId(document.activeLayers[0].id) : null;
  return { documentId: document.id, documentName: document.title || document.name || "Untitled", width: numeric(document.width), height: numeric(document.height), activeLayerId: active, layers };
}
function findLayerByNativeId(layers, nativeId) {
  for (const layer of layers) {
    if (layer.id === nativeId) return layer;
    let nested = null;
    try { nested = findLayerByNativeId(layer.layers || [], nativeId); } catch { nested = null; }
    if (nested) return nested;
  }
  return null;
}
function targetNativeId(params) {
  const targetId = params && typeof params.targetId === "string" ? params.targetId : "";
  const match = /^ps-layer-(\d+)$/.exec(targetId);
  if (!match) throw new Error("Invalid Photoshop target ID.");
  return Number(match[1]);
}
function targetLayer(params) {
  const doc = app.activeDocument;
  if (!doc) throw new Error("No active Photoshop document.");
  const nativeId = targetNativeId(params);
  const layer = findLayerByNativeId(doc.layers, nativeId);
  if (!layer) throw new Error(`Photoshop layer ${nativeId} no longer exists.`);
  return layer;
}
async function selectLayer(layer) {
  await action.batchPlay([{ _obj: "select", _target: [{ _ref: "layer", _id: layer.id }], makeVisible: false, _options: { dialogOptions: "dontDisplay" } }], {});
  const selected = app.activeDocument.activeLayers || [];
  return selected.some((candidate) => candidate.id === layer.id);
}
async function mutate(name, callback) {
  return core.executeAsModal(callback, { commandName: `PATCH: ${name}` });
}
async function dispatch(method, params) {
  if (method === "photoshop.getDocument") return documentContext();
  if (method === "photoshop.selectLayer") {
    const layer = targetLayer(params);
    const verified = await mutate("Select layer", async () => selectLayer(layer));
    return { targetId: layerId(layer.id), verified };
  }
  if (method === "photoshop.duplicateLayer") {
    const source = targetLayer(params);
    const sourceId = source.id;
    const duplicate = await mutate("Duplicate layer", async () => source.duplicate());
    const context = documentContext();
    const duplicateId = duplicate && typeof duplicate.id === "number" ? duplicate.id : null;
    const exists = duplicateId !== null && findLayerByNativeId(app.activeDocument.layers, duplicateId) !== null;
    return { sourceId: layerId(sourceId), duplicateId: duplicateId === null ? null : layerId(duplicateId), verified: exists, context };
  }
  if (method === "photoshop.moveLayer") {
    const layer = targetLayer(params); const dx = Number(params.deltaX); const dy = Number(params.deltaY);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("Layer movement requires finite deltaX and deltaY.");
    const before = serializeBounds(layer.bounds);
    await mutate("Move layer", async () => layer.translate(dx, dy));
    const after = serializeBounds(layer.bounds);
    const verified = Boolean(before && after && Math.abs((after.x - before.x) - dx) < 1.5 && Math.abs((after.y - before.y) - dy) < 1.5);
    return { targetId: layerId(layer.id), before, after, verified };
  }
  if (method === "photoshop.resizeLayer") {
    const layer = targetLayer(params); const widthPercent = Number(params.widthPercent); const heightPercent = Number(params.heightPercent);
    if (!(widthPercent > 0) || !(heightPercent > 0)) throw new Error("Layer scale percentages must be positive.");
    const before = serializeBounds(layer.bounds);
    await mutate("Resize layer", async () => layer.scale(widthPercent, heightPercent));
    const after = serializeBounds(layer.bounds);
    const expectedWidth = before ? before.width * widthPercent / 100 : null;
    const expectedHeight = before ? before.height * heightPercent / 100 : null;
    const verified = Boolean(after && expectedWidth !== null && expectedHeight !== null && Math.abs(after.width - expectedWidth) < 2 && Math.abs(after.height - expectedHeight) < 2);
    return { targetId: layerId(layer.id), before, after, verified };
  }
  if (method === "photoshop.setOpacity") {
    const layer = targetLayer(params); const opacity = Number(params.opacity);
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 100) throw new Error("Opacity must be between 0 and 100.");
    await mutate("Set opacity", async () => { layer.opacity = opacity; });
    return { targetId: layerId(layer.id), opacity: Number(layer.opacity), verified: Math.abs(Number(layer.opacity) - opacity) < 0.01 };
  }
  if (method === "photoshop.setBlendMode") {
    const layer = targetLayer(params); const requested = String(params.blendMode || "").replace(/[ -]/g, "_").toUpperCase();
    const mode = constants.BlendMode[requested];
    if (!mode) throw new Error(`Unsupported Photoshop blend mode: ${requested}`);
    await mutate("Set blend mode", async () => { layer.blendMode = mode; });
    return { targetId: layerId(layer.id), blendMode: String(layer.blendMode), verified: layer.blendMode === mode };
  }
  throw new Error(`Unsupported Photoshop method: ${method}`);
}
async function sendResult(requestId, ok, result, error) {
  const response = await fetch(`${BASE}/v1/result`, { method: "POST", headers: headers(true), body: JSON.stringify(ok ? { requestId, ok: true, result } : { requestId, ok: false, error }) });
  if (!response.ok) throw new Error("PATCH Desktop rejected the adapter result.");
}
async function loop() {
  while (!stopped && token) {
    if (!clientId) {
      status.textContent = "Reconnecting to PATCH Desktop…";
      try { await pair(); }
      catch { await new Promise((resolve) => setTimeout(resolve, 1500)); continue; }
    }
    try {
      const response = await fetch(`${BASE}/v1/next`, { method: "GET", headers: headers(true) });
      if (response.status === 401) {
        clientId = null;
        status.textContent = "Pairing expired — reconnecting";
        continue;
      }
      const body = await response.json();
      const command = body.command;
      if (!command) continue;
      try { await sendResult(command.requestId, true, await dispatch(command.method, command.params || {})); }
      catch (error) { await sendResult(command.requestId, false, null, error instanceof Error ? error.message : "Photoshop operation failed."); }
    } catch {
      clientId = null;
      status.textContent = "Desktop unavailable — reconnecting";
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}
pairButton.addEventListener("click", async () => {
  token = pairing.value.trim();
  try { await pair(); pairing.value = ""; stopped = false; void loop(); } catch (error) { status.textContent = error instanceof Error ? error.message : "Pairing failed"; }
});
forgetButton.addEventListener("click", async () => { stopped = true; token = null; clientId = null; await removeToken(); status.textContent = "Pairing forgotten"; });
void (async () => {
  token = await readToken();
  if (!token) return;
  stopped = false;
  clientId = null;
  void loop();
})();
