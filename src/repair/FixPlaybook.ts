/**
 * FixPlaybook — fixes the builder worked out for itself, kept and reused.
 *
 * Every hand-written fix in this codebase (AutoFix, TypeFixer, the hints in the
 * prompts) began as a person watching a build loop on the same error and
 * writing the rule down. The playbook is the builder doing that itself: when
 * the Stuck Doctor finds a fix that makes an error go away, the fix is written
 * here as a small recipe of safe actions under the error it fixed, and the next
 * build that meets that error gets it at once, before any model is asked.
 *
 * Recipes are data, never code: a short list of action types, each checked
 * before it runs (a package name that is a package name, a path inside the
 * project's src/, an import that is an import). What the model writes is only
 * ever the content of one source file it was asked to fix.
 *
 * The file is data/fix-playbook.json, readable by a person and shown in the app.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { generalise } from "./ErrorFingerprint.js";

export type FixAction =
  /** A package the code needs: added to package.json, then installed. */
  | { type: "add_package"; name: string; version?: string; dev?: boolean }
  /** Names added to tsconfig compilerOptions.types (what gives globals and matchers their types). */
  | { type: "tsconfig_types"; add: string[] }
  /** One import line at the top of the test files, or of one file in src/. */
  | { type: "add_import"; where: "test_files" | string; line: string }
  /** A new small file: a declaration (.d.ts) or a test setup file. Never replaces one. */
  | { type: "create_file"; path: string; content: string }
  /** Vitest's own settings in vite.config / vitest.config: the environment and setup files. */
  | { type: "vitest_config"; environment?: "jsdom" | "happy-dom" | "node"; setupFiles?: string[] }
  /** One source file changed by the model to follow an instruction, given the errors in it. */
  | { type: "edit_file"; path: string; instruction: string };

export interface PlaybookEntry {
  id: string;
  /** The error this fixes: its code and generalised message (ErrorFingerprint.generalise). */
  code: string;
  pattern: string;
  /** Why it happens, in a sentence: what the Doctor concluded. */
  cause: string;
  actions: FixAction[];
  /** Where the answer came from: the packages' own files, Stack Overflow, an issue… */
  evidence: string[];
  worked: number;
  failed: number;
  createdAt: string;
  lastUsedAt: string | null;
  /** The build that found it. */
  foundIn: string | null;
}

interface PlaybookFile {
  version: 1;
  entries: PlaybookEntry[];
  /** Recipes that were tried for an error and did not help, so they are not tried again for it. */
  tried: Array<{ pattern: string; recipe: string; at: string }>;
}

const FILE = () => path.join(process.cwd(), "data", "fix-playbook.json");

const read = (): PlaybookFile => {
  try {
    const data = JSON.parse(fs.readFileSync(FILE(), "utf8")) as Partial<PlaybookFile>;
    return { version: 1, entries: data.entries ?? [], tried: data.tried ?? [] };
  } catch {
    return { version: 1, entries: [], tried: [] };
  }
};

const write = (data: PlaybookFile) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  // Kept small: the 300 most recent failed tries are enough to not repeat them.
  data.tried = data.tried.slice(-300);
  fs.writeFileSync(FILE(), JSON.stringify(data, null, 2));
};

const tokens = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9#<>]+/).filter((t) => t.length > 1));
/** How alike two generalised messages are (0..1): a type name inside the message may differ between projects. */
export const similarity = (a: string, b: string): number => {
  if (a === b) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  const shared = [...ta].filter((t) => tb.has(t)).length;
  return shared / Math.max(1, Math.max(ta.size, tb.size));
};

export const recipeKey = (actions: FixAction[]): string =>
  crypto.createHash("sha1").update(JSON.stringify(actions)).digest("hex").slice(0, 12);

/* ─── checking a recipe before it runs ─── */

const PACKAGE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const VERSION = /^(latest|[\^~]?\d+(\.\d+){0,2}(-[\w.]+)?)$/;
const IMPORT_LINE = /^import\s+(?:(?:[\w*{}\s,]+)\s+from\s+)?["'][^"'\n]+["'];?$/;
const SRC_PATH = /^src\/[\w./-]+\.(ts|tsx|js|jsx)$/;
const NEW_FILE = /^(src\/[\w./-]+\.d\.ts|src\/(setupTests|test-setup|test\/setup|setup)\.(ts|tsx)|vitest\.setup\.ts)$/;

