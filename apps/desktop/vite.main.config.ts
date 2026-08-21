import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    ssr: path.resolve(import.meta.dirname, "src/main/index.ts"),
    target: "node22",
    outDir: "dist/main",
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: [
        "electron",
        "better-sqlite3"
      ]
    }
  },

  ssr: {
    target: "node",
    external: [
      "electron",
      "better-sqlite3"
    ]
  }
});