/**
 * Prepare everything `tauri build` needs:
 *   1. A static dashboard export in dashboard/out (tauri.conf.json distDir).
 *   2. The Node API compiled to a single executable at
 *      src-tauri/binaries/agent-builder-api-<target-triple><ext>, which is the
 *      exact filename Tauri's externalBin/sidecar mechanism looks for.
 *
 * Without step 2 the packaged app has no backend at all — the window opens on
 * a dashboard whose every API call fails.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = path.join(root, "src-tauri", "binaries");

const run = (command, args, cwd = root, extraEnv = {}) => {
  console.log(`> ${command} ${args.join(" ")}`);
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv }
  });
};

/** Tauri names sidecars by Rust target triple; ask rustc rather than guessing. */
const targetTriple = () => {
  const output = execFileSync("rustc", ["-vV"], { encoding: "utf8", shell: process.platform === "win32" });
  const match = output.match(/^host:\s*(\S+)$/m);
  if (!match) {
    throw new Error("Could not read host target triple from `rustc -vV`.");
  }
  return match[1];
};

/** pkg target for the current platform (it cross-compiles, but default to host). */
const pkgTarget = () => {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const platform =
    process.platform === "win32" ? "win" : process.platform === "darwin" ? "macos" : "linux";
  return `node22-${platform}-${arch}`;
};

console.log("\n=== 1/3 Building the API bundle ===");
run("npm", ["run", "build:server"]);

console.log("\n=== 2/3 Building the static dashboard export ===");
run("npm", ["run", "build"], path.join(root, "dashboard"), { NEXT_OUTPUT: "export" });

console.log("\n=== 3/3 Packaging the API as a Tauri sidecar ===");

// pkg cannot embed native .node addons into a single-file executable — it
// resolves them from a snapshot path that does not exist at runtime. Verified
// empirically: the produced binary starts and immediately dies with
// "bcrypt_lib.node was not included into executable at compilation stage".
// bcrypt has been replaced with pure-JS bcryptjs; better-sqlite3 (used by the
// user/refresh-token/audit/license models) is the remaining blocker and needs
// migrating to node:sqlite before this step yields a working binary.
const NATIVE_BLOCKERS = ["better-sqlite3"];
const stillNative = NATIVE_BLOCKERS.filter((dep) =>
  fs.existsSync(path.join(root, "node_modules", dep))
);

if (stillNative.length > 0 && !process.env.FORCE_SIDECAR) {
  console.error(
    `\nRefusing to build the sidecar: ${stillNative.join(", ")} ${stillNative.length === 1 ? "is a native addon" : "are native addons"} ` +
      "that pkg cannot embed, so the resulting executable would start and immediately crash.\n" +
      "The dashboard static export (dashboard/out) is ready and tauri.conf.json is wired for the\n" +
      "sidecar; what remains is moving the SQLite models off better-sqlite3 (node:sqlite is a close\n" +
      "API match and ships with Node 22+).\n" +
      "Set FORCE_SIDECAR=1 to build anyway and inspect the failure yourself."
  );
  process.exit(1);
}

fs.mkdirSync(binariesDir, { recursive: true });

const triple = targetTriple();
const ext = process.platform === "win32" ? ".exe" : "";
const outputPath = path.join(binariesDir, `agent-builder-api-${triple}${ext}`);

run("npx", [
  "pkg",
  path.join(root, "dist", "bundle", "server.js"),
  "--targets",
  pkgTarget(),
  "--output",
  outputPath
]);

if (!fs.existsSync(outputPath)) {
  throw new Error(`Expected sidecar at ${outputPath}, but pkg produced nothing.`);
}

console.log(`\nSidecar ready: ${outputPath}`);
console.log("Static dashboard: dashboard/out");
console.log("Now run: npm run tauri:build");
