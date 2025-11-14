import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Logger } from "./Logger.js";

export type RepoMergeOptions = {
  sourceA: string;
  sourceB: string;
  outputDir?: string;
  strategy?: "semantic" | "overwrite";
};

export type RepoMergeReport = {
  id: string;
  summary: string;
  outputDir: string;
  mergedFiles: string[];
  conflicts: string[];
  createdAt: string;
};

const listFiles = async (root: string): Promise<string[]> => {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listFiles(resolved);
      }
      return [resolved];
    })
  );
  return files.flat();
};

const relativeSet = (root: string, files: string[]) =>
  new Set(files.map((file) => path.relative(root, file).replace(/\\/g, "/")));

const copyFile = async (source: string, target: string) => {
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(source, target);
};

const writeSummary = async (report: RepoMergeReport) => {
  const summaryPath = path.join(report.outputDir, "merge-summary.md");
  const content = `# Merge Summary\n\n` +
    `* Merge ID: ${report.id}\n` +
    `* Generated: ${report.createdAt}\n` +
    `* Strategy: ${report.summary}\n` +
    `* Merged files: ${report.mergedFiles.length}\n` +
    `* Conflicts: ${report.conflicts.length}\n` +
    (report.conflicts.length
      ? `\n## Conflicts\n${report.conflicts.map((file) => `- ${file}`).join("\n")}\n`
      : "");
  await fs.promises.writeFile(summaryPath, content, "utf8");
};

export class RepoMerger {
  async analyze(paths: string[]): Promise<{ files: number; conflicts: string[] }> {
    if (paths.length < 2) {
      return { files: 0, conflicts: [] };
    }
    const [first, second] = paths;
    const filesA = await listFiles(first);
    const filesB = await listFiles(second);
    const setA = relativeSet(first, filesA);
    const setB = relativeSet(second, filesB);
    const conflicts = [...setA].filter((file) => setB.has(file));
    return { files: setA.size + setB.size - conflicts.length, conflicts };
  }

  async merge(options: RepoMergeOptions): Promise<RepoMergeReport> {
    const { sourceA, sourceB } = options;
    if (!fs.existsSync(sourceA)) {
      throw new Error(`Source path not found: ${sourceA}`);
    }
    if (!fs.existsSync(sourceB)) {
      throw new Error(`Source path not found: ${sourceB}`);
    }

    const root = options.outputDir ?? path.resolve("./projects", `merge-${Date.now()}`);
    await fs.promises.mkdir(root, { recursive: true });

    const filesA = await listFiles(sourceA);
    const filesB = await listFiles(sourceB);
    const setA = relativeSet(sourceA, filesA);
    const setB = relativeSet(sourceB, filesB);
    const conflicts = [...setA].filter((file) => setB.has(file));

    const mergedFiles: string[] = [];
    const strategy = options.strategy ?? (process.env.MERGE_MODE as "semantic" | "overwrite") ?? "semantic";

    for (const file of filesA) {
      const relative = path.relative(sourceA, file).replace(/\\/g, "/");
      const target = path.join(root, relative);
      await copyFile(file, target);
      mergedFiles.push(relative);
    }

    for (const file of filesB) {
      const relative = path.relative(sourceB, file).replace(/\\/g, "/");
      const target = path.join(root, relative);
      if (conflicts.includes(relative) && strategy === "semantic") {
        const conflictPath = `${target}.incoming`;
        await copyFile(file, conflictPath);
        mergedFiles.push(`${relative}.incoming`);
        continue;
      }
      await copyFile(file, target);
      if (!mergedFiles.includes(relative)) {
        mergedFiles.push(relative);
      }
    }

    const report: RepoMergeReport = {
      id: crypto.randomUUID(),
      summary: strategy,
      outputDir: root,
      mergedFiles,
      conflicts,
      createdAt: new Date().toISOString()
    };

    await writeSummary(report);
    Logger.log("RepoMerger completed", { report });
    return report;
  }
}
