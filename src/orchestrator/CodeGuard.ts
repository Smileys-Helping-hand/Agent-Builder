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
  }
};
