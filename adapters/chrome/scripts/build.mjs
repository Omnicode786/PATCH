import { build } from "vite";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const common = {
  root,
  configFile: false,
  logLevel: "warn",
  build: {
    target: "chrome120",
    outDir: dist,
    minify: false,
    sourcemap: true,
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
};

await build({ ...common, build: { ...common.build, emptyOutDir: true, lib: { entry: path.join(root, "src/service-worker.ts"), formats: ["iife"], name: "PatchServiceWorker", fileName: () => "service-worker.js" } } });
await build({ ...common, build: { ...common.build, emptyOutDir: false, lib: { entry: path.join(root, "src/content.ts"), formats: ["iife"], name: "PatchContent", fileName: () => "content.js" } } });
await mkdir(dist, { recursive: true });
await copyFile(path.join(root, "public/manifest.json"), path.join(dist, "manifest.json"));
await copyFile(path.join(root, "public/native-host.template.json"), path.join(dist, "native-host.template.json"));
await copyFile(path.join(root, "scripts/install-native-host.ps1"), path.join(dist, "install-native-host.ps1"));
