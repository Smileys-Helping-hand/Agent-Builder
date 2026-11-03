/**
 * EpisodicMemory — Dynamic Few-Shot Memory Shifting & Persistent Failure Ledger.
 *
 * Implements episodic memory storage for local project builders (app_memory/[app_name].json).
 * Guarantees zero repetition of failed strategies across context window boundaries by
 * recording failed syntax vectors, banned approaches, and targeted counter-strategies.
 */
import fs from "fs";
import path from "path";
import { Logger } from "../utils/Logger.js";

export interface FailedSyntaxVector {
  signature: string;
  failedAttempt: string;
  bannedApproach: string;
  counterStrategy: string;
  recordedAt: string;
}

export interface SuccessfulDiffPattern {
  signature: string;
  diffSummary: string;
  scoreDelta: number;
  recordedAt: string;
}

export interface RunRecord {
  runId: string;
  pass: number;
  score: number;
  delta: number;
  failureReason?: string;
  timestamp: string;
}

export interface EpisodicLedger {
  appName: string;
  currentScore: number;
  consecutiveStagnantRuns: number;
  heuristicRules: string[];
  failedSyntaxVectors: FailedSyntaxVector[];
  successfulDiffPatterns: SuccessfulDiffPattern[];
  runs: RunRecord[];
  updatedAt: string;
}

export class EpisodicMemory {
  private static getMemoryDir(): string {
    const memoryDir = path.resolve("app_memory");
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    return memoryDir;
  }

  private static getFilePath(appName: string): string {
    const sanitized = appName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    return path.join(this.getMemoryDir(), `${sanitized}.json`);
  }

  static getLedger(appName: string): EpisodicLedger {
    const file = this.getFilePath(appName);
    if (fs.existsSync(file)) {
      try {
        const raw = fs.readFileSync(file, "utf8");
        return JSON.parse(raw);
      } catch (err: any) {
        Logger.warn(`[EpisodicMemory] Corrupt ledger for ${appName}, reinitializing`, { error: err?.message });
      }
    }
    const emptyLedger: EpisodicLedger = {
      appName,
      currentScore: 0,
      consecutiveStagnantRuns: 0,
      heuristicRules: [],
      failedSyntaxVectors: [],
      successfulDiffPatterns: [],
      runs: [],
      updatedAt: new Date().toISOString()
    };
    this.saveLedger(emptyLedger);
    return emptyLedger;
  }

  static saveLedger(ledger: EpisodicLedger): void {
    const file = this.getFilePath(ledger.appName);
    ledger.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(ledger, null, 2), "utf8");
  }

  static recordRun(
    appName: string,
    run: { runId: string; pass: number; score: number; delta: number; failureReason?: string }
  ): EpisodicLedger {
    const ledger = this.getLedger(appName);
    ledger.currentScore = run.score;
    if (run.delta <= 0) {
      ledger.consecutiveStagnantRuns += 1;
    } else {
      ledger.consecutiveStagnantRuns = 0;
    }
    ledger.runs.push({
      ...run,
      timestamp: new Date().toISOString()
    });
    this.saveLedger(ledger);
    return ledger;
  }

  static recordFailureVector(
    appName: string,
    vector: { signature: string; failedAttempt: string; bannedApproach: string; counterStrategy: string }
  ): void {
    const ledger = this.getLedger(appName);
    const existingIndex = ledger.failedSyntaxVectors.findIndex(v => v.signature === vector.signature);
    const entry: FailedSyntaxVector = {
      ...vector,
      recordedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      ledger.failedSyntaxVectors[existingIndex] = entry;
    } else {
      ledger.failedSyntaxVectors.push(entry);
    }
    this.saveLedger(ledger);
  }

  static recordSuccessPattern(
    appName: string,
    pattern: { signature: string; diffSummary: string; scoreDelta: number }
  ): void {
    const ledger = this.getLedger(appName);
    ledger.successfulDiffPatterns.push({
      ...pattern,
      recordedAt: new Date().toISOString()
    });
    this.saveLedger(ledger);
  }

  static addHeuristicRule(appName: string, rule: string): void {
    const ledger = this.getLedger(appName);
    if (!ledger.heuristicRules.includes(rule)) {
      ledger.heuristicRules.push(rule);
      this.saveLedger(ledger);
    }
  }

  static getBannedApproaches(appName: string): string[] {
    const ledger = this.getLedger(appName);
    return ledger.failedSyntaxVectors.map(v => v.bannedApproach);
  }

  static getCounterStrategies(appName: string, currentErrors: string): string[] {
    const ledger = this.getLedger(appName);
    const strategies: string[] = [];
    for (const vector of ledger.failedSyntaxVectors) {
      if (currentErrors.includes(vector.signature) || vector.signature.split(" ").some(s => s.length > 5 && currentErrors.includes(s))) {
        strategies.push(`[Known Failure: ${vector.signature}] -> Counter-Strategy: ${vector.counterStrategy} (BANNED: ${vector.bannedApproach})`);
      }
    }
    return strategies;
  }

  static formatFailureLedgerForPrompt(appName: string): string {
    const ledger = this.getLedger(appName);
    const payload = {
      app: appName,
      consecutiveStagnantRuns: ledger.consecutiveStagnantRuns,
      heuristicRules: ledger.heuristicRules,
      bannedApproaches: ledger.failedSyntaxVectors.map(v => ({
        signature: v.signature,
        banned: v.bannedApproach,
        counterStrategy: v.counterStrategy
      })),
      recentFailures: ledger.runs.filter(r => r.delta <= 0).slice(-3)
    };
    return JSON.stringify(payload, null, 2);
  }
}
