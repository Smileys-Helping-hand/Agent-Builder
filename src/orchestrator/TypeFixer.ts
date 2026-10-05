/**
 * TypeFixer — TypeScript errors with a mechanical fix, fixed by TypeScript
 * itself, before any check runs and without asking a model.
 *
 * A 7B model spent attempt after attempt on "'gameState.currentQuestion' is
 * possibly 'null'" and never fixed it, while the fix is one character. Most of
 * the errors that kept builds at a score of 20 are like that, and TypeScript's
 * own language service already knows the fixes (the quick fixes an editor
 * offers): add the missing import, correct the misspelled name, infer the type
 * of an untyped parameter. This applies those, plus two of its own:
 *
 *  - "X is possibly 'null' / 'undefined'": `X!` (the app reached that line with
 *    a value, or the model would have had to guard the whole screen);
 *  - "Parameter 'x' implicitly has an 'any' type" with no inferable type: `x: any`.
 *
 * Only edits from that short list are made, a few rounds at most, and only to
 * the app's own files under src/. What it cannot fix is left for the repair.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";

type TsModule = typeof import("typescript");

let tsModule: TsModule | null | undefined;
const loadTs = (): TsModule | null => {
  if (tsModule === undefined) {
    try {
      tsModule = createRequire(import.meta.url)("typescript") as TsModule;
    } catch {
      tsModule = null;
    }
  }
  return tsModule;
};

/** "X is possibly null/undefined" in its forms (TS 5: 18047-18049; older: 2531-2533). */
const POSSIBLY_NULLISH = new Set([18047, 18048, 18049, 2531, 2532, 2533]);
/** Implicit any on a parameter or a destructured parameter. */
const IMPLICIT_ANY = new Set([7006, 7031]);

/**
 * The language service's own fixes that are safe to apply unseen: they add an
 * import, correct a name to one that exists, add an `await`, or write down a
 * type that is already implied. Nothing that deletes code or changes logic.
 */
const SAFE_FIXES = new Set(["import", "spelling", "addMissingAwait", "inferFromUsage", "fixAddMissingMember", "addMissingConst", "fixAddVoidToPromise", "fixImportNonExportedMember", "convertToTypeOnlyExport", "convertToTypeOnlyImport"]);

const MAX_ROUNDS = 4;

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * `state = launch(state)` and `return launch(state)` where launch changes the
 * state in place and returns nothing: call it, then use the state. Only when
 * the call's first argument is the very thing being assigned (or a plain
 * name, for a return), so the meaning is not in doubt.
 */
/** The whitespace a line starts with, so a statement split in two stays lined up. */
const indentOf = (text: string, position: number): string => {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))?.[0] ?? "";
};

const AutonomousVoidFix = {
  edit(ts: TsModule, file: import("typescript").SourceFile | undefined, position: number): (Edit & { note: string }) | null {
    if (!file) return null;
    // The smallest statement around the error.
    let found: import("typescript").Statement | undefined;
    const visit = (node: import("typescript").Node) => {
      if (position < node.getStart(file) || position >= node.getEnd()) return;
      if (ts.isExpressionStatement(node) || ts.isReturnStatement(node)) found = node;
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (!found) return null;
    const statement = found;
    const start = statement.getStart(file);
    const end = statement.getEnd();
    if (ts.isReturnStatement(statement) && statement.expression && ts.isCallExpression(statement.expression)) {
      const call = statement.expression;
      const first = call.arguments[0];
      if (!first || !ts.isIdentifier(first)) return null;
      return { start, end, text: `${call.getText(file)};\n${indentOf(file.text, start)}return ${first.text};`, note: `${call.expression.getText(file)}() changes ${first.text} in place and returns nothing: called it, then returned ${first.text}` };
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const { left, right } = statement.expression;
      if (!ts.isCallExpression(right)) return null;
      const first = right.arguments[0];
      if (!first || first.getText(file) !== left.getText(file)) return null;
      return { start, end, text: `${right.getText(file)};`, note: `${right.expression.getText(file)}() changes ${left.getText(file)} in place and returns nothing: no longer assigned` };
    }
    return null;
  }
};

/** Levenshtein distance, for telling a typo from a different name. */
const editDistance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
};

