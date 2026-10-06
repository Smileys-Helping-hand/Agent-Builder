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

/** Attributes a component from src/engine/ does not accept, removed from where it is rendered. */
const ExtraPropsFix = {
  edits(ts: TsModule, program: import("typescript").Program | undefined, fileName: string, start: number, root: string): { edits: Edit[]; note: string } | null {
    const source = program?.getSourceFile(fileName);
    if (!program || !source) return null;
    let element: import("typescript").JsxOpeningLikeElement | undefined;
    const visit = (node: import("typescript").Node) => {
      if (node.getStart(source) <= start && node.getEnd() > start) {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) element = node;
        ts.forEachChild(node, visit);
      }
    };
    ts.forEachChild(source, visit);
    if (!element) return null;
    const checker = program.getTypeChecker();
    let symbol = checker.getSymbolAtLocation(element.tagName);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const declaration = symbol?.declarations?.[0];
    if (!declaration) return null;
    const declaredIn = path.relative(root, declaration.getSourceFile().fileName).split(path.sep).join("/");
    if (!declaredIn.startsWith("src/engine/")) return null;
    const signature = checker.getTypeOfSymbolAtLocation(symbol!, element.tagName).getCallSignatures()[0];
    const propsParam = signature?.getParameters()[0];
    if (!propsParam) return null;
    const props = checker.getTypeOfSymbolAtLocation(propsParam, element);
    const extra = element.attributes.properties.filter(
      (attribute): attribute is import("typescript").JsxAttribute =>
        ts.isJsxAttribute(attribute) && !["key", "ref"].includes(attribute.name.getText(source)) && !props.getProperty(attribute.name.getText(source))
    );
    if (extra.length === 0) return null;
    const text = source.getFullText();
    return {
      edits: extra.map((attribute) => {
        // The attribute with the space before it.
        let from = attribute.getStart(source);
        while (from > 0 && /\s/.test(text[from - 1])) from--;
        return { start: from, end: attribute.getEnd(), text: "" };
      }),
      note: `${element.tagName.getText(source)} (${declaredIn}) does not take ${extra.map((a) => a.name.getText(source)).join(", ")}; removed`
    };
  }
};

/**
 * An import asking a file for a name it does not export, when exactly one
 * other file of ours does: the name moves to an import from that file.
 */
const WrongModuleFix = {
  edits(
    ts: TsModule,
    program: import("typescript").Program | undefined,
    fileName: string,
    start: number,
    ours: (file: string) => boolean
  ): { edits: Edit[]; note: string } | null {
    const source = program?.getSourceFile(fileName);
    if (!program || !source) return null;
    const declaration = source.statements.find(
      (statement): statement is import("typescript").ImportDeclaration => ts.isImportDeclaration(statement) && statement.getStart(source) <= start && statement.getEnd() >= start
    );
    const named = declaration?.importClause?.namedBindings;
    if (!declaration || !named || !ts.isNamedImports(named) || !ts.isStringLiteral(declaration.moduleSpecifier)) return null;
    const element = named.elements.find((item) => item.getStart(source) <= start && item.getEnd() > start);
    if (!element) return null;
    const name = (element.propertyName ?? element.name).text;
    const checker = program.getTypeChecker();
    const current = checker.getSymbolAtLocation(declaration.moduleSpecifier);
    const owners = program.getSourceFiles().filter((other) => {
      if (other === source || !ours(other.fileName) || /\.(test|spec)\./.test(other.fileName)) return false;
      const symbol = checker.getSymbolAtLocation(other);
      return Boolean(symbol && symbol !== current && checker.getExportsOfModule(symbol).some((exported) => exported.name === name));
    });
    if (owners.length !== 1) return null;
    let specifier = path.relative(path.dirname(fileName), owners[0].fileName).split(path.sep).join("/").replace(/\.(t|j)sx?$/, "");
    if (!specifier.startsWith(".")) specifier = `./${specifier}`;
    const quote = declaration.moduleSpecifier.getText(source)[0];
    if (named.elements.length === 1 && !declaration.importClause?.name) {
      const literal = declaration.moduleSpecifier;
      return { edits: [{ start: literal.getStart(source), end: literal.getEnd(), text: `${quote}${specifier}${quote}` }], note: `${name} is exported by ${specifier}, not ${declaration.moduleSpecifier.text}; imported from there` };
    }
    // Take the name out of this import (with its comma), and import it on its own line.
    const index = named.elements.indexOf(element);
    const removeFrom = index < named.elements.length - 1 ? element.getStart(source) : named.elements[index - 1].getEnd();
    const removeTo = index < named.elements.length - 1 ? named.elements[index + 1].getStart(source) : element.getEnd();
    const typeOnly = declaration.importClause?.isTypeOnly ? "type " : "";
    return {
      edits: [
        { start: removeFrom, end: removeTo, text: "" },
        { start: declaration.getStart(source), end: declaration.getStart(source), text: `import ${typeOnly}{ ${element.getText(source)} } from ${quote}${specifier}${quote};\n` }
      ],
      note: `${name} is exported by ${specifier}, not ${declaration.moduleSpecifier.text}; imported from there`
    };
  }
};

