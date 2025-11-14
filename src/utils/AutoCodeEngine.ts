import fs from "fs";
import path from "path";
import { promisify } from "util";
import { exec as execCallback } from "child_process";
import { diffLines } from "diff";
import { Orchestrator } from "../orchestrator/Orchestrator.js";
import { Logger } from "./Logger.js";
import { VectorMemory } from "../state/VectorMemory.js";

const exec = promisify(execCallback);

export type AutoCodeTurn = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type ProposedEdit = {
  filePath: string;
  original: string;
  updated: string;
  diff: string;
  summary: string;
};

export type AutoCodeResult = {
  message: string;
  edits: ProposedEdit[];
};

const formatDiff = (original: string, updated: string): string => {
  return diffLines(original, updated)
    .map((part) => {
      const prefix = part.added ? "+" : part.removed ? "-" : " ";
      return part.value
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => `${prefix}${line}`)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
};

export class AutoCodeEngine {
  private readonly orchestrator: Orchestrator;
  private readonly history: AutoCodeTurn[] = [];

  constructor(orchestrator = new Orchestrator()) {
    this.orchestrator = orchestrator;
  }

  getHistory(): AutoCodeTurn[] {
    return [...this.history];
  }

  private recordTurn(turn: AutoCodeTurn) {
    this.history.push(turn);
    if (this.history.length > 200) {
      this.history.splice(0, this.history.length - 200);
    }
    void VectorMemory.storeConversationTurn(turn.content, {
      role: turn.role,
      timestamp: turn.timestamp,
      type: "autocode"
    });
  }

  async readFile(filePath: string): Promise<string> {
    const absolute = path.resolve(filePath);
    const content = await fs.promises.readFile(absolute, "utf8");
    this.recordTurn({
      role: "system",
      content: `Read file ${filePath}`,
      timestamp: new Date().toISOString(),
      metadata: { filePath }
    });
    return content;
  }

  async proposeEdit(filePath: string, instruction: string): Promise<AutoCodeResult> {
    const absolute = path.resolve(filePath);
    const original = await fs.promises.readFile(absolute, "utf8");
    this.recordTurn({
      role: "user",
      content: instruction,
      timestamp: new Date().toISOString(),
      metadata: { filePath }
    });

    let updated = original;
    let summary =
      "AutoCode requires an AI provider (OpenAI, Ollama, or LM Studio). Provide MODEL_PROVIDER or AI_PROVIDER in .env to enable automatic edits.";

    try {
      const prompt = `You are AutoCode, an expert software engineer. The user asked for: ${instruction}.\n` +
        `Return ONLY the updated file contents for ${filePath}.`;
      const tasks = await this.orchestrator.run(prompt);
      const last = tasks.at(-1);
      if (last && typeof last.result === "string" && last.result.trim().length > 0) {
        updated = last.result;
        summary = `Updated ${filePath} via orchestrator output.`;
      }
    } catch (error) {
      Logger.warn("AutoCode orchestration fallback", error);
    }

    const diff = formatDiff(original, updated);
    const edit: ProposedEdit = { filePath, original, updated, diff, summary };

    this.recordTurn({
      role: "assistant",
      content: summary,
      timestamp: new Date().toISOString(),
      metadata: { filePath, diffLength: diff.length }
    });

    return { message: summary, edits: [edit] } satisfies AutoCodeResult;
  }

  async applyEdit(edit: ProposedEdit): Promise<void> {
    const absolute = path.resolve(edit.filePath);
    await fs.promises.writeFile(absolute, edit.updated, "utf8");
    this.recordTurn({
      role: "system",
      content: `Applied edit to ${edit.filePath}`,
      timestamp: new Date().toISOString(),
      metadata: { diff: edit.diff.length }
    });
  }

  async commit(message: string, files: string[] = []): Promise<void> {
    const args = files.length > 0 ? files : ["."];
    await exec(`git add ${args.map((arg) => `"${arg}"`).join(" ")}`);
    await exec(`git commit -m ${JSON.stringify(message)}`);
    this.recordTurn({
      role: "system",
      content: `Committed changes: ${message}`,
      timestamp: new Date().toISOString()
    });
  }
}