const applyEdits = (text: string, edits: Edit[]): string => {
  // From the end, so earlier offsets stay valid; overlapping edits are dropped.
  let out = text;
  let floor = Infinity;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.end > floor) continue;
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
};

export const TypeFixer = {
  /** Fix what can be fixed mechanically; returns a note per fix. Never throws. */
  run(folder: string): string[] {
    // Absolute, or no file would ever count as the app's own (src/ is compared by prefix).
    const root = path.resolve(folder);
    const ts = loadTs();
    const configPath = path.join(root, "tsconfig.json");
    if (!ts || !fs.existsSync(configPath)) return [];
    try {
      return this.fix(ts, root, configPath);
    } catch {
      return [];
    }
  },

  fix(ts: TsModule, root: string, configPath: string): string[] {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) return [];
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    const src = path.join(root, "src") + path.sep;
    const ours = (file: string) => path.resolve(file).startsWith(src) && !file.includes(`${path.sep}node_modules${path.sep}`);

    const versions = new Map<string, number>();
    const texts = new Map<string, string>();
    const textOf = (file: string): string | undefined => {
      const key = path.resolve(file);
      if (texts.has(key)) return texts.get(key);
      if (!fs.existsSync(key)) return undefined;
      const text = fs.readFileSync(key, "utf8");
      texts.set(key, text);
      return text;
    };

    const host: import("typescript").LanguageServiceHost = {
      getScriptFileNames: () => parsed.fileNames,
      getScriptVersion: (file) => String(versions.get(path.resolve(file)) ?? 0),
      getScriptSnapshot: (file) => {
        const text = textOf(file);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => root,
      getCompilationSettings: () => parsed.options,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories
    };
    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    const format = ts.getDefaultFormatCodeSettings();
    const preferences: import("typescript").UserPreferences = { quotePreference: "double", importModuleSpecifierPreference: "relative" };

    /** Whether `name`, as seen from `position`, is only declared by TypeScript's own libraries (window, document…). */
    const declaredOnlyInLibraries = (fileName: string, position: number, name: string): boolean => {
      const program = service.getProgram();
      const sourceFile = program?.getSourceFile(fileName);
      if (!program || !sourceFile) return false;
      let node: import("typescript").Node = sourceFile;
      const visit = (child: import("typescript").Node) => {
        if (position >= child.getStart(sourceFile) && position < child.getEnd()) {
          node = child;
          ts.forEachChild(child, visit);
        }
      };
      ts.forEachChild(sourceFile, visit);
      const symbol = program.getTypeChecker().getSymbolsInScope(node, ts.SymbolFlags.Value | ts.SymbolFlags.Type).find((candidate) => candidate.name === name);
      return Boolean(symbol?.declarations?.length && symbol.declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile));
    };

    const notes: string[] = [];
    const changed = new Set<string>();
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const edits = new Map<string, Edit[]>();
      // One fix per change: DEFAULT_SETTINGS used four times offers "add the
      // import" four times, and applying each wrote the import four times over.
      const add = (file: string, edit: Edit) => {
        const list = edits.get(file) ?? [];
        if (list.some((other) => other.start === edit.start && other.end === edit.end && other.text === edit.text)) return;
        edits.set(file, [...list, edit]);
      };

      for (const fileName of parsed.fileNames.filter(ours)) {
        const text = textOf(fileName) ?? "";
        // A file that does not parse is the repair's job: fixing types in it is guesswork.
        if (service.getSyntacticDiagnostics(fileName).length > 0) continue;
        for (const diagnostic of service.getSemanticDiagnostics(fileName)) {
          if (diagnostic.start === undefined || diagnostic.length === undefined) continue;
          const start = diagnostic.start;
          const end = start + diagnostic.length;
          const rel = path.relative(root, fileName).split(path.sep).join("/");
          const line = text.slice(0, start).split("\n").length;

          if (POSSIBLY_NULLISH.has(diagnostic.code)) {
            // `a.b` possibly null in `a.b.c` -> `a.b!.c`. Only after an expression.
            if (text[end] !== "!" && /[\w$)\]]/.test(text[end - 1] ?? "")) {
              add(path.resolve(fileName), { start: end, end, text: "!" });
              notes.push(`${rel}:${line}: ${text.slice(start, end)} may be empty here; marked as set (${diagnostic.code})`);
            }
            continue;
          }

          // "Import declaration conflicts with local declaration of 'GameState'":
          // the file imports the real type and then writes its own. The import
          // wins; the local type or interface (only those) goes.
          if (diagnostic.code === 2440) {
            const name = /'([A-Za-z_$][\w$]*)'/.exec(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))?.[1];
            const source = service.getProgram()?.getSourceFile(fileName);
            const local = source?.statements.find(
              (statement) => (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) && statement.name.text === name
            );
            if (source && local) {
              const from = text.lastIndexOf("\n", local.getStart(source) - 1) + 1;
              const newline = text.indexOf("\n", local.getEnd());
              add(path.resolve(fileName), { start: from, end: newline === -1 ? text.length : newline + 1, text: "" });
              notes.push(`${rel}:${line}: removed a second ${name} type; the imported one is used`);
              continue;
            }
          }

          // "Type 'void' is not assignable": a function that changes the state in
          // place (launch(state): void) used as if it returned the new state.
          if (diagnostic.code === 2322 && /Type 'void' is not assignable/.test(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))) {
            const edit = AutonomousVoidFix.edit(ts, service.getProgram()?.getSourceFile(fileName), start);
            if (edit) {
              add(path.resolve(fileName), edit);
              notes.push(`${rel}:${line}: ${edit.note}`);
              continue;
            }
          }

          const fixes = service.getCodeFixesAtPosition(fileName, start, end, [diagnostic.code], format, preferences);
          const written = text.slice(start, end);
          const fix = fixes.find((candidate) => {
            if (!SAFE_FIXES.has(candidate.fixName)) return false;
            if (candidate.fixName !== "spelling") return true;
            // "Did you mean handleStep?" for handleSave compiles and wires the
            // Save button to the wrong thing. Only a typo is a typo.
            const suggested = candidate.changes[0]?.textChanges[0]?.newText ?? "";
            // Nor is a browser global: an undefined TOP became `top` (window.top), and
            // `top + 10` stopped compiling for a new reason.
            if (declaredOnlyInLibraries(fileName, start, suggested)) return false;
            return written.toLowerCase() === suggested.toLowerCase() || editDistance(written, suggested) <= 2;
          });
          if (fix) {
            for (const change of fix.changes) {
              if (!ours(change.fileName)) continue;
              for (const textChange of change.textChanges) {
                add(path.resolve(change.fileName), { start: textChange.span.start, end: textChange.span.start + textChange.span.length, text: textChange.newText });
              }
            }
            notes.push(`${rel}:${line}: ${fix.description}`);
            continue;
          }

          if (IMPLICIT_ANY.has(diagnostic.code) && diagnostic.code === 7006 && text[end] !== ":" && !/^\s*:/.test(text.slice(end, end + 3))) {
            // No type to infer from: say so plainly rather than leave the build failing.
            add(path.resolve(fileName), { start: end, end, text: ": any" });
            notes.push(`${rel}:${line}: gave parameter ${text.slice(start, end)} a type (any)`);
          }
        }
      }

      if (edits.size === 0) break;
      for (const [file, list] of edits) {
        const before = textOf(file) ?? "";
        const after = applyEdits(before, list);
        if (after === before) continue;
        texts.set(file, after);
        versions.set(file, (versions.get(file) ?? 0) + 1);
        changed.add(file);
      }
    }

    for (const file of changed) fs.writeFileSync(file, texts.get(file) ?? "", "utf8");
    service.dispose();
    return Array.from(new Set(notes)).slice(0, 40);
  }
};
