import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePackageBin, resolvePnpmNodeInvocation } from "./package-tools.mjs";

if (process.platform !== "win32") {
  throw new Error("Windows packaging must run on Windows because the UI Automation sidecar targets Windows Desktop.");
}

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(appDir, "../..");
const bridge = path.join(repo, "apps", "windows-bridge");
const bridgeProject = path.join(bridge, "Patch.WindowsBridge.csproj");
const published = path.join(bridge, "bin", "Release", "net8.0-windows", "win-x64", "publish");
const resources = path.join(appDir, "resources", "windows-bridge");
const releaseDir = path.join(repo, "release");

const stage = (name, operation) => {
  process.stdout.write(`\n==> ${name}\n`);
  try { return operation(); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`PATCH Windows packaging failed during ${name}: ${detail}`, { cause: error });
  }
};

stage("clean previous packaging output", () => {
  rmSync(resources, { recursive: true, force: true });
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(resources, { recursive: true });
});

stage("publish self-contained Windows UI Automation bridge", () => {
  execFileSync("dotnet", [
    "publish", bridgeProject, "-c", "Release", "-r", "win-x64", "--self-contained", "true",
    "/p:PublishSingleFile=true", "/p:DebugType=None", "/p:DebugSymbols=false"
  ], { cwd: repo, stdio: "inherit", windowsHide: true });
  if (!existsSync(published)) throw new Error(`Bridge publish directory was not created: ${published}`);
  cpSync(published, resources, { recursive: true });
});

stage("build complete PATCH monorepo", () => {
  const pnpm = resolvePnpmNodeInvocation();
  execFileSync(pnpm.command, [...pnpm.prefixArgs, "build"], { cwd: repo, stdio: "inherit", windowsHide: true });
});

stage("verify current agentic browser runtime is built", () => {
  const desktopMain = path.join(appDir, "dist", "main", "index.js");
  const chromeDir = path.join(repo, "adapters", "chrome", "dist");
  const serviceWorker = path.join(chromeDir, "service-worker.js");
  const content = path.join(chromeDir, "content.js");
  for (const file of [desktopMain, serviceWorker, content]) if (!existsSync(file)) throw new Error(`Required built runtime artifact is missing: ${file}`);
  const desktopText = readFileSync(desktopMain, "utf8");
  const serviceWorkerText = readFileSync(serviceWorker, "utf8");
  const contentText = readFileSync(content, "utf8");
  for (const needle of ["PLANNER_DID_NOT_RETURN_ACTION", "browser.applyPatch", "patch.invocation.capabilities", "setFocusable(false)", "probeReadiness"]) {
    if (!desktopText.includes(needle)) throw new Error(`Desktop bundle is stale: missing ${needle}`);
  }
  for (const needle of ["browser.getStatus", "lastFocusedWindow", "content.js"]) {
    if (!serviceWorkerText.includes(needle)) throw new Error(`Chrome service-worker bundle is stale: missing ${needle}`);
  }
  for (const needle of ["browser.verifyPatch", "reconcilePatch"]) {
    if (!contentText.includes(needle)) throw new Error(`Chrome content bundle is stale: missing ${needle}`);
  }
});

stage("verify packaged renderer asset paths", () => {
  const rendererEntry = path.join(appDir, "dist", "renderer", "index.html");
  if (!existsSync(rendererEntry)) throw new Error(`Renderer entry was not built: ${rendererEntry}`);
  const html = readFileSync(rendererEntry, "utf8");
  if (/(?:src|href)=["']\/assets\//i.test(html)) {
    throw new Error("Renderer contains root-absolute /assets URLs that break when Electron loads index.html through file://. Keep Vite base set to ./.");
  }
});

stage("build Electron NSIS installer", () => {
  const builderCli = resolvePackageBin("electron-builder", "electron-builder", appDir);
  const args = [builderCli, "--win", "nsis", "--x64"];
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(process.execPath, args, {
      cwd: appDir,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status === 0) return;

    const combined = `${result.stdout ?? ""}
${result.stderr ?? ""}`;
    const fileLock = /\bEBUSY\b|resource busy or locked/i.test(combined);
    if (!fileLock || attempt === maxAttempts) {
      throw new Error(`Electron Builder exited with code ${result.status ?? "unknown"}.`);
    }

    const delayMs = 1200 * attempt;
    process.stderr.write(`[WARN] Electron Builder hit a transient Windows file lock (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs} ms.\n`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
  }
});

stage("smoke-test packaged native SQLite runtime", () => {
  const unpackedExe = path.join(releaseDir, "win-unpacked", "PATCH.exe");
  if (!existsSync(unpackedExe)) throw new Error(`Electron Builder did not create the unpacked executable: ${unpackedExe}`);
  execFileSync(unpackedExe, ["--patch-smoke-native"], { cwd: path.dirname(unpackedExe), stdio: "inherit", windowsHide: true, timeout: 30_000 });
});

stage("verify NSIS artifact", () => {
  if (!existsSync(releaseDir)) throw new Error("release/ was not created.");
  const installers = readdirSync(releaseDir).filter((name) => /^PATCH-.*-x64\.exe$/i.test(name));
  if (!installers.length) throw new Error("Electron Builder completed but no PATCH-<version>-x64.exe was found in release/.");
  process.stdout.write(`Installer: ${path.join(releaseDir, installers.sort().at(-1))}\n`);
});
