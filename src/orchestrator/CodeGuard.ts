/**
 * CodeGuard — what a model writes is checked before it replaces a file.
 *
 * Seen in practice: an "improve this file" answer that began "The provided
 * code is relatively simple…" was written verbatim over a working
 * Reservation.tsx. The typecheck then failed on every pass, the ratchet kept
 * that state as "best" (it scored the same), and the build sat at 26 until it
 * gave up. Two defences, both cheap and deterministic:
 *
 *  1. clean():  pull the code out of an answer that wrapped it in prose and a
 *     markdown fence, or that left a fence around the whole file.
 *  2. guard():  syntax-check source files (TypeScript's parser, no type
 *     checking) and JSON; an edit that turns a file that parsed into one that
 *     does not is refused, and the file keeps its last good content.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { execFileSync } from "child_process";

type TsModule = typeof import("typescript");
let ts: TsModule | null | undefined;
const loadTs = (): TsModule | null => {
  if (ts === undefined) {
    try {
      ts = createRequire(import.meta.url)("typescript") as TsModule;
    } catch {
      ts = null; // A packaged install without dev dependencies: skip the syntax check, keep the cleaning.
    }
  }
  return ts;
};

const SCRIPT = /\.(m|c)?(t|j)sx?$/i;
// Files that hold only code. Not .md: a README rightly opens with prose and contains fences.
const CODE = /\.((m|c)?(t|j)sx?|json|css|scss|html)$/i;

/** Fenced blocks in a piece of text, longest first. */
const fencedBlocks = (text: string): string[] => {
  const blocks: string[] = [];
  const pattern = /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) blocks.push(match[3]);
  return blocks.sort((a, b) => b.length - a.length);
};

