import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(cwd, "../..");

// Vite is a direct dependency of @patch/desktop, so execute its JavaScript CLI
// using the current Node executable instead of spawning vite.cmd on Windows.
const viteCli = path.join(cwd, "node_modules", "vite", "bin", "vite.js");
const electronPath = require("electron");

const run = (command, args, env = process.env, workingDirectory = cwd) =>
  spawn(command, args, {
    cwd: workingDirectory,
    env,
    stdio: "inherit",
    windowsHide: false
  });

const runChecked = (command, args, workingDirectory = cwd) =>
  new Promise((resolve, reject) => {
    const child = run(command, args, process.env, workingDirectory);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });

const runVite = (args) => run(process.execPath, [viteCli, ...args]);

const waitPort = (port) =>
  new Promise((resolve) => {
    const probe = () => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        setTimeout(probe, 120);
      });
    };
    probe();
  });

async function publishWindowsBridgeForDevelopment() {
  if (process.platform !== "win32") return;
  const bridgeProject = path.join(repo, "apps", "windows-bridge", "Patch.WindowsBridge.csproj");
  process.stdout.write("\n==> Publishing self-contained Windows UI Automation bridge for development\n");
  try {
    await runChecked("dotnet", [
      "publish",
      bridgeProject,
      "-c", "Debug",
      "-r", "win-x64",
      "--self-contained", "true",
      "/p:PublishSingleFile=true",
      "/p:DebugType=None",
      "/p:DebugSymbols=false"
    ], repo);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `PATCH could not publish its self-contained Windows bridge (${detail}). ` +
      "Install the .NET 8 SDK (x64) or run INSTALL_PATCH.ps1, then start development again."
    );
  }
}

// Build the sidecar before Electron can try to connect to it. A self-contained
// publish bundles the required .NET runtime, so merely having .NET 10 (or only
// an x86 .NET 8 runtime) cannot break the adapter at launch.
await publishWindowsBridgeForDevelopment();

// Start renderer development server.
const renderer = runVite(["--config", "vite.renderer.config.ts"]);

try {
  // Build Electron main + preload before launching Electron.
  await Promise.all([
    runChecked(process.execPath, [viteCli, "build", "--config", "vite.main.config.ts"]),
    runChecked(process.execPath, [viteCli, "build", "--config", "vite.preload.config.ts"]),
    waitPort(5173)
  ]);
} catch (error) {
  if (!renderer.killed) renderer.kill();
  throw error;
}

const electron = run(
  electronPath,
  ["."],
  {
    ...process.env,
    PATCH_DEV_SERVER_URL: "http://127.0.0.1:5173"
  }
);

const stop = () => {
  if (!renderer.killed) renderer.kill();
  if (!electron.killed) electron.kill();
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

electron.once("error", (error) => {
  console.error("Failed to launch Electron:", error);
  stop();
  process.exit(1);
});

electron.once("exit", (code) => {
  if (!renderer.killed) renderer.kill();
  process.exit(code ?? 0);
});
