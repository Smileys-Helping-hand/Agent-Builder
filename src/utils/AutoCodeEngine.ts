import fs from "fs";
import path from "path";
import { promisify } from "util";
import { exec as execCallback } from "child_process";
import { diffLines } from "diff";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "./Logger.js";
import { VectorMemory } from "../state/VectorMemory.js";

const exec = promisify(execCallback);

// Every path this engine touches is resolved against the process working
// directory and rejected if it escapes. Without this, `filePath` (and an
// `edit.filePath` supplied directly in an /api/chat/autocode request body)
// is an arbitrary-file-read/write primitive against anything the server
// process can reach.
const WORKSPACE_ROOT = path.resolve(process.cwd());

const resolveInsideWorkspace = (filePath: string): string => {
  const resolved = path.resolve(WORKSPACE_ROOT, filePath);
  const rootWithSep = WORKSPACE_ROOT.endsWith(path.sep) ? WORKSPACE_ROOT : WORKSPACE_ROOT + path.sep;
  if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(rootWithSep)) {
    throw new Error(`Refusing to access a path outside the workspace: ${filePath}`);
  }
  return resolved;
};

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
  private readonly history: AutoCodeTurn[] = [];

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
    const absolute = resolveInsideWorkspace(filePath);
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
    const absolute = resolveInsideWorkspace(filePath);
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
      const prompt =
        `You are AutoCode, an expert software engineer.\n` +
        `Apply this change to the file below: ${instruction}\n\n` +
        `File: ${filePath}\n` +
        "```\n" +
        original +
        "\n```\n\n" +
        `Return ONLY the complete updated contents of ${filePath}. No prose, no code fence.`;
      const response = await ModelRouter.generate(prompt);
      if (response.trim().length > 0) {
        updated = response;
        summary = `Updated ${filePath}.`;
      }
    } catch (error) {
      Logger.warn("AutoCode generation failed", error);
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
    const absolute = resolveInsideWorkspace(edit.filePath);
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
