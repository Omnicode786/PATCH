import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    target: "node22",
    outDir: "dist/preload",
    emptyOutDir: true,
    sourcemap: true,
    lib: { entry: path.resolve(import.meta.dirname, "src/preload/index.ts"), formats: ["cjs"], fileName: () => "index.cjs" },
    rollupOptions: { external: ["electron"] }
  }
});
