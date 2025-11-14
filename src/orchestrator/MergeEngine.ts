import { RepoMerger, type RepoMergeOptions, type RepoMergeReport } from "../utils/RepoMerger.js";
import { VectorMemory } from "../state/VectorMemory.js";
import { FeedbackStore } from "../utils/FeedbackStore.js";
import { Logger } from "../utils/Logger.js";

export class MergeEngine {
  private static instance: MergeEngine | null = null;
  private readonly merger = new RepoMerger();

  static getInstance() {
    if (!this.instance) {
      this.instance = new MergeEngine();
    }
    return this.instance;
  }

  async analyze(paths: string[]) {
    return this.merger.analyze(paths);
  }

  async merge(options: RepoMergeOptions): Promise<RepoMergeReport> {
    const report = await this.merger.merge(options);
    const summary = `Merge ${report.id} completed with ${report.mergedFiles.length} files and ${report.conflicts.length} conflicts.`;
    if (VectorMemory.isEnabled()) {
      await VectorMemory.storeConversationTurn(summary, {
        type: "merge",
        outputDir: report.outputDir,
        conflicts: report.conflicts
      });
    }
    await FeedbackStore.append({
      id: report.id,
      source: "merge-engine",
      message: summary,
      metadata: { outputDir: report.outputDir, conflicts: report.conflicts },
      createdAt: report.createdAt
    });
    Logger.log("MergeEngine report", { report });
    return report;
  }
}
