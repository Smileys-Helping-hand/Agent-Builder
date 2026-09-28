import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

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

const appPath = path.join(distDir, "AgentBuilder.app");

if (fs.existsSync(appPath)) {
  fs.rmSync(appPath, { recursive: true, force: true });
}

fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
fs.mkdirSync(path.join(appPath, "Contents", "Resources"), { recursive: true });
fs.cpSync(bundleDir, path.join(appPath, "Contents", "Resources", "app"), { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Agent Builder</string>
  <key>CFBundleIdentifier</key>
  <string>com.hustlestudio.agentbuilder</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleExecutable</key>
  <string>agent-builder</string>
</dict>
</plist>`;

fs.writeFileSync(path.join(appPath, "Contents", "Info.plist"), plist);
fs.writeFileSync(path.join(appPath, "Contents", "MacOS", "agent-builder"), "#!/bin/bash\nDIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nnode \"$DIR/../Resources/app/server/index.js\"\n", {
  mode: 0o755
});

const dmgPath = path.join(installerDir, "AgentBuilder.dmg");

if (fs.existsSync(dmgPath)) {
  fs.rmSync(dmgPath, { force: true });
}

const detectCreateDmg = spawnSync("which", ["create-dmg"], { encoding: "utf8" });
const createDmgBinary = detectCreateDmg.status === 0 ? detectCreateDmg.stdout.trim() : null;

if (!createDmgBinary) {
  console.warn("create-dmg CLI not found. Skipping DMG packaging. Install create-dmg to enable macOS artifacts.");
} else {
  const result = spawnSync(
    createDmgBinary,
    [
      "--overwrite",
      "--dmg-title",
      "Agent Builder",
      dmgPath,
      appPath
    ],
    {
      stdio: "inherit"
    }
  );

  if (result.error) {
    console.error("create-dmg failed", result.error);
    process.exit(result.status ?? 1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log("macOS DMG generated at", dmgPath);
}