/** Does this start like prose rather than code? */
const startsWithProse = (text: string): boolean => {
  const first = text.trimStart().split("\n", 1)[0] ?? "";
  if (!first) return false;
  if (/^(import|export|const|let|var|function|class|interface|type|enum|async|await|return|if|for|while|\/\/|\/\*|\*|#!|<|\{|\[|@|"use |'use |describe|it\(|test\(|module\.|require\(|\.|#|:root|html|body|---)/.test(first)) {
    return false;
  }
  // A sentence: several words and ordinary punctuation.
  return /^[A-Z][a-z]+(\s+[\w'’,-]+){3,}/.test(first) || /^(Here|The|This|Below|Sure|Certainly|I )/.test(first);
};

/** Names a module exports: `export const site`, `export function x`, `export type T`… */
const exportedNames = (source: string): Set<string> =>
  new Set(Array.from(source.matchAll(/export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)).map((m) => m[1]));

/** The keys of an exported object literal, one level down: `export const site = { business: …, menu: … }`. */
const topLevelKeys = (source: string, name: string): Set<string> => {
  const start = source.search(new RegExp(`export\\s+const\\s+${name}\\b[^=]*=\\s*\\{`));
  if (start === -1) return new Set();
  const open = source.indexOf("{", start);
  const keys = new Set<string>();
  let depth = 0;
  let expectKey = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    // Comments and strings never hold a key.
    if (ch === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === "\\") i++;
      expectKey = false;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      expectKey = depth === 1 && ch === "{";
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (depth !== 1) continue;
    if (ch === ",") {
      expectKey = true;
      continue;
    }
    if (expectKey && /[A-Za-z_$]/.test(ch)) {
      const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(source.slice(i, i + 80));
      if (match) keys.add(match[1]);
      expectKey = false;
    }
  }
  return keys;
};

export const CodeGuard = {
  /**
   * What a module exports, as short signatures another file can be written
   * against: `newGame(settings: GameSettings): GameState`, `interface Brick
   * { x: number; … }`, `const DEFAULT_SETTINGS: GameSettings`. Bodies left out.
   */
  exportSignatures(source: string): string[] {
    const ts = loadTs();
    if (!ts) return Array.from(exportedNames(source));
    const file = ts.createSourceFile("module.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const text = (node: import("typescript").Node | undefined) =>
      node
        ? node
            .getText(file)
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/[^\n]*/g, "")
            .replace(/\s+/g, " ")
            .trim()
        : "";
    const out: string[] = [];
    for (const statement of file.statements) {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
      if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const isDefault = modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (ts.isFunctionDeclaration(statement)) {
        const params = statement.parameters.map((p) => text(p)).join(", ");
        out.push(`${isDefault ? "default " : ""}${statement.name?.text ?? "function"}(${params})${statement.type ? `: ${text(statement.type)}` : ""}`);
      } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
        const full = text(statement).replace(/^export\s+/, "");
        out.push(full.length > 220 ? `${full.slice(0, 217)}…` : full);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const name = text(declaration.name);
          const init = declaration.initializer;
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
            out.push(`${name}(${init.parameters.map((p) => text(p)).join(", ")})${init.type ? `: ${text(init.type)}` : ""}`);
          } else {
            out.push(`const ${name}${declaration.type ? `: ${text(declaration.type)}` : ""}`);
          }
        }
      } else if (ts.isClassDeclaration(statement)) {
        out.push(`${isDefault ? "default " : ""}class ${statement.name?.text ?? ""}`);
      }
    }
    // `export default Menu`: show Menu's own signature, props included —
    // wrong props were the model's commonest seam error between files.
    for (const statement of file.statements) {
      if (!ts.isExportAssignment(statement) || !ts.isIdentifier(statement.expression)) continue;
      const name = statement.expression.text;
      let signature = `default ${name}`;
      for (const other of file.statements) {
        if (ts.isFunctionDeclaration(other) && other.name?.text === name) {
          signature = `default ${name}(${other.parameters.map((p) => text(p)).join(", ")})`;
        }
        if (ts.isVariableStatement(other)) {
          for (const declaration of other.declarationList.declarations) {
            const init = declaration.initializer;
            if (text(declaration.name) === name && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
              signature = `default ${name}(${init.parameters.map((p) => text(p)).join(", ")})`;
            } else if (text(declaration.name) === name && declaration.type) {
              signature = `default ${name}: ${text(declaration.type)}`;
            }
          }
        }
      }
      out.push(signature);
    }
    return out.slice(0, 24);
  },

  /**
   * A tested engine a build started from (src/game.ts from our catalogue) may
   * gain exports and have rules adjusted, but a new version that drops any of
   * its exports or throws away most of its code is a replacement, not an
   * edit — seen: game.ts "rewritten" as empty stubs. Why, or null when fine.
   */
  engineRewriteProblem(before: string, after: string): string | null {
    const kept = exportedNames(after);
    const lost = [...exportedNames(before)].filter((name) => !kept.has(name));
    if (lost.length > 0) return `drops ${lost.slice(0, 6).join(", ")}${lost.length > 6 ? ` and ${lost.length - 6} more` : ""}`;
    const code = (text: string) => text.split(/\r?\n/).filter((line) => line.trim() && !/^\s*(\/\/|\/?\*)/.test(line)).length;
    if (code(after) < code(before) * 0.6) return `keeps only ${code(after)} of its ${code(before)} lines of code`;
    return null;
  },

  /**
   * What a refused engine rewrite was trying to add: its new top-level
   * exported declarations (a saveGame the app imports), appended to the
   * engine as it was. A 7B model adding one function rewrites the whole file
   * and loses half of it; the addition is worth keeping, the loss is not.
   * Null when the new version adds nothing, or does not parse.
   */
  mergeEngineAdditions(filePath: string, before: string, after: string): { merged: string; added: string[] } | null {
    const typescript = loadTs();
    if (!typescript) return null;
    const had = exportedNames(before);
    let file: import("typescript").SourceFile;
    try {
      file = typescript.createSourceFile(filePath, after, typescript.ScriptTarget.ES2022, true);
    } catch {
      return null;
    }
    const additions: string[] = [];
    const added: string[] = [];
    for (const statement of file.statements) {
      const exported = (typescript.getCombinedModifierFlags(statement as any) & typescript.ModifierFlags.Export) !== 0;
      if (!exported) continue;
      const names: string[] = [];
      if (typescript.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) if (typescript.isIdentifier(declaration.name)) names.push(declaration.name.text);
      } else if ((typescript.isFunctionDeclaration(statement) || typescript.isClassDeclaration(statement) || typescript.isInterfaceDeclaration(statement) || typescript.isTypeAliasDeclaration(statement) || typescript.isEnumDeclaration(statement)) && statement.name) {
        names.push(statement.name.text);
      }
      const fresh = names.filter((name) => !had.has(name));
      if (fresh.length === 0 || fresh.length !== names.length) continue;
      // A function with nothing in it ("// Implementation of updateGameState")
      // is a placeholder, not an addition: merged in, it shadowed the real one.
      if (typescript.isFunctionDeclaration(statement) && statement.body && statement.body.statements.length === 0) continue;
      additions.push(statement.getText(file));
      added.push(...fresh);
    }
    if (additions.length === 0) return null;
    const merged = `${before.trimEnd()}\n\n${additions.join("\n\n")}\n`;
    return this.syntaxErrors(filePath, merged).length === 0 ? { merged, added } : null;
  },

  /**
   * A template's content module (src/content.ts) is data the pages read by
   * name. Tailoring it means changing values; a small model tends to rewrite
   * its shape instead (seen: one `site` object replaced by separate `business`
   * and `menu` exports), which breaks every page. Returns why a new version
   * would break that shape, or null when it keeps every export and every key
   * of each exported object.
   */
  templateShapeProblem(before: string, after: string): string | null {
    const kept = exportedNames(after);
    const lostExports = [...exportedNames(before)].filter((name) => !kept.has(name));
    if (lostExports.length > 0) return `it no longer exports ${lostExports.join(", ")}`;
    for (const name of exportedNames(before)) {
      const keys = topLevelKeys(before, name);
      if (keys.size === 0) continue;
      const now = topLevelKeys(after, name);
      const lostKeys = [...keys].filter((key) => !now.has(key));
      if (lostKeys.length > 0) return `${name} lost ${lostKeys.slice(0, 6).join(", ")}`;
    }
    return null;
  },

  /** The code inside a model's answer for one file. */
  clean(filePath: string, content: string): string {
    if (!CODE.test(filePath)) return content;
    let text = content.replace(/^﻿/, "");
    const trimmed = text.trim();
    // The whole file wrapped in one fence.
    const whole = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/.exec(trimmed);
    if (whole) return `${whole[2].replace(/\s+$/, "")}\n`;
    // Prose around the code, or a fence somewhere in it: take the largest block.
    if (startsWithProse(text) || /(^|\n)[ \t]*(`{3,}|~{3,})/.test(text)) {
      const blocks = fencedBlocks(text);
      if (blocks.length > 0 && (startsWithProse(text) || blocks[0].length > trimmed.length * 0.6)) {
        text = blocks[0];
      }
    }
    return `${text.replace(/\s+$/, "")}\n`;
  },

  /** Syntax errors only (no type checking); empty when it parses or cannot be checked. */
  syntaxErrors(filePath: string, content: string): string[] {
    if (/\.json$/i.test(filePath)) {
      if (/(^|\/)tsconfig[^/]*\.json$/i.test(filePath)) return []; // tsconfig allows comments
      try {
        JSON.parse(content);
        return [];
      } catch (error) {
        return [error instanceof Error ? error.message : "Invalid JSON"];
      }
    }
    if (!SCRIPT.test(filePath)) return [];
    const typescript = loadTs();
    if (!typescript) return [];
    let result: import("typescript").TranspileOutput;
    try {
      result = typescript.transpileModule(content, {
        fileName: filePath,
        reportDiagnostics: true,
        compilerOptions: {
          jsx: typescript.JsxEmit.Preserve,
          target: typescript.ScriptTarget.ES2022,
          module: typescript.ModuleKind.ESNext,
          allowJs: true
        }
      });
    } catch {
      // TypeScript itself can fall over on badly broken input ("Debug Failure.
      // Output generation failed"); that killed a whole pass. The typecheck
      // will say what is wrong with the file.
      return [];
    }
    return (result.diagnostics ?? [])
      .filter((d) => d.category === typescript.DiagnosticCategory.Error)
      .slice(0, 5)
      .map((d) => {
        const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
        const message = typescript.flattenDiagnosticMessageText(d.messageText, " ");
        return where ? `line ${where.line + 1}: ${message}` : message;
      });
  },

  /**
   * Clean every file, then refuse any edit that breaks a file which parsed
   * before (on disk under root, or in `previous`). A new file that does not
   * parse is still written: the checks will report it and a repair can fix it,
   * but a working file is never replaced by a broken one.
   */
  guard(
    files: Record<string, string>,
    root: string,
    previous: Record<string, string> = {}
  ): { files: Record<string, string>; cleaned: string[]; refused: Array<{ file: string; why: string }> } {
    const out: Record<string, string> = {};
    const cleaned: string[] = [];
    const refused: Array<{ file: string; why: string }> = [];

    for (const [file, raw] of Object.entries(files)) {
      const content = CodeGuard.clean(file, raw);
      if (content.trim() !== raw.trim()) cleaned.push(file);

      const errors = CodeGuard.syntaxErrors(file, content);
      if (errors.length > 0) {
        let before: string | undefined = previous[file];
        if (before === undefined) {
          try {
            before = fs.readFileSync(path.join(root, file), "utf8");
          } catch {
            before = undefined;
          }
        }
        if (before !== undefined && before.trim() && CodeGuard.syntaxErrors(file, before).length === 0) {
          refused.push({ file, why: errors[0] });
          out[file] = before; // keep the working version
          continue;
        }
      }
      out[file] = content;
    }
    return { files: out, cleaned, refused };
  },

  /**
   * Why a new version of a working file is a fragment, not the file: a repair
   * answered with one line ("import { onPlay } from '../engine/game';") and
   * Game.tsx, Save.tsx, Load.tsx and styles.ts were each replaced by a line.
   * The score was already low, so nothing undid it. A new version is refused
   * when it drops an export another file imports, or keeps under a quarter of
   * a file's code. Null when it is a real new version.
   */
  fragmentProblem(root: string, file: string, before: string, after: string): string | null {
    const code = (text: string) => text.split(/\r?\n/).filter((line) => line.trim() && !/^\s*(\/\/|\/?\*)/.test(line)).length;
    if (code(before) >= 8 && code(after) < code(before) * 0.25) return `keeps only ${code(after)} of its ${code(before)} lines of code`;
    const names = (text: string) => {
      const out = exportedNames(text);
      if (/export\s+default\b/.test(text)) out.add("default");
      for (const match of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of match[1].split(",")) if (part.trim()) out.add(part.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, ""));
      return out;
    };
    const kept = names(after);
    const lost = [...names(before)].filter((name) => !kept.has(name));
    if (lost.length === 0) return null;
    // Only exports something uses: dropping a helper nobody imports is a choice.
    const module = file.replace(/\.(t|j)sx?$/, "");
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(full);
          continue;
        }
        if (!/\.(t|j)sx?$/.test(entry.name)) continue;
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (rel === file) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const match of text.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s+["']([^"']+)["']/g)) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), match[3])).replace(/\.(t|j)sx?$/, "");
          if (target !== module) continue;
          const wanted = [match[1] ? "default" : "", ...(match[2] ?? "").split(",").map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])];
          if (wanted.some((name) => name && lost.includes(name))) users.push(rel);
        }
      }
    };
    try {
      walk(path.join(root, "src"));
    } catch {
      return null;
    }
    if (users.length === 0) return null;
    const shown = lost.map((name) => (name === "default" ? "its default export" : name));
    return `drops ${shown.slice(0, 4).join(", ")}, which ${Array.from(new Set(users)).slice(0, 3).join(", ")} ${users.length === 1 ? "imports" : "import"}`;
  },

  /** The file as the project's "Head start" commit wrote it, or null when it was not one of ours. */
  headStart(root: string, file: string): string | null {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    try {
      const commit = git("log", "--format=%H", "--grep=^Head start", "--", file).trim().split("\n").filter(Boolean).pop();
      return commit ? git("show", `${commit}:${file}`) : null;
    } catch {
      return null;
    }
  },

  /**
   * An engine a project started from (committed as "Head start: …") that has
   * since been rewritten and lost exports: put back what was lost, keep what
   * was added. Continued builds never saw the head start, so nothing guarded
   * the engine — the model rewrote game.ts, dropped GameEvent, and twenty
   * imports across the app broke. Null when the engine is intact or there is
   * no head start to go back to.
   */
  restoreEngine(root: string, file: string): { text: string; problem: string } | null {
    const original = CodeGuard.headStart(root, file);
    if (original === null) return null;
    let current: string;
    try {
      current = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      return null;
    }
    const lost = [...exportedNames(original)].filter((name) => !exportedNames(current).has(name));
    if (lost.length === 0) return null;
    const merged = CodeGuard.mergeEngineAdditions(file, original, current)?.merged ?? original;
    return { text: merged, problem: `had lost ${lost.slice(0, 6).join(", ")}${lost.length > 6 ? ` and ${lost.length - 6} more` : ""}` };
  }
};
