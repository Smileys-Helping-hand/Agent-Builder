/**
 * AutoFix — the mistakes a small model makes over and over, fixed without
 * asking it. Run before every check on generated apps (never on a project the
 * user owns). Each fix is narrow and safe to repeat.
 *
 *  - Jest in a Vitest project: `jest.fn()` and friends become `vi.fn()`, and a
 *    test file that uses describe/it/expect without importing them (Vitest has
 *    no globals unless configured) gets the import.
 *  - A package imported in src/ but missing from package.json is added, so
 *    `npm install` fetches it instead of the typecheck failing on it.
 *  - A relative import pointing at the wrong folder is pointed at the one file
 *    in src/ it must mean.
 */
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { builtinModules, createRequire } from "module";
import { CodeGuard } from "./CodeGuard.js";

let typescriptModule: typeof import("typescript") | null | undefined;
/** TypeScript's parser, for the fixes a regular expression would get wrong. */
const loadTypeScript = (): typeof import("typescript") | null => {
  if (typescriptModule === undefined) {
    try {
      typescriptModule = createRequire(import.meta.url)("typescript");
    } catch {
      typescriptModule = null;
    }
  }
  return typescriptModule ?? null;
};

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const TEST_FILE = /\.(test|spec)\.(t|j)sx?$/;
const SOURCE_FILE = /\.(t|j)sx?$/;
const VITEST_GLOBALS = ["describe", "it", "test", "expect", "vi", "beforeEach", "afterEach", "beforeAll", "afterAll"];
/** Packages a test may import that belong in devDependencies. */
const DEV_PACKAGES = /^(@testing-library\/|vitest$|@vitest\/|jsdom$|happy-dom$|@types\/)/;

const listFiles = async (dir: string): Promise<string[]> => {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
};

/** "react-dom/client" -> "react-dom", "@scope/pkg/sub" -> "@scope/pkg". */
const packageName = (specifier: string): string | null => {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/") || specifier.startsWith("~/")) return null;
  if (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(specifier.split("/")[0])) return null;
  if (/^(virtual:|vite\/|\w+:)/.test(specifier) && !specifier.startsWith("@")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null) : parts[0];
};

/**
 * Packages that only run on a server (native code, the file system, a
 * database), with what a browser app uses instead. A small model reaches for
 * `canvas` to draw a game; the browser has <canvas> built in.
 */
