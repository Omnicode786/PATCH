import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePackageBin, resolvePnpmNodeInvocation } from "./package-tools.mjs";

const temporary = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "patch package tools "));
  temporary.push(directory);
  return directory;
}

describe("Windows-safe packaging command resolution", () => {
  it("uses the active pnpm JavaScript entry even when its path contains spaces", () => {
    const root = tempDir();
    const pnpmEntry = path.join(root, "pnpm install", "pnpm.cjs");
    mkdirSync(path.dirname(pnpmEntry), { recursive: true });
    writeFileSync(pnpmEntry, "", "utf8");
    expect(resolvePnpmNodeInvocation({ npmExecPath: pnpmEntry, execPath: "C:/Program Files/nodejs/node.exe" })).toEqual({
      command: "C:/Program Files/nodejs/node.exe",
      prefixArgs: [pnpmEntry]
    });
  });

  it("resolves pnpm JavaScript beside a Windows command shim", () => {
    const root = tempDir();
    const shim = path.join(root, "pnpm.cmd");
    const pnpmEntry = path.join(root, "node_modules", "pnpm", "bin", "pnpm.cjs");
    mkdirSync(path.dirname(pnpmEntry), { recursive: true });
    writeFileSync(shim, "", "utf8");
    writeFileSync(pnpmEntry, "", "utf8");
    expect(resolvePnpmNodeInvocation({ npmExecPath: shim, execPath: "node.exe" }).prefixArgs).toEqual([pnpmEntry]);
  });

  it("fails with an actionable message when pnpm cannot be resolved", () => {
    expect(() => resolvePnpmNodeInvocation({ npmExecPath: undefined, execPath: "node.exe" })).toThrow(/pnpm package:win/i);
  });

  it("resolves the real package CLI without invoking a .cmd shim", () => {
    const root = tempDir();
    const packageRoot = path.join(root, "node_modules", "fixture-builder");
    mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
    writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "fixture-builder",
      main: "index.js",
      bin: { "fixture-builder": "bin/cli.js" }
    }), "utf8");
    writeFileSync(path.join(packageRoot, "index.js"), "module.exports = {};", "utf8");
    writeFileSync(path.join(packageRoot, "bin", "cli.js"), "", "utf8");
    expect(resolvePackageBin("fixture-builder", "fixture-builder", root)).toBe(path.join(packageRoot, "bin", "cli.js"));
  });
});
