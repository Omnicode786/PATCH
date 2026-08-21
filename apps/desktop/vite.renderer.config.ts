import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  // Packaged Electron loads renderer/index.html through file://. Relative assets keep
  // JS/CSS resolvable in both dev-server and installed builds.
  base: "./",
  root: path.resolve(import.meta.dirname, "src/renderer"),
  publicDir: path.resolve(import.meta.dirname, "public"),
  plugins: [react(), tailwindcss()],
  build: { outDir: path.resolve(import.meta.dirname, "dist/renderer"), emptyOutDir: true, sourcemap: true },
  server: { host: "127.0.0.1", port: 5173, strictPort: true }
});
