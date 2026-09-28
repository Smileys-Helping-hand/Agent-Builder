import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "..");
const distDir = path.join(root, "dist");
const bundleDir = path.join(distDir, "app");
const installerDir = path.join(distDir, "installers");

if (!fs.existsSync(bundleDir)) {
  throw new Error("Bundle missing. Run npm run bundle first.");
}

fs.mkdirSync(installerDir, { recursive: true });

const debDir = path.join(distDir, "deb");
const debContent = path.join(debDir, "usr", "share", "agent-builder");

if (fs.existsSync(debDir)) {
  fs.rmSync(debDir, { recursive: true, force: true });
}

fs.mkdirSync(debContent, { recursive: true });
fs.cpSync(bundleDir, debContent, { recursive: true });

const controlFile = `Package: agent-builder\nVersion: 1.0.0\nSection: utils\nPriority: optional\nArchitecture: amd64\nDepends: nodejs\nMaintainer: Hustle Studio <support@hustlestudio.ai>\nDescription: Agent Builder autonomous creation platform\n`;

const controlPath = path.join(debDir, "DEBIAN");
fs.mkdirSync(controlPath, { recursive: true });
fs.writeFileSync(path.join(controlPath, "control"), controlFile);

const debOutput = path.join(installerDir, "agent-builder.deb");
if (fs.existsSync(debOutput)) {
  fs.rmSync(debOutput, { force: true });
}

const debResult = spawnSync("dpkg-deb", ["--build", debDir, debOutput], { stdio: "inherit" });
if (debResult.error) {
  console.error("dpkg-deb failed", debResult.error);
  process.exit(debResult.status ?? 1);
}
if (debResult.status !== 0) {
  process.exit(debResult.status ?? 1);
}

const appImageDir = path.join(distDir, "AppImage");
if (fs.existsSync(appImageDir)) {
  fs.rmSync(appImageDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(appImageDir, "usr", "bin"), { recursive: true });
fs.cpSync(bundleDir, path.join(appImageDir, "usr", "share", "agent-builder"), { recursive: true });

const desktopFile = `[Desktop Entry]\nName=Agent Builder\nExec=agent-builder\nIcon=agent-builder\nType=Application\nCategories=Utility;Development;\n`;
const desktopPath = path.join(appImageDir, "agent-builder.desktop");
fs.writeFileSync(desktopPath, desktopFile);

const runnerPath = path.join(appImageDir, "usr", "bin", "agent-builder");
fs.writeFileSync(runnerPath, "#!/bin/bash\nDIR=\"$(cd \"$(dirname \"$0\")/../share/agent-builder\" && pwd)\"\nnode \"$DIR/server/index.js\"\n", {
  mode: 0o755
});

const appImageOutput = path.join(installerDir, "AgentBuilder.AppImage");
if (fs.existsSync(appImageOutput)) {
  fs.rmSync(appImageOutput, { force: true });
}

const appImageTool = spawnSync("which", ["appimagetool"], { encoding: "utf8" });
const toolPath = appImageTool.status === 0 ? appImageTool.stdout.trim() : null;

if (!toolPath) {
  console.warn("appimagetool not found. Skipping AppImage build. Install appimagetool to produce the AppImage artifact.");
} else {
  const result = spawnSync(toolPath, [appImageDir, appImageOutput], { stdio: "inherit" });
  if (result.error) {
    console.error("appimagetool failed", result.error);
    process.exit(result.status ?? 1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("Linux packages generated in", installerDir);
