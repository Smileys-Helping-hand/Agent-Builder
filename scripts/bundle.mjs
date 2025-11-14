import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.resolve(__dirname, "..", "dist");
const outDir = path.join(root, "app");

const copyRecursive = async (source, destination) => {
  const stats = await fs.promises.stat(source);
  if (stats.isDirectory()) {
    await fs.promises.mkdir(destination, { recursive: true });
    const entries = await fs.promises.readdir(source);
    await Promise.all(
      entries.map((entry) =>
        copyRecursive(path.join(source, entry), path.join(destination, entry))
      )
    );
    return;
  }
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.copyFile(source, destination);
};

const emptyDir = async (target) => {
  if (!fs.existsSync(target)) {
    return;
  }
  const entries = await fs.promises.readdir(target);
  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(target, entry);
      const stats = await fs.promises.stat(entryPath);
      if (stats.isDirectory()) {
        await emptyDir(entryPath);
        await fs.promises.rmdir(entryPath);
      } else {
        await fs.promises.unlink(entryPath);
      }
    })
  );
};

const ensureArtifacts = async () => {
  const serverBundle = path.join(root, "server");
  const dashboardDir = path.resolve(__dirname, "..", "dashboard", ".next");
  if (!fs.existsSync(serverBundle)) {
    throw new Error("Server bundle missing. Run npm run build:server first.");
  }
  if (!fs.existsSync(dashboardDir)) {
    throw new Error("Dashboard build missing. Run npm run build:dashboard first.");
  }
};

const writeMetadata = async () => {
  const pkgRaw = await fs.promises.readFile(path.resolve(__dirname, "..", "package.json"), "utf8");
  const pkg = JSON.parse(pkgRaw);
  const metadata = {
    name: pkg.name,
    version: pkg.version,
    createdAt: new Date().toISOString()
  };
  await fs.promises.writeFile(path.join(outDir, "metadata.json"), JSON.stringify(metadata, null, 2));
};

(async () => {
  await ensureArtifacts();
  await fs.promises.mkdir(outDir, { recursive: true });
  await emptyDir(outDir);
  await copyRecursive(path.join(root, "server"), path.join(outDir, "server"));
  await copyRecursive(path.resolve(__dirname, "..", "dashboard", ".next"), path.join(outDir, "dashboard"));
  await copyRecursive(path.resolve(__dirname, "..", "dashboard", "public"), path.join(outDir, "public"));
  await copyRecursive(path.resolve(__dirname, "..", "docs"), path.join(outDir, "docs"));
  await fs.promises.copyFile(path.resolve(__dirname, "..", "package.json"), path.join(outDir, "package.json"));
  await fs.promises.copyFile(path.resolve(__dirname, "..", "package-lock.json"), path.join(outDir, "package-lock.json"));
  await writeMetadata();
  console.log("Bundle written to", outDir);
})();
