import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

export function resolvePnpmNodeInvocation(options = {}) {
  const hasExplicitNpmExecPath = Object.prototype.hasOwnProperty.call(options, "npmExecPath");
  const npmExecPath = hasExplicitNpmExecPath ? options.npmExecPath ?? "" : process.env.npm_execpath ?? "";
  const execPath = Object.prototype.hasOwnProperty.call(options, "execPath") && options.execPath ? options.execPath : process.execPath;
  const candidates = [];
  if (npmExecPath) {
    candidates.push(npmExecPath);
    if (/\.(?:cmd|bat|exe)$/i.test(npmExecPath)) {
      const shimDir = path.dirname(npmExecPath);
      candidates.push(
        path.join(shimDir, "node_modules", "pnpm", "bin", "pnpm.cjs"),
        path.join(shimDir, "node_modules", "pnpm", "bin", "pnpm.js")
      );
    }
  }
  const entry = candidates.find((candidate) => /\.(?:cjs|mjs|js)$/i.test(candidate) && existsSync(candidate));
  if (!entry) {
    throw new Error(
      "PATCH packaging could not resolve pnpm's JavaScript entry point. Run packaging through pnpm (pnpm package:win) so npm_execpath points to the active pnpm installation."
    );
  }
  return { command: execPath, prefixArgs: [entry] };
}

function findPackageJson(requireFromBase, packageName) {
  try {
    return requireFromBase.resolve(`${packageName}/package.json`);
  } catch {
    // Some packages hide package.json behind package exports. Resolve the actual
    // package entry and walk upward until we find the matching package metadata.
    const resolvedEntry = requireFromBase.resolve(packageName);
    let directory = path.dirname(resolvedEntry);
    while (true) {
      const candidate = path.join(directory, "package.json");
      if (existsSync(candidate)) {
        try {
          const metadata = JSON.parse(readFileSync(candidate, "utf8"));
          if (metadata?.name === packageName) return candidate;
        } catch {
          // Keep walking; malformed unrelated metadata is not the package root.
        }
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error(`PATCH packaging resolved ${packageName}, but could not locate its package.json metadata.`);
  }
}

export function resolvePackageBin(packageName, binName, baseDir) {
  const requireFromBase = createRequire(path.join(baseDir, "package-resolution.cjs"));
  const packageJsonPath = findPackageJson(requireFromBase, packageName);
  const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const bin = metadata.bin;
  const relative = typeof bin === "string" ? bin : bin?.[binName];
  if (typeof relative !== "string" || !relative) {
    throw new Error(`${packageName} does not expose the expected ${binName} CLI.`);
  }
  const entry = path.resolve(path.dirname(packageJsonPath), relative);
  if (!existsSync(entry)) throw new Error(`Resolved ${packageName} CLI does not exist: ${entry}`);
  return entry;
}

export function runNodeCli(entry, args, options = {}) {
  return execFileSync(process.execPath, [entry, ...args], { stdio: "inherit", ...options });
}