export const SERVER_ONLY = new Map<string, string>([
  ["canvas", "the browser's own <canvas> element (canvasRef.current.getContext('2d'))"],
  ["node-canvas", "the browser's own <canvas> element"],
  ["sharp", "an <img> or <canvas> in the page"],
  ["sqlite3", "localStorage (or IndexedDB) in the browser"],
  ["better-sqlite3", "localStorage (or IndexedDB) in the browser"],
  ["fs-extra", "localStorage in the browser; there is no file system"],
  ["express", "nothing: this app runs in the browser and has no server"],
  ["cors", "nothing: this app runs in the browser and has no server"],
  ["body-parser", "nothing: this app runs in the browser and has no server"],
  ["mongoose", "localStorage in the browser"],
  ["pg", "localStorage in the browser"],
  ["mysql2", "localStorage in the browser"],
  ["bcrypt", "the browser's crypto.subtle"],
  ["puppeteer", "nothing: tests use Vitest and Testing Library"],
  ["node-fetch", "the browser's built-in fetch"],
  ["dotenv", "import.meta.env (Vite)"],
  ["nodemailer", "a mailto: link or a form the site owner receives"]
]);

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".d.ts"];
const posix = (value: string) => value.replace(/\\/g, "/");
/** Relative import specifiers in a file: `from "./x"`, `import("./x")`, `import "./x.css"`. */
const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)(["'])(\.{1,2}\/[^"']+)\1/g;

/** Whether a relative specifier points at a file that exists (with any of the usual extensions). */
const resolves = (known: Set<string>, fromFile: string, specifier: string): boolean => {
  const base = posix(path.join(path.dirname(fromFile), specifier));
  if (known.has(base)) return true;
  return RESOLVE_EXTENSIONS.some((ext) => known.has(base + ext) || known.has(`${base}/index${ext}`));
};

/** The specifier without its leading ./ and ../ steps: "../lib/gameLogic" -> "lib/gameLogic". */
const importKey = (specifier: string) => specifier.replace(/^(\.\.?\/)+/, "").replace(/\.(t|j)sx?$/, "");

/** Names a file imports from `specifier`: `import A, { b, c as d } from "…"` -> A, b, c. */
const importedNames = (text: string, specifier: string): string[] => {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names: string[] = [];
  for (const match of text.matchAll(new RegExp(`import\\s+(type\\s+)?([^;]*?)\\s+from\\s+["']${escaped}["']`, "g"))) {
    const clause = match[2];
    const defaultName = /^([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (defaultName) names.push(`${defaultName} (default export)`);
    const braces = /\{([^}]*)\}/.exec(clause)?.[1];
    for (const part of braces?.split(",") ?? []) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
  }
  return names;
};

/** The file a relative specifier means, the way TypeScript picks it (.ts before .tsx), or null. */
const resolveFile = (known: Set<string>, fromFile: string, specifier: string): string | null => {
  const base = posix(path.join(path.dirname(fromFile), specifier));
  if (known.has(base)) return base;
  for (const ext of RESOLVE_EXTENSIONS) if (known.has(base + ext)) return base + ext;
  for (const ext of RESOLVE_EXTENSIONS) if (known.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  return null;
};

/** What a module exports: its named exports, and the local name of its default export if it has one. */
const exportsOf = (text: string): { named: Set<string>; defaultName: string | null; hasDefault: boolean } => {
  const named = new Set<string>();
  for (const m of text.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) named.add(m[1]);
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()?.trim();
      if (name && name !== "default") named.add(name);
    }
  }
  const defaultName =
    /export\s+default\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/.exec(text)?.[1] ??
    /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m.exec(text)?.[1] ??
    null;
  return { named, defaultName, hasDefault: /export\s+default\b/.test(text) };
};

/** Every `import … from "<relative>"` statement in a file, with its parts. */
const IMPORT_STATEMENT = /import\s+(type\s+)?([A-Za-z_$][\w$]*)?\s*,?\s*(\{[^}]*\})?\s*from\s+(["'])(\.{1,2}\/[^"']+)\4;?/g;
/** String.replace with an async replacer. */
const replaceAsync = async (text: string, pattern: RegExp, replacer: (...groups: any[]) => Promise<string>): Promise<string> => {
  const parts: Promise<string>[] = [];
  text.replace(pattern, (...groups: any[]) => {
    parts.push(replacer(...groups));
    return groups[0];
  });
  const done = await Promise.all(parts);
  let index = 0;
  return text.replace(pattern, () => done[index++]);
};

const braceNames = (braces: string | undefined): string[] =>
  (braces ?? "")
    .replace(/[{}]/g, "")
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim())
    .filter((name): name is string => Boolean(name));

export const AutoFix = {
  /**
   * src/Game.ts (logic) beside src/Game.tsx (screen): "./Game" always means
   * the .ts, so the screen can never be imported. Move the .ts to
   * src/Game.logic.ts and point at it every import that wants what it exports.
   */
  async splitNameClashes(root: string): Promise<string[]> {
    const notes: string[] = [];
    const all = (await listFiles(path.join(root, "src"))).map((file) => posix(path.relative(root, file)));
    const known = new Set(all);
    for (const ts of all.filter((file) => /\.ts$/.test(file) && !file.endsWith(".d.ts") && !TEST_FILE.test(file))) {
      const bare = ts.slice(0, -3);
      // game.ts beside Game.tsx clashes too: Windows resolves names without regard to case.
      const twin = all.find((file) => file.toLowerCase() === `${bare}.tsx`.toLowerCase());
      if (!twin || known.has(`${bare}.logic.ts`)) continue;
      const logic = exportsOf(await fs.readFile(path.join(root, ts), "utf8"));
      const target = `${bare}.logic.ts`;
      for (const rel of all.filter((file) => SOURCE_FILE.test(file) && file !== ts)) {
        const full = path.join(root, rel);
        const text = await fs.readFile(full, "utf8");
        const updated = text.replace(IMPORT_STATEMENT, (whole, typeOnly, defaultName, braces, quote, specifier) => {
          if (resolveFile(known, rel, specifier) !== ts) return whole;
          const names = braceNames(braces);
          if (defaultName || names.length === 0 || !names.every((name) => logic.named.has(name))) return whole;
          let fixed = posix(path.relative(path.dirname(rel), target.replace(/\.ts$/, "")));
          if (!fixed.startsWith(".")) fixed = `./${fixed}`;
          return whole.replace(`${quote}${specifier}${quote}`, `${quote}${fixed}${quote}`);
        });
        if (updated !== text) await fs.writeFile(full, updated, "utf8");
      }
      await fs.rename(path.join(root, ts), path.join(root, target));
      known.delete(ts);
      known.add(target);
      notes.push(`${ts} moved to ${target}: it shared its name with ${twin}, so the screen could never be imported`);
    }
    return notes;
  },

  /**
   * `import { Game } from "./Game"` when Game.tsx has `export default Game`
   * and no named export: the model's other favourite. Becomes a default import.
   */
  async fixDefaultImports(root: string): Promise<string[]> {
    const notes: string[] = [];
    const all = (await listFiles(path.join(root, "src"))).map((file) => posix(path.relative(root, file)));
    const known = new Set(all);
    const cache = new Map<string, ReturnType<typeof exportsOf>>();
    for (const rel of all.filter((file) => SOURCE_FILE.test(file) && !file.endsWith(".d.ts"))) {
      const full = path.join(root, rel);
      const text = await fs.readFile(full, "utf8");
      const updated = await replaceAsync(text, IMPORT_STATEMENT, async (whole, typeOnly, defaultName, braces, quote, specifier) => {
        if (typeOnly || defaultName) return whole;
        const names = braceNames(braces);
        if (names.length !== 1 || /\sas\s/.test(braces ?? "")) return whole;
        const target = resolveFile(known, rel, specifier);
        if (!target || !SOURCE_FILE.test(target)) return whole;
        let info = cache.get(target);
        if (!info) {
          info = exportsOf(await fs.readFile(path.join(root, target), "utf8"));
          cache.set(target, info);
        }
        const [name] = names;
        if (info.named.has(name) || !info.hasDefault || (info.defaultName && info.defaultName !== name)) return whole;
        notes.push(`${rel}: import { ${name} } from "${specifier}" is its default export; imported as one`);
        return `import ${name} from ${quote}${specifier}${quote};`;
      });
      if (updated !== text) await fs.writeFile(full, updated, "utf8");
    }
    return notes;
  },

  /**
   * Two mistakes that type-check and blank the page:
   *  - a hook called at the top of a module, outside any component
   *    (`const [page, setPage] = useState('Home')` above `function App`) —
   *    React throws "Cannot read properties of null (reading 'useState')" on
   *    load. Moved into the file's default-exported component;
   *  - a test helper called by the app itself (`renderAt(<App />)` at the
   *    bottom of App.tsx) — removed from app code; tests keep it.
   */
  async fixHooksOutsideComponents(root: string): Promise<string[]> {
    const ts = loadTypeScript();
    if (!ts) return [];
    const notes: string[] = [];
    const all = (await listFiles(path.join(root, "src"))).map((file) => posix(path.relative(root, file)));
    for (const rel of all.filter((file) => /\.(t|j)sx$/.test(file) && !TEST_FILE.test(file) && !/(^|\/)lib\/testing\./.test(file))) {
      const full = path.join(root, rel);
      const text = await fs.readFile(full, "utf8");
      const source = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
      const isHookCall = (node: import("typescript").Node | undefined): boolean =>
        Boolean(node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use[A-Z]\w*$/.test(node.expression.text));
      const hookStatements: import("typescript").Statement[] = [];
      const helperCalls: import("typescript").Statement[] = [];
      for (const statement of source.statements) {
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((d) => isHookCall(d.initializer))) hookStatements.push(statement);
        if (ts.isExpressionStatement(statement) && isHookCall(statement.expression)) hookStatements.push(statement);
        if (
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          ts.isIdentifier(statement.expression.expression) &&
          /^(renderAt|render)$/.test(statement.expression.expression.text)
        ) {
          helperCalls.push(statement);
        }
      }
      if (hookStatements.length === 0 && helperCalls.length === 0) continue;

      // The component to move hooks into: `export default function X() {…}`, or
      // `export default X` naming a function or arrow component in this file.
      let body: import("typescript").Block | undefined;
      for (const statement of source.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.body && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) body = statement.body;
      }
      const defaultName = source.statements
        .filter(ts.isExportAssignment)
        .map((statement) => (ts.isIdentifier(statement.expression) ? statement.expression.text : null))
        .find(Boolean);
      if (!body && defaultName) {
        for (const statement of source.statements) {
          if (ts.isFunctionDeclaration(statement) && statement.name?.text === defaultName && statement.body) body = statement.body;
          if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
              const init = declaration.initializer;
              if (ts.isIdentifier(declaration.name) && declaration.name.text === defaultName && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) body = init.body;
            }
          }
        }
      }

      const edits: Array<{ start: number; end: number; text: string }> = [];
      // A removed statement takes its whole line with it, trailing comment included.
      const lineStart = (start: number) => text.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = (end: number) => {
        const newline = text.indexOf("\n", end);
        return newline === -1 ? text.length : newline + 1;
      };
      if (body && hookStatements.length > 0) {
        const moved = hookStatements.map((statement) => `  ${statement.getText(source)}`).join("\n");
        edits.push({ start: body.getStart(source) + 1, end: body.getStart(source) + 1, text: `\n${moved}` });
        for (const statement of hookStatements) edits.push({ start: lineStart(statement.getStart(source)), end: lineEnd(statement.getEnd()), text: "" });
        notes.push(`${rel}: moved ${hookStatements.length} hook call${hookStatements.length === 1 ? "" : "s"} from the top of the file into its component (a hook outside a component crashes the page)`);
      }
      for (const statement of helperCalls) {
        edits.push({ start: lineStart(statement.getStart(source)), end: lineEnd(statement.getEnd()), text: "" });
        notes.push(`${rel}: removed ${statement.getText(source).slice(0, 40)} (a test helper, called by the app itself)`);
      }
      if (edits.length === 0) continue;
      let out = text;
      for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
      await fs.writeFile(full, out, "utf8");
    }
    return notes;
  },

  /**
   * `useState(…)` in a component that never imported it: add the hooks to its
   * React import (or a new one). Only React's own hooks, only when nothing in
   * the file declares that name.
   */
  async addMissingReactImports(root: string): Promise<string[]> {
    const HOOKS = ["useState", "useEffect", "useRef", "useCallback", "useMemo", "useReducer", "useContext", "useLayoutEffect", "useId"];
    const notes: string[] = [];
    const all = (await listFiles(path.join(root, "src"))).map((file) => posix(path.relative(root, file)));
    for (const rel of all.filter((file) => /\.(t|j)sx?$/.test(file) && !file.endsWith(".d.ts"))) {
      const full = path.join(root, rel);
      const text = await fs.readFile(full, "utf8");
      const missing = HOOKS.filter(
        (hook) =>
          new RegExp(`(^|[^\\w.])${hook}\\s*[<(]`).test(text) &&
          !new RegExp(`\\b(import[^;]*\\b${hook}\\b|(const|let|var|function)\\s+${hook}\\b)`).test(text)
      );
      if (missing.length === 0) continue;
      const reactNamed = /import\s+(\w+\s*,\s*)?\{([^}]*)\}\s*from\s*["']react["'];?/.exec(text);
      let updated: string;
      if (reactNamed) {
        const names = reactNamed[2].split(",").map((name) => name.trim()).filter(Boolean);
        updated = text.replace(reactNamed[0], reactNamed[0].replace(`{${reactNamed[2]}}`, `{ ${[...names, ...missing].join(", ")} }`));
      } else {
        updated = `import { ${missing.join(", ")} } from "react";\n${text}`;
      }
      await fs.writeFile(full, updated, "utf8");
      notes.push(`${rel}: uses ${missing.join(", ")} without importing ${missing.length === 1 ? "it" : "them"}; imported from react`);
    }
    return notes;
  },

  /**
   * `<Save />` in App.tsx with no import of Save, while src/Save.tsx exists:
   * add the import. Only for a capitalised tag nothing in the file declares,
   * and only when exactly one component file has that name.
   */
  async addMissingComponentImports(root: string): Promise<string[]> {
    const notes: string[] = [];
    const all = (await listFiles(path.join(root, "src"))).map((file) => posix(path.relative(root, file)));
    const components = new Map<string, string[]>();
    for (const file of all.filter((f) => /\.(t|j)sx$/.test(f) && !TEST_FILE.test(f))) {
      const name = /([A-Z][\w$]*)(?:\/index)?\.(t|j)sx$/.exec(file)?.[1];
      if (name) components.set(name, [...(components.get(name) ?? []), file]);
    }
    for (const rel of all.filter((file) => /\.(t|j)sx$/.test(file))) {
      const full = path.join(root, rel);
      const text = await fs.readFile(full, "utf8");
      const used = new Set(Array.from(text.matchAll(/<([A-Z][\w$]*)[\s/>]/g)).map((m) => m[1]));
      const additions: string[] = [];
      for (const name of used) {
        const declared = new RegExp(
          `(import\\s+${name}\\b|import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}|import\\s+[\\w$]+\\s*,\\s*\\{[^}]*\\b${name}\\b|(const|let|var|function|class|enum|type|interface)\\s+${name}\\b)`
        ).test(text);
        if (declared) continue;
        const files = (components.get(name) ?? []).filter((file) => file !== rel);
        if (files.length !== 1) continue;
        const info = exportsOf(await fs.readFile(path.join(root, files[0]), "utf8"));
        let specifier = posix(path.relative(path.dirname(rel), files[0].replace(/(\/index)?\.(t|j)sx$/, "")));
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        if (info.hasDefault && (!info.defaultName || info.defaultName === name)) additions.push(`import ${name} from "${specifier}";`);
        else if (info.named.has(name)) additions.push(`import { ${name} } from "${specifier}";`);
        else continue;
        notes.push(`${rel}: uses <${name} /> without importing it; imported from ${files[0]}`);
      }
      if (additions.length === 0) continue;
      // After the last import, so the file still reads top to bottom.
      const lastImport = Array.from(text.matchAll(/^import[^\n]*(?:\n(?!import)[^\n]*?from\s+["'][^"']+["'];?)?$/gm)).pop();
      const at = lastImport ? (lastImport.index ?? 0) + lastImport[0].length : 0;
      await fs.writeFile(full, `${text.slice(0, at)}${at ? "\n" : ""}${additions.join("\n")}${at ? "" : "\n"}${text.slice(at)}`, "utf8");
    }
    return notes;
  },

  /**
   * The model's commonest compile error on a fresh app: an import of a file
   * that is not where the import says — "../lib/x" from src/App.tsx when the
   * file is src/lib/x.ts. When exactly one file in src/ matches, point the
   * import at it.
   */
  async fixImportPaths(root: string): Promise<string[]> {
    const notes: string[] = [];
    const all = (await listFiles(path.join(root, "src"))).map((file) => posix(path.relative(root, file)));
    const known = new Set(all);
    for (const rel of all.filter((file) => SOURCE_FILE.test(file) && !file.endsWith(".d.ts"))) {
      const full = path.join(root, rel);
      let text = await fs.readFile(full, "utf8");
      const original = text;
      for (const match of Array.from(text.matchAll(RELATIVE_IMPORT))) {
        const specifier = match[2];
        if (resolves(known, rel, specifier)) continue;
        const key = importKey(specifier);
        const candidates = all.filter((file) => {
          const bare = file.replace(/(\/index)?\.(d\.)?(t|j)sx?$|(\.(css|scss|json|svg|png))$/, (whole, _index, _d, _tj, asset) => asset ?? "");
          return bare === `src/${key}` || bare.endsWith(`/${key}`);
        });
        if (candidates.length !== 1) continue;
        const target = candidates[0].replace(/(\/index)?\.(d\.)?(t|j)sx?$/, "");
        let fixed = posix(path.relative(path.dirname(rel), target));
        if (!fixed.startsWith(".")) fixed = `./${fixed}`;
        text = text.split(`${match[1]}${specifier}${match[1]}`).join(`${match[1]}${fixed}${match[1]}`);
        notes.push(`${rel}: import "${specifier}" now points at ${candidates[0]}`);
      }
      if (text !== original) await fs.writeFile(full, text, "utf8");
    }
    return notes;
  },

  /**
   * For the repair prompt: each missing module the typecheck names, where it
   * should be created, and every name the app imports from it. A small model
   * told only "Cannot find module" tends to rewrite the importer instead.
   */
  async missingModules(root: string, errorOutput: string): Promise<string> {
    const wanted = new Map<string, { importers: string[]; names: Set<string> }>();
    for (const match of errorOutput.matchAll(/([\w./\\-]+\.(?:t|j)sx?)\(\d+,\d+\): error TS2307: Cannot find module '(\.{1,2}\/[^']+)'/g)) {
      const importer = posix(match[1]);
      const specifier = match[2];
      let target = posix(path.join(path.dirname(importer), specifier)).replace(/\.(t|j)sx?$/, "");
      // "../lib/x" from src/App.tsx lands outside src/: the app's code belongs inside it.
      if (!target.startsWith("src/")) target = `src/${importKey(specifier)}`;
      const text = await fs.readFile(path.join(root, importer), "utf8").catch(() => "");
      const entry = wanted.get(target) ?? { importers: [], names: new Set<string>() };
      entry.importers.push(`${importer} (as "${specifier}")`);
      for (const name of importedNames(text, specifier)) entry.names.add(name);
      wanted.set(target, entry);
    }
    const lines = Array.from(wanted, ([target, entry]) => {
      const isComponent = /\/components\//.test(target) || Array.from(entry.names).some((name) => /^[A-Z]\w* \(default export\)$/.test(name));
      return `- Create FILE: ${target}${isComponent ? ".tsx" : ".ts"} — imported by ${entry.importers.join(", ")}${
        entry.names.size ? `; it must export: ${Array.from(entry.names).join(", ")}` : ""
      }. Fix any import path that does not point at it.`;
    });
    const missing = lines.length ? `\nThese modules are imported but do not exist. Write each one in full:\n${lines.join("\n")}\n` : "";

    // "Module './game' has no exported member 'saveGame'": the module is there,
    // the name is not. Say which file to add it to, and what it already has.
    const absent = new Map<string, Set<string>>();
    for (const match of errorOutput.matchAll(/([\w./\\-]+\.(?:t|j)sx?)\(\d+,\d+\): error TS2305: Module '"(\.{1,2}\/[^"]+)"' has no exported member '([\w$]+)'/g)) {
      const target = posix(path.join(path.dirname(posix(match[1])), match[2]));
      const file = [".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => target + ext).find((candidate) => fsSync.existsSync(path.join(root, candidate)));
      if (!file) continue;
      absent.set(file, (absent.get(file) ?? new Set()).add(match[3]));
    }
    const exportsLines = await Promise.all(
      Array.from(absent, async ([file, names]) => {
        const has = Array.from(exportsOf(await fs.readFile(path.join(root, file), "utf8")).named).slice(0, 12);
        return `- ${file} does not export ${Array.from(names).join(", ")}. Add ${names.size === 1 ? "it" : "them"} to ${file} as new exports, keeping everything it already exports${has.length ? ` (${has.join(", ")})` : ""}, or import what it does have instead.`;
      })
    );
    const absentText = exportsLines.length ? `\nThese imports ask for names their module does not export:\n${exportsLines.join("\n")}\n` : "";

    // An import of a server-only package: it was left out on purpose, so say what to use instead.
    const serverOnly = new Set<string>();
    for (const match of errorOutput.matchAll(/error TS2307: Cannot find module '([^.'][^']*)'/g)) {
      const name = packageName(match[1]);
      if (name && SERVER_ONLY.has(name)) serverOnly.add(name);
    }
    const serverText = serverOnly.size
      ? `\nThese packages only run on a server and are not installed. Remove the imports and use, instead:\n${Array.from(serverOnly)
          .map((name) => `- ${name}: ${SERVER_ONLY.get(name)}`)
          .join("\n")}\n`
      : "";
    return missing + absentText + serverText + (await AutoFix.nameClashes(root)) + (await AutoFix.duplicateTypes(root, errorOutput)) + (await AutoFix.literalsOutsideUnion(root, errorOutput));
  },

  /**
   * Two files each declaring their own GameState: "'GameState' is not
   * assignable to 'GameState'", which a model reads as a typo and never
   * resolves. Named in the repair prompt when the typecheck shows it, with
   * the engine's (src/engine/) as the one to keep.
   */
  async duplicateTypes(root: string, errorOutput: string): Promise<string> {
    const declared = new Map<string, string[]>();
    for (const file of (await listFiles(path.join(root, "src"))).map((full) => posix(path.relative(root, full)))) {
      if (!/\.(t|j)sx?$/.test(file) || TEST_FILE.test(file) || file.endsWith(".d.ts")) continue;
      const text = await fs.readFile(path.join(root, file), "utf8");
      for (const match of text.matchAll(/export\s+(?:interface|type)\s+([A-Z]\w*)/g)) declared.set(match[1], [...(declared.get(match[1]) ?? []), file]);
    }
    const lines: string[] = [];
    for (const [name, files] of declared) {
      if (files.length < 2 || !new RegExp(`\\b${name}\\b`).test(errorOutput)) continue;
      const keep = files.find((file) => file.startsWith("src/engine/")) ?? files[0];
      const others = files.filter((file) => file !== keep);
      lines.push(`- ${name} is declared in ${files.join(" and ")}: keep only the one in ${keep}, delete it from ${others.join(", ")}, and import it from ${keep} everywhere.`);
    }
    return lines.length ? `\nThe same type is declared twice, so values of one are rejected where the other is expected:\n${lines.join("\n")}\n` : "";
  },

  /**
   * Screens kept in a type that means something else: `state.status === 'home'`
   * when Status is "ready" | "playing" | "won" | "lost". The errors ("no
   * overlap", "'game' is not assignable to type 'Status'") do not say what to
   * do; a small model undid its own repairs on it. This names the type's real
   * values and the fix: a separate useState for which screen is showing.
   */
  async literalsOutsideUnion(root: string, errorOutput: string): Promise<string> {
    const wanted = new Map<string, Set<string>>();
    for (const match of errorOutput.matchAll(/types '(\w+)' and '"([^"]+)"' have no overlap|Type '"([^"]+)"' is not assignable to type '(\w+)'/g)) {
      const type = match[1] ?? match[4];
      const value = match[2] ?? match[3];
      wanted.set(type, (wanted.get(type) ?? new Set()).add(value));
    }
    if (wanted.size === 0) return "";
    const lines: string[] = [];
    for (const file of (await listFiles(path.join(root, "src"))).filter((name) => /\.(t|j)sx?$/.test(name) && !TEST_FILE.test(name))) {
      const text = await fs.readFile(file, "utf8");
      for (const [type, values] of wanted) {
        const declared = new RegExp(`type\\s+${type}\\s*=\\s*([^;]+);`).exec(text);
        if (!declared) continue;
        const allowed = Array.from(declared[1].matchAll(/["']([^"']+)["']/g)).map((m) => m[1]);
        if (allowed.length === 0) continue;
        lines.push(
          `- ${type} (in ${posix(path.relative(root, file))}) can only be ${allowed.map((v) => `"${v}"`).join(" | ")}. The code also uses ${Array.from(values).map((v) => `"${v}"`).join(", ")}, which ${type} does not mean. If those are screens, keep them in their own state, e.g. const [screen, setScreen] = useState<${Array.from(values).map((v) => `"${v}"`).join(" | ")}>("${Array.from(values)[0]}"), and leave ${type} for what it is for.`
        );
        wanted.delete(type);
      }
    }
    return lines.length ? `\nValues used where a type does not allow them:\n${lines.join("\n")}\n` : "";
  },

  /**
   * Two files that differ only in extension (src/Game.ts with the types,
   * src/Game.tsx with the component): "./Game" always means the .ts one, so
   * every import of the component gets the types instead. Said plainly in the
   * repair prompt, because the errors it causes point everywhere but here.
   */
  async nameClashes(root: string): Promise<string> {
    const groups = new Map<string, string[]>();
    for (const file of (await listFiles(path.join(root, "src"))).map((full) => posix(path.relative(root, full)))) {
      if (!SOURCE_FILE.test(file) || file.endsWith(".d.ts")) continue;
      // Lower-cased: on Windows (and macOS) Game.tsx and game.ts are one name to the import resolver.
      const bare = file.replace(/\.(t|j)sx?$/, "").toLowerCase();
      groups.set(bare, [...(groups.get(bare) ?? []), file]);
    }
    const clashes = Array.from(groups.values()).filter((files) => files.length > 1);
    if (clashes.length === 0) return "";
    return `\nThese files share a name, so an import without the extension always gets the first one:\n${clashes
      .map((files) => `- ${files.join(" and ")}: "./${path.posix.basename(files[0]).replace(/\.(t|j)sx?$/, "")}" means ${files.sort()[0]}. Merge them, or move one to a new name (types into src/types.ts) and update every import.`)
      .join("\n")}\n`;
  },

  /**
   * The starter's own smoke test asks for a <main> because the starter's App
   * has one. An app that replaced it (a game whose root is a full-screen
   * <div>) fails a test nobody wrote for it, and the model spends passes on a
   * tag. While App has no <main>, the test asks only that App renders markup.
   */
  async relaxStarterTest(root: string): Promise<string[]> {
    const testPath = path.join(root, "src", "App.test.tsx");
    const test = await fs.readFile(testPath, "utf8").catch(() => "");
    const stock = /expect\(renderAt\(<App \/>\)\)\.toContain\(["']<main["']\);/;
    if (!stock.test(test)) return [];
    const app = await fs.readFile(path.join(root, "src", "App.tsx"), "utf8").catch(() => "");
    if (!app || /<main[\s>]/.test(app)) return [];
    await fs.writeFile(testPath, test.replace(stock, "expect(renderAt(<App />)).toMatch(/<[a-z]/);"), "utf8");
    return ["src/App.test.tsx: the starter's test asked for a <main> the app no longer has; it now checks that App renders"];
  },

  /**
   * `expect(state.ball).toEqual({ x: 160, vx: 0, ... })` — the model's "and the
   * rest" written into a test. It is a syntax error ("Expression expected")
   * that type fixes cannot touch and the small model does not recognise, and
   * it held a live build at typecheck for a whole pass. What it means is a
   * partial match: the placeholder goes and the assertion becomes toMatchObject.
   * Tests only: a "..." in app code is missing code, not a figure of speech.
   */
  async fixPlaceholderEllipsis(root: string): Promise<string[]> {
    const notes: string[] = [];
    for (const file of (await listFiles(path.join(root, "src"))).filter((name) => TEST_FILE.test(name))) {
      const text = await fs.readFile(file, "utf8");
      let count = 0;
      const fixed = text
        .split("\n")
        .map((line) => {
          // "..." straight before a closing brace is never a spread (a spread names what it spreads).
          if (!/(,\s*)?\.\.\.\s*(?=\})/.test(line)) return line;
          count++;
          return line.replace(/(,\s*)?\.\.\.\s*(?=\})/g, " ").replace(/\.(toEqual|toStrictEqual)\(/g, ".toMatchObject(");
        })
        .join("\n");
      if (count === 0) continue;
      await fs.writeFile(file, fixed, "utf8");
      notes.push(`${posix(path.relative(root, file))}: ${count} assertion(s) used "..." for "the rest"; now a partial match (toMatchObject)`);
    }
    return notes;
  },

  /**
   * The same name imported twice ("Duplicate identifier 'DEFAULT_SETTINGS'"),
   * by the model or by an earlier fix: the first import of a name stays,
   * later ones go, and an import left with nothing in it goes too.
   */
  async dedupeImports(root: string): Promise<string[]> {
    const notes: string[] = [];
    const statement = /^import\s+(type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(\{[^}]*\})?\s*from\s+(["'])([^"']+)\4;?[ \t]*\r?\n?/gm;
    for (const file of (await listFiles(path.join(root, "src"))).filter((name) => SOURCE_FILE.test(name) && !name.endsWith(".d.ts"))) {
      const text = await fs.readFile(file, "utf8");
      const seen = new Set<string>();
      let dropped = 0;
      const fixed = text.replace(statement, (whole, typeOnly: string | undefined, defaultName: string | undefined, braces: string | undefined, quote: string, specifier: string) => {
        if (!defaultName && !braces) return whole;
        const keepDefault = defaultName && !seen.has(defaultName) ? defaultName : null;
        if (defaultName && !keepDefault) dropped++;
        if (keepDefault) seen.add(keepDefault);
        const names = braceNames(braces).length > 0 ? (braces ?? "").slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean) : [];
        const keptNames = names.filter((part) => {
          const local = part.split(/\s+as\s+/).pop()!.replace(/^type\s+/, "").trim();
          if (seen.has(local)) {
            dropped++;
            return false;
          }
          seen.add(local);
          return true;
        });
        if (keepDefault === defaultName && keptNames.length === names.length) return whole;
        if (!keepDefault && keptNames.length === 0) return "";
        const newline = /\r?\n$/.exec(whole)?.[0] ?? "";
        const parts = [keepDefault, keptNames.length > 0 ? `{ ${keptNames.join(", ")} }` : null].filter(Boolean).join(", ");
        return `import ${typeOnly ?? ""}${parts} from ${quote}${specifier}${quote};${newline}`;
      });
      if (dropped === 0) continue;
      await fs.writeFile(file, fixed, "utf8");
      notes.push(`${posix(path.relative(root, file))}: removed ${dropped} name(s) imported a second time`);
    }
    return notes;
  },

  /**
   * `box-shadow: '0 0 10px …'` in a style object: CSS written where React wants
   * `boxShadow`. It is a syntax error ("',' expected"), and the parser gives
   * up on the rest of the file, so one key showed as 70 errors and every
   * screen importing the styles failed with it. Only in a file that does not
   * parse, only a bare key followed by a quoted or numeric value, and only
   * when the file then parses better than before.
   */
  async fixKebabCaseKeys(root: string): Promise<string[]> {
    const notes: string[] = [];
    for (const file of (await listFiles(path.join(root, "src"))).filter((name) => /\.(t|j)sx?$/.test(name) && !name.endsWith(".d.ts"))) {
      const rel = posix(path.relative(root, file));
      const text = await fs.readFile(file, "utf8");
      const before = CodeGuard.syntaxErrors(rel, text).length;
      if (before === 0) continue;
      const keys: string[] = [];
      const fixed = text.replace(/^(\s*)([a-z]+(?:-[a-z]+)+)(\s*:\s*['"`\d-])/gm, (_whole, indent: string, key: string, rest: string) => {
        const camel = key.replace(/-([a-z])/g, (_dash, letter: string) => letter.toUpperCase());
        keys.push(`${key} -> ${camel}`);
        return `${indent}${camel}${rest}`;
      });
      if (keys.length === 0 || CodeGuard.syntaxErrors(rel, fixed).length >= before) continue;
      await fs.writeFile(file, fixed, "utf8");
      notes.push(`${rel}: CSS property names in a style object, written the JavaScript way (${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""})`);
    }
    return notes;
  },

  /**
   * `<div css={styles.box}>` with `import { css } from '@emotion/react'`: the
   * css prop only works when the file's JSX comes from Emotion, which takes
   * one line at the top. Without it every styled element is a type error
   * ("css: SerializedStyles is not assignable…") — 16 of a fresh Pgame's 26.
   */
  async addEmotionPragma(root: string): Promise<string[]> {
    const notes: string[] = [];
    for (const file of (await listFiles(path.join(root, "src"))).filter((name) => /\.(t|j)sx$/.test(name))) {
      const text = await fs.readFile(file, "utf8");
      if (!/from\s+["']@emotion\/react["']/.test(text) || !/\scss=\{/.test(text) || /@jsxImportSource/.test(text)) continue;
      await fs.writeFile(file, `/** @jsxImportSource @emotion/react */\n${text}`, "utf8");
      notes.push(`${posix(path.relative(root, file))}: uses Emotion's css prop; added the line that makes it work`);
    }
    return notes;
  },

  async run(root: string): Promise<string[]> {
    const notes: string[] = [
      ...(await AutoFix.fixKebabCaseKeys(root)),
      ...(await AutoFix.addEmotionPragma(root)),
      ...(await AutoFix.dedupeImports(root)),
      ...(await AutoFix.splitNameClashes(root)),
      ...(await AutoFix.fixImportPaths(root)),
      ...(await AutoFix.fixDefaultImports(root)),
      ...(await AutoFix.addMissingComponentImports(root)),
      ...(await AutoFix.addMissingReactImports(root)),
      ...(await AutoFix.fixHooksOutsideComponents(root)),
      ...(await AutoFix.relaxStarterTest(root)),
      ...(await AutoFix.fixPlaceholderEllipsis(root))
    ];
    const pkgPath = path.join(root, "package.json");
    let pkg: Record<string, any>;
    try {
      pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
    } catch {
      return notes;
    }
    const deps: Record<string, string> = { ...(pkg.dependencies ?? {}) };
    const devDeps: Record<string, string> = { ...(pkg.devDependencies ?? {}) };
    const usesVitest = Boolean(devDeps.vitest || deps.vitest);

    let configHasGlobals = false;
    for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts", "vitest.config.ts", "vitest.config.js"]) {
      const text = await fs.readFile(path.join(root, name), "utf8").catch(() => "");
      if (/globals\s*:\s*true/.test(text)) configHasGlobals = true;
    }

    const files = (await listFiles(path.join(root, "src"))).filter((file) => SOURCE_FILE.test(file) && !file.endsWith(".d.ts"));
    const missing = new Map<string, "dep" | "dev">();

    for (const file of files) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      let text = await fs.readFile(file, "utf8");
      const original = text;
      const isTest = TEST_FILE.test(file);

      if (usesVitest && isTest) {
        if (/\bjest\./.test(text)) {
          text = text.replace(/\bjest\.(fn|mock|spyOn|clearAllMocks|resetAllMocks|restoreAllMocks|useFakeTimers|useRealTimers|advanceTimersByTime|runAllTimers|requireActual)\b/g, "vi.$1");
          text = text.replace(/\bjest\.requireActual\b/g, "vi.importActual");
          text = text.replace(/^\s*import\s+.*from\s+["']@jest\/globals["'];?\s*$/gm, "");
        }
        if (!configHasGlobals && !/from\s+["']vitest["']/.test(text)) {
          const used = VITEST_GLOBALS.filter((name) => new RegExp(`(^|[^\\w.])${name}[.(]`, "m").test(text));
          if (used.length > 0) text = `import { ${used.join(", ")} } from "vitest";\n${text}`;
        }
      }

      if (text !== original) {
        await fs.writeFile(file, text, "utf8");
        notes.push(`${rel}: switched Jest calls to Vitest and added its imports`);
      }

      for (const match of text.matchAll(/(?:import\s+(?:[^"'`;]*?\s+from\s+)?|import\(|require\()\s*["']([^"']+)["']/g)) {
        const name = packageName(match[1]);
        if (!name || deps[name] || devDeps[name]) continue;
        const kind = isTest || DEV_PACKAGES.test(name) ? "dev" : "dep";
        // Used by the app itself anywhere: a runtime dependency, even if a test saw it first.
        if (!missing.has(name) || kind === "dep") missing.set(name, missing.get(name) === "dep" ? "dep" : kind);
      }
    }

    // A browser app (Vite) cannot use a server-only package: `canvas` is a
    // native Node library, and adding it made `npm install` fail for the whole
    // app (it compiles C++). Never add one, and take out any the model wrote
    // into package.json itself; the repair is told the browser's own way.
    const browser = Boolean(devDeps.vite || deps.vite);
    let changed = false;
    if (browser) {
      for (const name of Array.from(missing.keys())) if (SERVER_ONLY.has(name)) missing.delete(name);
      for (const table of [deps, devDeps]) {
        for (const name of Object.keys(table)) {
          if (SERVER_ONLY.has(name)) {
            delete table[name];
            changed = true;
            notes.push(`package.json: removed ${name} (a server-only package; it cannot run in the browser)`);
          }
        }
      }
    }
    if (missing.size > 0) {
      for (const [name, kind] of missing) {
        if (kind === "dev") devDeps[name] = "latest";
        else deps[name] = "latest";
      }
      notes.push(`package.json: added ${Array.from(missing.keys()).join(", ")} (imported but not installed)`);
      changed = true;
    }
    if (changed) {
      pkg.dependencies = deps;
      pkg.devDependencies = devDeps;
      await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    }
    return notes;
  }
};