/**
 * `state.level[state.level]` and `state.level.length` when `level` is the
 * current level's number and the list is `state.settings.levels`: a small
 * model indexes the number. A live build spent a whole pass of repairs on it,
 * with the answer spelled out in its instructions. When the number has exactly
 * one plural list beside it (on the same object, or one level down), the
 * list is meant: `state.settings.levels[state.level]`.
 */
const NumberAsListFix = {
  edit(ts: TsModule, program: import("typescript").Program | undefined, file: import("typescript").SourceFile | undefined, start: number, end: number, code: number): (Edit & { note: string }) | null {
    if (!program || !file) return null;
    let node: import("typescript").Node | undefined;
    const visit = (child: import("typescript").Node) => {
      if (child.getStart(file) <= start && child.getEnd() >= end) {
        node = child;
        ts.forEachChild(child, visit);
      }
    };
    ts.forEachChild(file, visit);
    if (!node) return null;
    // The number being used as a list: `x.level` in `x.level[i]` or `x.level.length`.
    let target: import("typescript").Node | undefined;
    // `bricksFor(state.level, w)` where bricksFor wants a LevelSpec: the level, not its number.
    let asItem = false;
    if (code === 2345 && ts.isPropertyAccessExpression(node) && node.parent && ts.isCallExpression(node.parent) && node.parent.arguments.includes(node as any)) {
      target = node;
      asItem = true;
    } else if (ts.isElementAccessExpression(node)) target = node.expression;
    else if (ts.isIdentifier(node) && node.text === "length" && node.parent && ts.isPropertyAccessExpression(node.parent)) target = node.parent.expression;
    else if (ts.isPropertyAccessExpression(node) && node.name.text === "length") target = node.expression;
    if (!target || !ts.isPropertyAccessExpression(target)) return null;
    const checker = program.getTypeChecker();
    if (!(checker.getTypeAtLocation(target).flags & ts.TypeFlags.NumberLike)) return null;
    const name = target.name.text;
    const isList = (type: import("typescript").Type | undefined) => Boolean(type && type.getNumberIndexType());
    const owner = checker.getTypeAtLocation(target.expression);
    const paths: string[] = [];
    const plural = owner.getProperty(`${name}s`);
    if (plural && isList(checker.getTypeOfSymbolAtLocation(plural, target))) paths.push(`${name}s`);
    for (const property of owner.getProperties()) {
      const inner = checker.getTypeOfSymbolAtLocation(property, target);
      if (!(inner.flags & ts.TypeFlags.Object) || isList(inner)) continue;
      const nested = inner.getProperty(`${name}s`);
      if (nested && isList(checker.getTypeOfSymbolAtLocation(nested, target))) paths.push(`${property.name}.${name}s`);
    }
    if (paths.length !== 1) return null;
    const list = `${target.expression.getText(file)}.${paths[0]}`;
    if (asItem) {
      // Only when an item of the list is what the call wants.
      const call = target.parent as import("typescript").CallExpression;
      const signature = checker.getResolvedSignature(call);
      const parameter = signature?.getParameters()[call.arguments.indexOf(target as any)];
      const wanted = parameter ? checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, call)) : "";
      let listType: import("typescript").Type | undefined = owner;
      for (const key of paths[0].split(".")) {
        const property: import("typescript").Symbol | undefined = listType?.getProperty(key);
        listType = property ? checker.getTypeOfSymbolAtLocation(property, target) : undefined;
      }
      const item = listType?.getNumberIndexType();
      if (!item || checker.typeToString(item) !== wanted) return null;
      const replacement = `${list}[${target.getText(file)}]`;
      return { start: target.getStart(file), end: target.getEnd(), text: replacement, note: `${target.getText(file)} is a number; the call wants the item, ${replacement}` };
    }
    return {
      start: target.getStart(file),
      end: target.getEnd(),
      text: list,
      note: `${target.getText(file)} is a number; the list is ${list}`
    };
  }
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
      return { start, end, text: `${call.getText(file)};\n${indentOf(file.text, start)}return ${first.text};`, note: `${call.expression.getText(file)}() changes ${first.text} in place (it does not return the new state): called it, then returned ${first.text}` };
    }
    if (ts.isExpressionStatement(statement) && ts.isBinaryExpression(statement.expression) && statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const { left, right } = statement.expression;
      if (!ts.isCallExpression(right)) return null;
      const first = right.arguments[0];
      if (!first || first.getText(file) !== left.getText(file)) return null;
      return { start, end, text: `${right.getText(file)};`, note: `${right.expression.getText(file)}() changes ${left.getText(file)} in place (it does not return the new state): no longer assigned` };
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

  /**
   * How many type errors the project's own files have, without changing
   * anything: whether code a build inherits compiles. Null when it cannot tell.
   */
  errorCount(folder: string): number | null {
    const root = path.resolve(folder);
    const ts = loadTs();
    const configPath = path.join(root, "tsconfig.json");
    if (!ts || !fs.existsSync(configPath)) return null;
    // Before install every import of a package is an error: that says nothing about the code.
    if (!fs.existsSync(path.join(root, "node_modules"))) return null;
    try {
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      if (read.error) return null;
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
      const src = path.join(root, "src") + path.sep;
      const options = { ...parsed.options, noEmit: true };
      // Types resolve from the project's folder, not from wherever the builder runs.
      const host = ts.createCompilerHost(options);
      host.getCurrentDirectory = () => root;
      const program = ts.createProgram({ rootNames: parsed.fileNames, options, host, projectReferences: parsed.projectReferences });
      return program
        .getSourceFiles()
        .filter((file) => path.resolve(file.fileName).startsWith(src))
        .reduce((sum, file) => sum + program.getSyntacticDiagnostics(file).length + program.getSemanticDiagnostics(file).length, 0);
    } catch {
      return null;
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
          // The same for an action that changes the state in place and returns
          // what happened (move(state) → GameEvent[]): `s = move(s, 1, 0)`.
          if (
            (diagnostic.code === 2322 || diagnostic.code === 2739 || diagnostic.code === 2740) &&
            /Type '(void|\w*Event\[\])' (is not assignable|is missing)/.test(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "))
          ) {
            const edit = AutonomousVoidFix.edit(ts, service.getProgram()?.getSourceFile(fileName), start);
            if (edit) {
              add(path.resolve(fileName), edit);
              notes.push(`${rel}:${line}: ${edit.note}`);
              continue;
            }
          }

          // An empty exported function ("// Implementation of updateGameState")
          // where another of our files exports the real one: the stub goes, and
          // the imports that found it are pointed at the real one next round.
          if (diagnostic.code === 2355) {
            const program = service.getProgram();
            const source = program?.getSourceFile(fileName);
            let stub: import("typescript").FunctionDeclaration | undefined;
            source?.statements.forEach((statement) => {
              if (ts.isFunctionDeclaration(statement) && statement.name && statement.body && statement.body.statements.length === 0 && statement.getStart(source) <= start && statement.getEnd() >= end) stub = statement;
            });
            if (program && source && stub?.name) {
              const name = stub.name.text;
              const checker = program.getTypeChecker();
              const elsewhere = program.getSourceFiles().find((other) => {
                if (other === source || !ours(other.fileName) || /\.(test|spec)\./.test(other.fileName)) return false;
                const symbol = checker.getSymbolAtLocation(other);
                return Boolean(symbol && checker.getExportsOfModule(symbol).some((exported) => exported.name === name));
              });
              if (elsewhere) {
                const from = text.lastIndexOf("\n", stub.getStart(source) - 1) + 1;
                const to = text.indexOf("\n", stub.getEnd());
                add(path.resolve(fileName), { start: from, end: to === -1 ? text.length : to + 1, text: "" });
                notes.push(`${rel}:${line}: removed an empty ${name}(); the real one is in ${path.relative(root, elsewhere.fileName).split(path.sep).join("/")}`);
                continue;
              }
            }
          }

          // `import { newGame } from "./lib/gameLogic"` when only src/engine/game.ts
          // exports newGame: the import goes to the one file of ours that has it.
          if (diagnostic.code === 2305 || diagnostic.code === 2724) {
            const edits = WrongModuleFix.edits(ts, service.getProgram(), fileName, start, ours);
            if (edits) {
              for (const edit of edits.edits) add(path.resolve(fileName), edit);
              notes.push(`${rel}:${line}: ${edits.note}`);
              continue;
            }
          }

          // <GameBoard settings={…} onWon={…} /> when GameBoard (tested code the
          // build started with, in src/engine/) has no onWon: its props are a
          // fixed contract, so what it does not take goes. A component the app
          // wrote itself is left for the model, where adding the prop may be right.
          if (diagnostic.code === 2322) {
            const edits = ExtraPropsFix.edits(ts, service.getProgram(), fileName, start, root);
            if (edits) {
              for (const edit of edits.edits) add(path.resolve(fileName), edit);
              notes.push(`${rel}:${line}: ${edits.note}`);
              continue;
            }
          }

          // `const DEFAULT_SETTINGS = { /* default settings from src/engine/game */ };`
          // — a stand-in for something another file of ours exports for real.
          // The stand-in goes; the next round imports the real one.
          if (diagnostic.code === 2740 || diagnostic.code === 2739 || diagnostic.code === 2741) {
            const program = service.getProgram();
            const source = program?.getSourceFile(fileName);
            // The error sits on the value, or on the attribute or key it is given to: settings={DEFAULT_SETTINGS}.
            let at: import("typescript").Node | undefined;
            const find = (node: import("typescript").Node) => {
              if (node.getStart(source) <= start && node.getEnd() >= end) {
                at = node;
                ts.forEachChild(node, find);
              }
            };
            if (source) ts.forEachChild(source, find);
            let value: import("typescript").Node | undefined = at;
            if (at?.parent && ts.isJsxAttribute(at.parent)) value = at.parent.initializer && ts.isJsxExpression(at.parent.initializer) ? at.parent.initializer.expression : undefined;
            else if (at?.parent && ts.isPropertyAssignment(at.parent) && at.parent.name === at) value = at.parent.initializer;
            else if (at?.parent && ts.isVariableDeclaration(at.parent) && at.parent.name === at) value = at.parent.initializer;
            const name = value && ts.isIdentifier(value) ? value.text : text.slice(start, end).trim();
            let stub: import("typescript").VariableStatement | undefined;
            const visit = (node: import("typescript").Node) => {
              if (ts.isVariableStatement(node)) {
                const only = node.declarationList.declarations.length === 1 ? node.declarationList.declarations[0] : undefined;
                // Empty, or a local copy of one of the engine's constants (DEFAULT_SETTINGS with half its fields).
                const empty = only?.initializer && ts.isObjectLiteralExpression(only.initializer) && only.initializer.properties.length === 0;
                const constantCopy = /^[A-Z][A-Z0-9_]+$/.test(name) && !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
                if (only && ts.isIdentifier(only.name) && only.name.text === name && only.initializer && (empty || constantCopy)) stub = node;
              }
              ts.forEachChild(node, visit);
            };
            if (source && /^[A-Za-z_$][\w$]*$/.test(name)) ts.forEachChild(source, visit);
            const checker = program?.getTypeChecker();
            const real =
              stub && program && checker
                ? program.getSourceFiles().find((other) => {
                    if (other === source || !ours(other.fileName)) return false;
                    const symbol = checker.getSymbolAtLocation(other);
                    return Boolean(symbol && checker.getExportsOfModule(symbol).some((exported) => exported.name === name));
                  })
                : undefined;
            // A filled-in copy is only replaced by the engine's own (tested) constant, never by another file the model wrote.
            const fromEngine = real ? path.relative(root, real.fileName).split(path.sep).join("/").startsWith("src/engine/") : false;
            const isEmpty = stub?.declarationList.declarations[0]?.initializer && ts.isObjectLiteralExpression(stub.declarationList.declarations[0].initializer) && stub.declarationList.declarations[0].initializer.properties.length === 0;
            if (stub && source && real && (isEmpty || fromEngine)) {
              const from = text.lastIndexOf("\n", stub.getStart(source) - 1) + 1;
              const to = text.indexOf("\n", stub.getEnd());
              add(path.resolve(fileName), { start: from, end: to === -1 ? text.length : to + 1, text: "" });
              notes.push(`${rel}:${line}: removed an empty stand-in for ${name}; the real one is in ${path.relative(root, real.fileName).split(path.sep).join("/")}`);
              continue;
            }

            // A test's hand-made object a field or two short ({ …a battle without
            // xp and gold }): the missing fields get plain values (0, "", false, [],
            // the first allowed word). Only in tests, and only for plain fields:
            // app code that leaves a field out is the model's to fix.
            const literal = value && ts.isObjectLiteralExpression(value) ? value : at && ts.isObjectLiteralExpression(at) ? at : undefined;
            if (literal && source && checker && /\.test\.tsx?$/.test(fileName)) {
              const contextual = checker.getContextualType(literal);
              const expected = contextual ? checker.getNonNullableType(contextual) : undefined;
              const given = new Set(literal.properties.map((property) => property.name?.getText(source)));
              const plain = (type: import("typescript").Type): string | undefined => {
                if (type.isUnion()) {
                  if (type.types.some((part) => part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))) return "null";
                  const first = type.types.find((part) => part.isStringLiteral() || part.isNumberLiteral());
                  if (first) return JSON.stringify((first as import("typescript").LiteralType).value);
                  if (type.types.every((part) => part.flags & ts.TypeFlags.BooleanLiteral)) return "false";
                  return undefined;
                }
                if (type.flags & ts.TypeFlags.Number) return "0";
                if (type.flags & ts.TypeFlags.String) return '""';
                if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) return "false";
                if (type.isStringLiteral() || type.isNumberLiteral()) return JSON.stringify(type.value);
                if (checker.isArrayType(type)) return "[]";
                return undefined;
              };
              const missing = (expected?.getProperties() ?? []).filter((property) => !given.has(property.name) && !(property.flags & ts.SymbolFlags.Optional));
              const filled = missing.map((property) => ({ name: property.name, value: plain(checker.getTypeOfSymbolAtLocation(property, literal)) }));
              if (filled.length > 0 && filled.length <= 6 && filled.every((field) => field.value !== undefined)) {
                const list = literal.properties;
                const after = list.length ? list[list.length - 1].getEnd() : literal.getStart(source) + 1;
                const lead = list.length ? ", " : " ";
                add(path.resolve(fileName), { start: after, end: after, text: `${lead}${filled.map((field) => `${field.name}: ${field.value}`).join(", ")}` });
                notes.push(`${rel}:${line}: gave the test's object its missing ${filled.map((field) => field.name).join(", ")}`);
                continue;
              }
              // Fields that are not plain (colors: { wall, floor, … }), or a hero
              // copied from the settings' starting stats: the test's object starts
              // from what the engine makes (DEFAULT_SETTINGS, newGame(…).hero),
              // and its own fields win.
              const typeName = expected?.aliasSymbol?.name ?? expected?.getSymbol()?.name;
              const exported = new Map<string, { file: string; type: import("typescript").Type; kind: "const" | "function" }>();
              for (const other of typeName && program && missing.length > 0 ? program.getSourceFiles() : []) {
                if (!ours(other.fileName) || /\.test\.tsx?$/.test(other.fileName)) continue;
                for (const statement of other.statements) {
                  if (!(ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))) continue;
                  if (ts.isFunctionDeclaration(statement) && statement.name) exported.set(statement.name.text, { file: other.fileName, type: checker.getTypeAtLocation(statement.name), kind: "function" });
                  if (!ts.isVariableStatement(statement)) continue;
                  for (const declaration of statement.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name)) exported.set(declaration.name.text, { file: other.fileName, type: checker.getTypeAtLocation(declaration.name), kind: "const" });
                  }
                }
              }
              const named = (type: import("typescript").Type) => type.aliasSymbol?.name ?? type.getSymbol()?.name;
              let base: { text: string; uses: string[] } | undefined;
              for (const [name, entry] of exported) {
                if (/^DEFAULT_/.test(name) && entry.kind === "const" && named(entry.type) === typeName) base = { text: name, uses: [name] };
              }
              // A type the game state holds (GameState.hero: Hero): newGame(DEFAULT_SETTINGS).hero.
              const newGame = exported.get("newGame");
              const settingsName = Array.from(exported.keys()).find((name) => /^DEFAULT_SETTINGS$/.test(name));
              if (!base && newGame?.kind === "function" && settingsName) {
                const made = newGame.type.getCallSignatures()[0]?.getReturnType();
                const field = made?.getProperties().find((property) => named(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(property, literal))) === typeName);
                if (field) base = { text: `newGame(${settingsName}).${field.name}`, uses: ["newGame", settingsName] };
              }
              const startsFrom = literal.properties[0] && ts.isSpreadAssignment(literal.properties[0]) && literal.properties[0].expression.getText(source) === base?.text;
              if (base && !startsFrom) {
                add(path.resolve(fileName), { start: literal.getStart(source) + 1, end: literal.getStart(source) + 1, text: ` ...${base.text},` });
                const importedNames = new Set(
                  source.statements.flatMap((statement) =>
                    ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
                      ? statement.importClause.namedBindings.elements.map((element) => element.name.text)
                      : []
                  )
                );
                for (const use of base.uses.filter((name) => !importedNames.has(name))) {
                  let specifier = path.relative(path.dirname(fileName), exported.get(use)!.file).split(path.sep).join("/").replace(/\.tsx?$/, "");
                  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
                  add(path.resolve(fileName), { start: 0, end: 0, text: `import { ${use} } from "${specifier}";\n` });
                }
                notes.push(`${rel}:${line}: the test's ${typeName} starts from ${base.text} (it was missing ${missing.map((property) => property.name).join(", ")})`);
                continue;
              }
            }
          }

          // `const state: GameState = { …, hero: { ...state.settings.hero } }` in a
          // test: the object read from itself before it existed. The spread goes
          // (the object's own fields, or the engine's start, fill it).
          if ((diagnostic.code === 2448 || diagnostic.code === 2454) && /\.test\.tsx?$/.test(fileName)) {
            const source = service.getProgram()?.getSourceFile(fileName);
            let spread: import("typescript").SpreadAssignment | undefined;
            const visit = (node: import("typescript").Node) => {
              if (node.getStart(source) <= start && node.getEnd() >= end) {
                if (ts.isSpreadAssignment(node)) spread = node;
                ts.forEachChild(node, visit);
              }
            };
            if (source) ts.forEachChild(source, visit);
            const literal = spread && ts.isObjectLiteralExpression(spread.parent) ? spread.parent : undefined;
            if (spread && literal && source) {
              const list = literal.properties;
              const index = list.indexOf(spread);
              let from = spread.getFullStart();
              let to = spread.getEnd();
              if (index < list.length - 1) to = list[index + 1].getFullStart();
              else if (index > 0) from = list[index - 1].getEnd();
              else if (list.hasTrailingComma) to = text.indexOf(",", to) + 1;
              add(path.resolve(fileName), { start: from, end: to, text: "" });
              notes.push(`${rel}:${line}: removed ${spread.getText(source)}, read before it was made`);
              continue;
            }
          }

          // `import { ScoreEntry } from "../engine/scores"` in ScoreEntry.tsx, whose
          // component is also ScoreEntry: the imported one is only a type, so
          // the import says so and both names live side by side.
          if (diagnostic.code === 2865) {
            const source = service.getProgram()?.getSourceFile(fileName);
            let specifier: import("typescript").ImportSpecifier | undefined;
            const visit = (node: import("typescript").Node) => {
              if (node.getStart(source) <= start && node.getEnd() >= end) {
                if (ts.isImportSpecifier(node)) specifier = node;
                ts.forEachChild(node, visit);
              }
            };
            if (source) ts.forEachChild(source, visit);
            if (specifier && source && !specifier.isTypeOnly && !specifier.parent.parent.isTypeOnly) {
              add(path.resolve(fileName), { start: specifier.getStart(source), end: specifier.getStart(source), text: "type " });
              notes.push(`${rel}:${line}: ${specifier.name.text} is imported as a type`);
              continue;
            }
          }

          // `let battle = { ...state.battle }` where state.battle may be null:
          // every field turns optional, `battle = null` and `battle: battle` stop
          // compiling, and at run time a missing battle becomes {}. The copy
          // keeps the null: `state.battle ? { ...state.battle } : null`.
          if (diagnostic.code === 2322 || diagnostic.code === 2345) {
            const program = service.getProgram();
            const source = program?.getSourceFile(fileName);
            const checker = program?.getTypeChecker();
            let at: import("typescript").Node | undefined;
            const find = (node: import("typescript").Node) => {
              if (node.getStart(source) <= start && node.getEnd() >= end) {
                at = node;
                ts.forEachChild(node, find);
              }
            };
            if (source) ts.forEachChild(source, find);
            const node = at as import("typescript").Node | undefined;
            let id = node && ts.isIdentifier(node) ? node : undefined;
            if (id && node!.parent && ts.isPropertyAssignment(node!.parent) && node!.parent.name === node) id = ts.isIdentifier(node!.parent.initializer) ? node!.parent.initializer : undefined;
            const declaration = id && checker ? checker.getSymbolAtLocation(id)?.valueDeclaration : undefined;
            const copy =
              declaration && ts.isVariableDeclaration(declaration) && !declaration.type && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)
                ? declaration.initializer
                : undefined;
            const spread = copy?.properties.length === 1 && ts.isSpreadAssignment(copy.properties[0]) ? copy.properties[0].expression : undefined;
            const spreadType = spread && checker ? checker.getTypeAtLocation(spread) : undefined;
            const empty = spreadType?.isUnion() ? spreadType.types.find((part) => part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) : undefined;
            if (copy && spread && empty && source && copy.getSourceFile() === source) {
              const written = spread.getText(source);
              add(path.resolve(fileName), { start: copy.getStart(source), end: copy.getEnd(), text: `${written} ? { ...${written} } : ${empty.flags & ts.TypeFlags.Null ? "null" : "undefined"}` });
              notes.push(`${rel}:${line}: the copy of ${written} keeps its ${empty.flags & ts.TypeFlags.Null ? "null" : "undefined"}`);
              continue;
            }
          }

          // { width: 70, radius: 6 } where the type says w and r: an object literal's
          // key spelled out where the type uses its first letter.
          if (diagnostic.code === 2353) {
            const program = service.getProgram();
            const source = program?.getSourceFile(fileName);
            const written = text.slice(start, end);
            let literal: import("typescript").ObjectLiteralExpression | undefined;
            const visit = (node: import("typescript").Node) => {
              if (node.getStart(source) <= start && node.getEnd() >= end) {
                if (ts.isObjectLiteralExpression(node)) literal = node;
                ts.forEachChild(node, visit);
              }
            };
            if (source) ts.forEachChild(source, visit);
            const expected = literal && program ? program.getTypeChecker().getContextualType(literal) : undefined;
            const short = written[0];
            const taken = new Set(literal?.properties.map((property) => property.name?.getText(source)) ?? []);
            if (expected && written.length > 1 && /^[A-Za-z_$][\w$]*$/.test(written) && expected.getProperty(short) && !taken.has(short)) {
              add(path.resolve(fileName), { start, end, text: short });
              notes.push(`${rel}:${line}: ${written} is called ${short} here`);
              continue;
            }
          }

          // `return { ...state, scores, place }` or addScore({ …, at }) where the
          // type has no such field: an RPG build carried both through every
          // repair. The type cannot hold the value, so the property goes; code
          // that reads it back fails on its own line, where it can be seen. A
          // near-miss spelling ("Did you mean 'score'?") goes only when the
          // right field is already given (by a spread or by name): otherwise the
          // spelling fix is the better one.
          if (diagnostic.code === 2353 || diagnostic.code === 2561) {
            const program = service.getProgram();
            const source = program?.getSourceFile(fileName);
            let property: import("typescript").PropertyAssignment | import("typescript").ShorthandPropertyAssignment | undefined;
            const visit = (node: import("typescript").Node) => {
              if (node.getStart(source) <= start && node.getEnd() >= end) {
                if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && node.name.getStart(source) === start) property = node;
                ts.forEachChild(node, visit);
              }
            };
            if (source) ts.forEachChild(source, visit);
            const literal = property && ts.isObjectLiteralExpression(property.parent) ? property.parent : undefined;
            const meant = /Did you mean to write '([^']+)'/.exec(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))?.[1];
            const given = Boolean(
              literal && meant && literal.properties.some((other) => ts.isSpreadAssignment(other) || other.name?.getText(source) === meant)
            );
            if (property && literal && source && (diagnostic.code === 2353 || given)) {
              const list = literal.properties;
              const index = list.indexOf(property);
              let from = property.getFullStart();
              let to = property.getEnd();
              if (index < list.length - 1) to = list[index + 1].getFullStart();
              else if (index > 0) from = list[index - 1].getEnd();
              else if (list.hasTrailingComma) to = text.indexOf(",", to) + 1;
              add(path.resolve(fileName), { start: from, end: to, text: "" });
              notes.push(`${rel}:${line}: dropped ${property.name.getText(source)}, which the type has no field for`);
              continue;
            }
          }

          // Three a live RPG build carried for a whole pass, each settled by the types:
          //  - `import GameBoard from './engine/play'` where play exports GameBoard by name;
          //  - `Status.Playing` where Status is "ready" | "playing" | …: the word is the value;
          //  - `state.chestGold` where it is `state.settings.chestGold`.
          {
            const program = service.getProgram();
            const source = program?.getSourceFile(fileName);
            const checker = program?.getTypeChecker();
            let at: import("typescript").Node | undefined;
            const find = (node: import("typescript").Node) => {
              if (node.getStart(source) <= start && node.getEnd() >= end) {
                at = node;
                ts.forEachChild(node, find);
              }
            };
            if (source) ts.forEachChild(source, find);

            if (diagnostic.code === 2613 && source && at && checker) {
              const declaration = source.statements.find(
                (s): s is import("typescript").ImportDeclaration => ts.isImportDeclaration(s) && s.getStart(source) <= start && s.getEnd() >= end
              );
              const name = declaration?.importClause?.name?.text;
              const target = declaration && checker.getSymbolAtLocation(declaration.moduleSpecifier);
              if (declaration && name && target && checker.getExportsOfModule(target).some((exported) => exported.name === name)) {
                const clause = declaration.importClause!;
                const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map((e) => e.getText(source)) : [];
                add(path.resolve(fileName), { start: clause.getStart(source), end: clause.getEnd(), text: `{ ${[name, ...named].join(", ")} }` });
                notes.push(`${rel}:${line}: ${name} is a named export; imported by name`);
                continue;
              }
            }

            if (diagnostic.code === 2693 && at && checker && at.parent && ts.isPropertyAccessExpression(at.parent) && at.parent.expression === at) {
              const access = at.parent;
              // A type used as a value has no value type: read the type it declares.
              const typeName = at.getText(source);
              let symbol = checker.getSymbolsInScope(at, ts.SymbolFlags.Type | ts.SymbolFlags.Alias).find((candidate) => candidate.name === typeName);
              if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
              const type = symbol ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeAtLocation(at);
              const literals = (type.isUnion() ? type.types : [type]).filter((t) => t.isStringLiteral()).map((t) => (t as import("typescript").StringLiteralType).value);
              const flat = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");
              const match = literals.filter((value) => flat(value) === flat(access.name.text));
              if (match.length === 1) {
                add(path.resolve(fileName), { start: access.getStart(source), end: access.getEnd(), text: JSON.stringify(match[0]) });
                notes.push(`${rel}:${line}: ${access.getText(source)} is the word ${JSON.stringify(match[0])} (${at.getText(source)} is a list of words, not an enum)`);
                continue;
              }
            }

            if (diagnostic.code === 2339 && at && checker && at.parent && ts.isPropertyAccessExpression(at.parent) && at.parent.name === at) {
              const access = at.parent;
              const owner = checker.getTypeAtLocation(access.expression);
              const wanted = access.name.text;
              const homes = owner.getProperties().filter((property) => {
                const inner = checker.getTypeOfSymbolAtLocation(property, access);
                return Boolean(inner.flags & ts.TypeFlags.Object) && !inner.getNumberIndexType() && Boolean(inner.getProperty(wanted));
              });
              if (homes.length === 1) {
                add(path.resolve(fileName), { start: access.name.getStart(source), end: access.name.getStart(source), text: `${homes[0].name}.` });
                notes.push(`${rel}:${line}: ${wanted} lives in ${access.expression.getText(source)}.${homes[0].name}`);
                continue;
              }
            }
          }

          // A number used as a list ("can't be used to index type 'Number'", "'length' does not exist on type 'number'").
          if (diagnostic.code === 7053 || diagnostic.code === 2339 || diagnostic.code === 2345) {
            const edit = NumberAsListFix.edit(ts, service.getProgram(), service.getProgram()?.getSourceFile(fileName), start, end, diagnostic.code);
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
