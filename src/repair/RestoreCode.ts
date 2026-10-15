/**
 * RestoreCode — code a model deleted, found again.
 *
 * A small model asked to fix one thing in a long file sometimes sends the file
 * back with other functions cut down to a comment ("// Implementation remains
 * the same"). Those functions then fail the typecheck ("must return a value"),
 * and no model can fix them, because what they did is gone from the file. It
 * is not gone from the build: every pass is a commit in the build's own
 * folder, and a template build has the template's original beside it. This
 * finds, for a function standing as a placeholder, the newest version of it
 * that is whole, and puts that back.
 *
 * Sometimes there is nothing to put back: the model invented the function as
 * a stub (a Law Firm build had seven, none ever whole, none used — the app
 * imported the real ones from elsewhere). A stub nothing refers to is removed;
 * whether anything refers to it is TypeScript's own find-references, not a
 * text search ("save" and "remove" are everywhere as words).
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

import { Executor } from "../orchestrator/Executor.js";

type Ts = typeof import("typescript");
let tsModule: Ts | null | undefined;
const ts = (): Ts | null => {
  if (tsModule === undefined) {
    try {
      tsModule = createRequire(import.meta.url)("typescript") as Ts;
    } catch {
      tsModule = null;
    }
  }
  return tsModule;
};

/** What a model leaves where code used to be. */
export const PLACEHOLDER =
  /\/[/*]\s*(?:\.\.\.|…|\(?\s*(?:the\s+)?(?:implementation|logic|code|body|rest)\b[^\n]{0,40}\b(?:remains?|stays?|is|unchanged|same|as before|omitted|here)\b|existing (?:code|implementation|logic)|rest of (?:the )?(?:code|implementation|function|file)|unchanged|same as before|todo:? implement)/i;

interface Declaration {
  name: string;
  start: number;
  end: number;
  text: string;
  startLine: number;
  endLine: number;
}

/** The top-level declarations of a file (functions, consts, classes), with where they are. */
export const declarations = (file: string, text: string): Declaration[] => {
  const t = ts();
  if (!t) return [];
  const source = t.createSourceFile(file, text, t.ScriptTarget.Latest, true, file.endsWith("x") ? t.ScriptKind.TSX : t.ScriptKind.TS);
  const out: Declaration[] = [];
  for (const statement of source.statements) {
    const names: string[] = [];
    if ((t.isFunctionDeclaration(statement) || t.isClassDeclaration(statement)) && statement.name) names.push(statement.name.text);
    if (t.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) if (t.isIdentifier(d.name)) names.push(d.name.text);
    if (!names.length) continue;
    const start = statement.getStart(source);
    const end = statement.getEnd();
    out.push({
      name: names[0],
      start,
      end,
      text: text.slice(start, end),
      startLine: source.getLineAndCharacterOfPosition(start).line + 1,
      endLine: source.getLineAndCharacterOfPosition(end).line + 1
    });
  }
  return out;
};

/** The declarations, at these lines, that are placeholders now. */
export const placeholdersAt = (file: string, text: string, lines: number[]): string[] =>
  Array.from(
    new Set(
      declarations(file, text)
        .filter((d) => lines.some((line) => line >= d.startLine && line <= d.endLine) && PLACEHOLDER.test(d.text))
        .map((d) => d.name)
    )
  );

/** The language service over the project, for questions about references. */
const languageService = (root: string): { service: import("typescript").LanguageService; ts: Ts } | null => {
  const t = ts();
  if (!t) return null;
  const configPath = t.findConfigFile(root, t.sys.fileExists, "tsconfig.json");
  if (!configPath) return null;
  const config = t.readConfigFile(configPath, t.sys.readFile);
  const parsed = t.parseJsonConfigFileContent(config.config, t.sys, path.dirname(configPath));
  const versions = new Map<string, number>();
  const host: import("typescript").LanguageServiceHost = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (file) => String(versions.get(file) ?? 0),
    getScriptSnapshot: (file) => (fs.existsSync(file) ? t.ScriptSnapshot.fromString(fs.readFileSync(file, "utf8")) : undefined),
    getCurrentDirectory: () => root,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (options) => t.getDefaultLibFilePath(options),
    fileExists: t.sys.fileExists,
    readFile: t.sys.readFile,
    readDirectory: t.sys.readDirectory,
    directoryExists: t.sys.directoryExists,
    getDirectories: t.sys.getDirectories
  };
  return { service: t.createLanguageService(host, t.createDocumentRegistry()), ts: t };
};

/** Of these top-level names in a file, the ones nothing else refers to (its own declaration aside). */
export const unreferenced = (root: string, file: string, names: string[]): string[] => {
  const ls = languageService(root);
  if (!ls) return [];
  const full = path.resolve(root, file);
  const text = fs.readFileSync(full, "utf8");
  const out: string[] = [];
  for (const d of declarations(file, text).filter((x) => names.includes(x.name))) {
    // The position of the name itself inside the declaration.
    const at = d.start + d.text.search(new RegExp(`\\b${d.name}\\b`));
    const refs = ls.service.findReferences(full, at) ?? [];
    const uses = refs.flatMap((r) => r.references).filter((ref) => {
      const refFile = path.resolve(ref.fileName);
      const inside = refFile === full && ref.textSpan.start >= d.start && ref.textSpan.start < d.end;
      return !inside;
    });
    if (uses.length === 0) out.push(d.name);
  }
  return out;
};

/** Remove these top-level declarations from a file. */
export const removeDeclarations = (root: string, file: string, names: string[]): string[] => {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, "utf8");
  const removed: string[] = [];
  // Last first, so the earlier positions hold.
  for (const d of declarations(file, text).filter((x) => names.includes(x.name)).sort((a, b) => b.start - a.start)) {
    let end = d.end;
    while (text[end] === "\n" || text[end] === "\r") end++;
    text = text.slice(0, d.start) + text.slice(end);
    removed.push(d.name);
  }
  if (removed.length) fs.writeFileSync(full, text);
  return removed;
};

/** Older versions of a file: the build's own commits, newest first, then the template's original if there is one. */
const pastVersions = async (root: string, file: string, original?: string | null): Promise<string[]> => {
  const versions: string[] = [];
  const log = await Executor.run("git", ["log", "--format=%H", "-n", "60", "--", file], { cwd: root, timeoutMs: 30_000 });
  for (const sha of log.stdout.split(/\s+/).filter(Boolean)) {
    const show = await Executor.run("git", ["show", `${sha}:${file}`], { cwd: root, timeoutMs: 30_000 });
    if (show.exitCode === 0 && show.stdout) versions.push(show.stdout);
  }
  if (original) versions.push(original);
  return versions;
};

/**
 * Put back whole versions of these functions. Returns the names restored;
 * the file is written only if at least one was.
 */
export const restoreFunctions = async (root: string, file: string, names: string[], original?: string | null): Promise<string[]> => {
  const full = path.join(root, file);
  let text = fs.readFileSync(full, "utf8");
  const versions = await pastVersions(root, file, original);
  const restored: string[] = [];
  for (const name of names) {
    const current = declarations(file, text).find((d) => d.name === name);
    if (!current) continue;
    for (const version of versions) {
      const past = declarations(file, version).find((d) => d.name === name);
      // Whole (no placeholder), and more than the stub it replaces.
      if (!past || PLACEHOLDER.test(past.text) || past.text.trim().length <= current.text.trim().length) continue;
      text = text.slice(0, current.start) + past.text + text.slice(current.end);
      restored.push(name);
      break;
    }
  }
  if (restored.length) fs.writeFileSync(full, text);
  return restored;
};
