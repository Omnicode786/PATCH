import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const violations = [];
const excluded = new Set(["node_modules", "dist", "out", "coverage", ".git"]);
const lintFile = fileURLToPath(import.meta.url);

const rules = [
  { name: "unfinished marker", pattern: /\b(TODO|FIXME|HACK)\b/ },
  { name: "explicit TypeScript any", pattern: /:\s*any\b|<any>|\bas any\b/ },
  { name: "unsafe Electron nodeIntegration", pattern: /nodeIntegration\s*:\s*true/ },
  { name: "unsafe Electron contextIsolation", pattern: /contextIsolation\s*:\s*false/ },
  { name: "arbitrary body replacement", pattern: /document\.body\.innerHTML\s*=/ },
  { name: "arbitrary shell planner tool", pattern: /execute_shell_command|execute_arbitrary_javascript/ },
  {
    name: "provider key in localStorage",
    pattern: /localStorage\.(setItem|getItem)\([^\n]*(api.?key|provider.?key)/i
  }
];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;

    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await walk(full);
    } else if (
      full !== lintFile &&
      /\.(ts|tsx|js|mjs|cjs|cs)$/.test(entry.name)
    ) {
      const text = await readFile(full, "utf8");

      for (const rule of rules) {
        if (rule.pattern.test(text)) {
          violations.push(
            `${path.relative(root, full)}: ${rule.name}`
          );
        }
      }
    }
  }
}

await walk(root);

if (violations.length) {
  console.error(
    "PATCH lint failed:\n" +
      violations.map((v) => `- ${v}`).join("\n")
  );
  process.exit(1);
}

console.log("PATCH lint passed.");