export const checkAction = (action: unknown): FixAction | null => {
  if (!action || typeof action !== "object") return null;
  const a = action as Record<string, unknown>;
  switch (a.type) {
    case "add_package": {
      const name = String(a.name ?? "").trim();
      const version = a.version === undefined || a.version === null || a.version === "" ? undefined : String(a.version).trim();
      if (!PACKAGE.test(name) || name.length > 80 || (version && !VERSION.test(version))) return null;
      return { type: "add_package", name, version, dev: a.dev !== false };
    }
    case "tsconfig_types": {
      const add = Array.isArray(a.add) ? a.add.map(String).map((s) => s.trim()) : [];
      if (!add.length || add.length > 4 || add.some((s) => !/^(@[\w.-]+\/)?[\w.-]+(\/[\w.-]+)*$/.test(s))) return null;
      return { type: "tsconfig_types", add };
    }
    case "add_import": {
      const where = String(a.where ?? "").trim().replace(/\\/g, "/");
      const line = String(a.line ?? "").trim();
      if (!IMPORT_LINE.test(line) || line.length > 200) return null;
      if (where !== "test_files" && !SRC_PATH.test(where)) return null;
      return { type: "add_import", where, line };
    }
    case "create_file": {
      const file = String(a.path ?? "").trim().replace(/\\/g, "/");
      const content = String(a.content ?? "");
      if (!NEW_FILE.test(file) || file.includes("..") || content.length === 0 || content.length > 4000) return null;
      return { type: "create_file", path: file, content };
    }
    case "vitest_config": {
      const environment = a.environment === undefined ? undefined : String(a.environment);
      if (environment && !["jsdom", "happy-dom", "node"].includes(environment)) return null;
      const setupFiles = Array.isArray(a.setupFiles) ? a.setupFiles.map(String) : undefined;
      if (setupFiles && setupFiles.some((f) => !/^\.?\/?(src\/)?[\w./-]+\.(ts|tsx|js)$/.test(f) || f.includes(".."))) return null;
      if (!environment && !setupFiles?.length) return null;
      return { type: "vitest_config", environment: environment as "jsdom" | "happy-dom" | "node" | undefined, setupFiles };
    }
    case "edit_file": {
      const file = String(a.path ?? "").trim().replace(/\\/g, "/");
      const instruction = String(a.instruction ?? "").trim();
      if (!SRC_PATH.test(file) || file.includes("..") || instruction.length < 8 || instruction.length > 600) return null;
      return { type: "edit_file", path: file, instruction };
    }
    default:
      return null;
  }
};

export const describeAction = (action: FixAction): string => {
  switch (action.type) {
    case "add_package":
      return `add ${action.name}${action.version ? `@${action.version}` : ""}${action.dev ? " (dev)" : ""}`;
    case "tsconfig_types":
      return `add ${action.add.join(", ")} to tsconfig types`;
    case "add_import":
      return `add \`${action.line}\` to ${action.where === "test_files" ? "the test files" : action.where}`;
    case "create_file":
      return `create ${action.path}`;
    case "vitest_config":
      return `set Vitest ${[action.environment ? `environment to ${action.environment}` : "", action.setupFiles?.length ? `setup files ${action.setupFiles.join(", ")}` : ""].filter(Boolean).join(" and ")}`;
    case "edit_file":
      return `edit ${action.path}: ${action.instruction}`;
  }
};

/* ─── the playbook ─── */

export const FixPlaybook = {
  list(): PlaybookEntry[] {
    return read().entries;
  },

  /** Entries for an error, best first: same code, a message alike enough, and a record that is not mostly failure. */
  match(code: string, message: string): PlaybookEntry[] {
    const pattern = generalise(message);
    return read()
      .entries.filter((entry) => entry.code === code && similarity(entry.pattern, pattern) >= 0.6 && entry.failed <= entry.worked + 2)
      .sort((a, b) => (b.worked + 1) / (b.worked + b.failed + 2) - (a.worked + 1) / (a.worked + a.failed + 2));
  },

  /** A recipe that did not help this error is not tried on it again. */
  wasTried(message: string, actions: FixAction[]): boolean {
    const pattern = generalise(message);
    const key = recipeKey(actions);
    return read().tried.some((t) => t.recipe === key && similarity(t.pattern, pattern) >= 0.9);
  },

  recordTried(message: string, actions: FixAction[]): void {
    const data = read();
    data.tried.push({ pattern: generalise(message), recipe: recipeKey(actions), at: new Date().toISOString() });
    write(data);
  },

  /** A fix that worked: added (or, if this recipe was already there for this error, counted). */
  learn(input: { code: string; message: string; cause: string; actions: FixAction[]; evidence: string[]; foundIn: string | null }): PlaybookEntry {
    const data = read();
    const pattern = generalise(input.message);
    const key = recipeKey(input.actions);
    const existing = data.entries.find((entry) => entry.code === input.code && similarity(entry.pattern, pattern) >= 0.9 && recipeKey(entry.actions) === key);
    if (existing) {
      existing.worked += 1;
      existing.lastUsedAt = new Date().toISOString();
      write(data);
      return existing;
    }
    const entry: PlaybookEntry = {
      id: `fix_${Date.now().toString(36)}${crypto.randomBytes(2).toString("hex")}`,
      code: input.code,
      pattern,
      cause: input.cause.slice(0, 400),
      actions: input.actions,
      evidence: input.evidence.slice(0, 6),
      worked: 1,
      failed: 0,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      foundIn: input.foundIn
    };
    data.entries.push(entry);
    write(data);
    return entry;
  },

  outcome(id: string, worked: boolean): void {
    const data = read();
    const entry = data.entries.find((e) => e.id === id);
    if (!entry) return;
    if (worked) entry.worked += 1;
    else entry.failed += 1;
    entry.lastUsedAt = new Date().toISOString();
    write(data);
  },

  remove(id: string): boolean {
    const data = read();
    const before = data.entries.length;
    data.entries = data.entries.filter((e) => e.id !== id);
    write(data);
    return data.entries.length < before;
  }
};
