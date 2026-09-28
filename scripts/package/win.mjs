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

const scriptPath = path.join(__dirname, "win-installer.nsi");

const result = spawnSync("makensis", [
  `/DOUTPUT_DIR=${installerDir.replace(/\\/g, "\\\\")}`,
  `/DBUNDLE_DIR=${bundleDir.replace(/\\/g, "\\\\")}`,
  scriptPath
], {
  stdio: "inherit"
});

if (result.error) {
  console.error("makensis execution failed", result.error);
  process.exit(result.status ?? 1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Windows installer generated in", installerDir);
