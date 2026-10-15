/**
 * StuckDoctor — when a build keeps failing the same way, it finds out why and
 * fixes it itself, then remembers the fix.
 *
 * The repair loop asks a model to fix the code. When the problem is not in the
 * code it can see — a test library set up for Jest in a Vitest project, a type
 * a package only adds once it is imported, a config option — the model
 * rewrites the code, the error stays, and the build sits at the same score
 * pass after pass (a Law Firm template stopped at 55 for eight passes on two
 * errors). A person would stop, look the error up, read the package's own
 * docs, try a fix and keep it if it works. This does that:
 *
 *  1. the failing check's errors, grouped (ErrorFingerprint);
 *  2. fixes it has learned before for those errors (FixPlaybook), tried first;
 *  3. otherwise evidence: where the names in the error are defined in the
 *     installed packages and what their READMEs say about setup, the project's
 *     own config, and what Stack Overflow, GitHub issues and npm say about the
 *     error (SourceProviders);
 *  4. a model reads the evidence and proposes small recipes of safe actions
 *     (FixPlaybook.FixAction) — a package, a tsconfig type, an import, a setup
 *     file, a Vitest setting, or one file edited to an instruction;
 *  5. each recipe is applied, the check run again, and kept only if the
 *     errors it was for went down; otherwise everything it touched is put back
 *     and the recipe is remembered as tried;
 *  6. a recipe that worked goes into the playbook and LessonMemory, so the
 *     next build that meets the error is fixed before anyone is asked.
 *
 * When nothing works it says what it found and what it tried (to the build's
 * history, and to Jarvis), which is a better place to start than "score 55".
 */
import fs from "fs";
import path from "path";

import { Executor } from "../orchestrator/Executor.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { JarvisClient } from "../integrations/JarvisClient.js";
import { searchGitHubIssues, searchNpm, searchStackOverflow, type SearchResult } from "../research/SourceProviders.js";
import { Logger } from "../utils/Logger.js";
import { errorCount, groupErrors, parseErrors, type ErrorGroup } from "./ErrorFingerprint.js";
import { FixPlaybook, checkAction, describeAction, type FixAction, type PlaybookEntry } from "./FixPlaybook.js";

export interface DoctorContext {
  root: string;
  check: { name: string; output: string };
  /** Models to reason with, strongest that fits first. */
  models: Array<string | undefined>;
  /** Fix one file to an instruction: returns its new content, or null. */
  editFile?: (file: string, content: string, instruction: string, errors: string) => Promise<string | null>;
  /** What it is doing, for the build's history. */
  note: (title: string, text: string) => void;
  buildId?: string | null;
  projectName?: string;
  /** Only the playbook: no research, no model (cheap, for the first failure). */
  playbookOnly?: boolean;
  /** No web searches (offline, or a test). */
  offline?: boolean;
}

export interface DoctorResult {
  fixed: number;
  tried: number;
  learned: number;
  notes: string[];
}

const TOTAL_BUDGET_MS = Number(process.env.STUCK_DOCTOR_BUDGET_MS ?? 12 * 60 * 1000);
const MAX_GROUPS = 3;
const MAX_RECIPES = 2;
/** Diagnoses per error: the first, and one more told what did not work. */
const DIAGNOSIS_ROUNDS = 2;
const EDIT_TIMEOUT_MS = Number(process.env.STUCK_DOCTOR_EDIT_MS ?? 6 * 60 * 1000);
const TEST_FILE = /\.(test|spec)\.(t|j)sx?$/;

/* ─── running the failing check again ─── */

const CHECK_COMMANDS: Record<string, [string, string[]]> = {
  typecheck: ["npx", ["tsc", "--noEmit"]],
  build: ["npm", ["run", "build"]],
  test: ["npx", ["vitest", "run"]],
  install: ["npm", ["install", "--no-audit", "--no-fund"]]
};

const rerun = async (root: string, check: string): Promise<{ passed: boolean; output: string }> => {
  const [command, args] = CHECK_COMMANDS[check] ?? CHECK_COMMANDS.typecheck;
  const result = await Executor.run(command, args, { cwd: root, timeoutMs: 4 * 60 * 1000, env: { ...process.env, CI: "1" } });
  return { passed: result.exitCode === 0, output: `${result.stdout}\n${result.stderr}`.slice(-20_000) };
};

/* ─── applying a recipe, and taking it back ─── */

type Backup = { files: Map<string, string | null>; installed: boolean };

const readText = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

const remember = (backup: Backup, file: string) => {
  if (!backup.files.has(file)) backup.files.set(file, readText(file));
};

const restore = async (root: string, backup: Backup) => {
  for (const [file, content] of backup.files) {
    if (content === null) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, content);
  }
  // package.json is back; the lockfile and node_modules follow it.
  if (backup.installed) await Executor.run("npm", ["install", "--no-audit", "--no-fund"], { cwd: root, timeoutMs: 5 * 60 * 1000 });
};

const stripJsonComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1");

const listFiles = (dir: string, match: RegExp, out: string[] = [], depth = 0): string[] => {
  if (depth > 6) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, match, out, depth + 1);
    else if (match.test(entry.name)) out.push(full);
  }
  return out;
};

const latestVersion = async (name: string): Promise<string> => {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`, { signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as { version?: string };
    return data.version ? `^${data.version}` : "latest";
  } catch {
    return "latest";
  }
};

const viteConfig = (root: string): string | null =>
  ["vitest.config.ts", "vitest.config.mts", "vite.config.ts", "vite.config.mts", "vite.config.js"].map((f) => path.join(root, f)).find((f) => fs.existsSync(f)) ?? null;

const apply = async (root: string, actions: FixAction[], ctx: DoctorContext, group: ErrorGroup, backup: Backup): Promise<string[]> => {
  const done: string[] = [];
  let needsInstall = false;
  const addPackage = async (name: string, version: string | undefined, dev: boolean) => {
    const pkgFile = path.join(root, "package.json");
    remember(backup, pkgFile);
    remember(backup, path.join(root, "package-lock.json"));
    const pkg = JSON.parse(readText(pkgFile) ?? "{}") as Record<string, Record<string, string>>;
    const field = dev ? "devDependencies" : "dependencies";
    const resolved = version && version !== "latest" ? version : await latestVersion(name);
    pkg[field] = { ...(pkg[field] ?? {}), [name]: resolved };
    // One place for a package: moving it between the two must not leave both.
    delete pkg[dev ? "dependencies" : "devDependencies"]?.[name];
    fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    needsInstall = true;
  };

  for (const action of actions) {
    switch (action.type) {
      case "add_package":
        await addPackage(action.name, action.version, action.dev !== false);
        break;
      case "tsconfig_types": {
        const file = path.join(root, "tsconfig.json");
        const text = readText(file);
        if (!text) throw new Error("no tsconfig.json");
        remember(backup, file);
        const config = JSON.parse(stripJsonComments(text)) as { compilerOptions?: Record<string, unknown> };
        config.compilerOptions = config.compilerOptions ?? {};
        const current = Array.isArray(config.compilerOptions.types) ? (config.compilerOptions.types as string[]) : null;
        // No "types" means every @types package is included; listing some would drop the rest, so keep what was implied.
        const implied = current ?? (() => {
          const pkg = JSON.parse(readText(path.join(root, "package.json")) ?? "{}") as Record<string, Record<string, string>>;
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          return [...(deps.vite ? ["vite/client"] : []), ...Object.keys(deps).filter((d) => d.startsWith("@types/")).map((d) => d.slice(7))];
        })();
        config.compilerOptions.types = Array.from(new Set([...implied, ...action.add]));
        fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
        break;
      }
      case "add_import": {
        const targets =
          action.where === "test_files" ? listFiles(path.join(root, "src"), TEST_FILE) : [path.join(root, action.where)].filter((f) => fs.existsSync(f));
        if (!targets.length) throw new Error(`nothing to add the import to (${action.where})`);
        const spec = /["']([^"']+)["']/.exec(action.line)?.[1] ?? action.line;
        for (const file of targets) {
          const text = readText(file) ?? "";
          if (text.includes(`"${spec}"`) || text.includes(`'${spec}'`)) continue;
          remember(backup, file);
          fs.writeFileSync(file, `${action.line.replace(/;?$/, ";")}\n${text}`);
        }
        break;
      }
      case "create_file": {
        const file = path.join(root, action.path);
        if (fs.existsSync(file)) throw new Error(`${action.path} already exists`);
        remember(backup, file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, action.content.endsWith("\n") ? action.content : `${action.content}\n`);
        break;
      }
      case "vitest_config": {
        const file = viteConfig(root);
        if (!file) throw new Error("no vite or vitest config");
        remember(backup, file);
        let text = readText(file) ?? "";
        const settings: string[] = [];
        if (action.environment) settings.push(`environment: "${action.environment}"`);
        if (action.setupFiles?.length) settings.push(`setupFiles: [${action.setupFiles.map((f) => `"${f.startsWith(".") ? f : `./${f}`}"`).join(", ")}]`);
        if (/\btest\s*:\s*\{/.test(text)) {
          for (const setting of settings) {
            const key = setting.split(":")[0];
            const existing = new RegExp(`(\\btest\\s*:\\s*\\{[\\s\\S]*?)\\b${key}\\s*:\\s*(\\[[^\\]]*\\]|"[^"]*"|'[^']*')`);
            if (existing.test(text)) text = text.replace(existing, `$1${setting}`);
            else text = text.replace(/\btest\s*:\s*\{/, (m) => `${m}\n    ${setting},`);
          }
        } else if (/defineConfig\(\s*\{/.test(text)) {
          text = text.replace(/defineConfig\(\s*\{/, (m) => `${m}\n  test: { ${settings.join(", ")} },`);
        } else {
          throw new Error("could not find where Vitest's settings go");
        }
        fs.writeFileSync(file, text);
        // A browser-like environment is a package of its own.
        if (action.environment && action.environment !== "node") {
          const pkg = JSON.parse(readText(path.join(root, "package.json")) ?? "{}") as Record<string, Record<string, string>>;
          if (!pkg.devDependencies?.[action.environment] && !pkg.dependencies?.[action.environment]) await addPackage(action.environment, undefined, true);
        }
        break;
      }
      case "edit_file": {
        if (!ctx.editFile) throw new Error("no model to edit with");
        const file = path.join(root, action.path);
        const before = readText(file);
        if (before === null) throw new Error(`${action.path} does not exist`);
        const errors = group.files.includes(action.path) || !group.files.length ? group.example : `${group.example} (in ${group.files.join(", ")})`;
        // A slow model must not hold the build: six minutes, then it is a failed try.
        const after = await Promise.race([
          ctx.editFile(action.path, before, action.instruction, errors),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), EDIT_TIMEOUT_MS))
        ]);
        // Half a file back is a truncated answer, not a fix.
        if (!after || after.trim().length < before.trim().length * 0.5) throw new Error("the edit came back empty or cut short");
        remember(backup, file);
        fs.writeFileSync(file, after);
        break;
      }
    }
    done.push(describeAction(action));
  }
  if (needsInstall) {
    backup.installed = true;
    const install = await Executor.run("npm", ["install", "--no-audit", "--no-fund"], { cwd: root, timeoutMs: 5 * 60 * 1000 });
    if (install.exitCode !== 0) throw new Error(`npm install failed: ${`${install.stderr}`.slice(-300)}`);
  }
  return done;
};

/* ─── evidence ─── */

/** The names an error is about: 'toBeInTheDocument', 'Assertion<HTMLElement>', a module… */
const namesIn = (message: string): string[] => {
  const quoted = Array.from(message.matchAll(/['"`]([^'"`]{2,80})['"`]/g)).map((m) => m[1]);
  const words = quoted.flatMap((q) => q.split(/[^A-Za-z0-9_$@/.-]+/)).filter((w) => /^[@A-Za-z_$][\w$@/.-]{2,}$/.test(w));
  return Array.from(new Set(words)).filter((w) => !/^(string|number|boolean|any|unknown|never|void|null|undefined|object|HTMLElement|Element|Promise)$/.test(w)).slice(0, 4);
};

const installedPackages = (root: string): string[] => {
  const pkg = JSON.parse(readText(path.join(root, "package.json")) ?? "{}") as Record<string, Record<string, string>>;
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => fs.existsSync(path.join(root, "node_modules", name)));
};

/** Where a name is declared in the installed packages' type files, and what their READMEs say about setting them up. */
/**
 * A README's setup sections, not its table of contents (jest-dom's contents
 * list alone filled the space, and its "With Vitest" section never reached the
 * model): sections by heading, those naming the project's own tools first.
 */
export const readmeSetup = (readme: string, tools: string[], budget = 2200): string => {
  const sections = readme.split(/\n(?=#{1,4}\s)/);
  const isToc = (text: string) => {
    const lines = text.split("\n").filter((l) => l.trim());
    return lines.length > 3 && lines.filter((l) => /^\s*[-*]\s*\[.*\]\(#/.test(l)).length / lines.length > 0.5;
  };
  const scored = sections
    .filter((section) => !isToc(section))
    .map((section) => {
      const heading = (section.split("\n")[0] ?? "").toLowerCase();
      const body = section.toLowerCase();
      let score = 0;
      for (const tool of tools) if (heading.includes(tool)) score += 5;
      if (/usage|setup|install|getting started|typescript|configur/.test(heading)) score += 3;
      for (const tool of tools) if (body.includes(tool)) score += 1;
      if (/import\s+['"]|setupfiles|tsconfig/.test(body)) score += 1;
      return { section: section.trim(), score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  let out = "";
  for (const { section } of scored) {
    if (out.length + section.length > budget) {
      if (!out) out = section.slice(0, budget);
      break;
    }
    out += `${section}\n\n`;
  }
  return out.trim();
};

/** How a package is meant to be imported: its "exports" entry points (./vitest, ./jest-globals…). */
const entryPoints = (dir: string): string[] => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string; exports?: unknown };
    if (!pkg.exports || typeof pkg.exports !== "object") return [];
    return Object.keys(pkg.exports as Record<string, unknown>)
      .filter((key) => key.startsWith("."))
      .map((key) => (key === "." ? pkg.name ?? "" : `${pkg.name}/${key.slice(2)}`))
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
};

const localEvidence = (root: string, names: string[], tools: string[] = []): { text: string; sources: string[] } => {
  const started = Date.now();
  const hits: string[] = [];
  const sources: string[] = [];
  const packages = installedPackages(root);
  for (const name of packages) {
    if (Date.now() - started > 6000 || hits.length >= 6) break;
    const dir = path.join(root, "node_modules", name);
    let found: string | null = null;
    const walk = (d: string, depth: number) => {
      if (found || depth > 4) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (found) return;
        if (entry.name === "node_modules") continue;
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full, depth + 1);
        else if (/\.d\.(m|c)?ts$/.test(entry.name)) {
          const text = readText(full) ?? "";
          const name2 = names.find((n) => text.includes(n));
          if (name2) {
            const at = text.indexOf(name2);
            found = `${path.relative(path.join(root, "node_modules"), full).replace(/\\/g, "/")} declares ${name2}: …${text.slice(Math.max(0, at - 200), at + 200).replace(/\s+/g, " ")}…`;
          }
        }
      }
    };
    walk(dir, 0);
    if (!found) continue;
    hits.push(found);
    sources.push(`node_modules/${name}`);
    const entries = entryPoints(dir);
    if (entries.length) hits.push(`${name} can be imported as: ${entries.join(", ")}`);
    const readme = ["README.md", "readme.md", "Readme.md"].map((f) => readText(path.join(dir, f))).find(Boolean);
    if (readme) {
      const setup = readmeSetup(readme, tools);
      if (setup) hits.push(`${name} README (setup):\n${setup}`);
    }
  }
  return { text: hits.join("\n\n"), sources };
};

const projectContext = (root: string, group: ErrorGroup): string => {
  const parts: string[] = [];
  const pkg = JSON.parse(readText(path.join(root, "package.json")) ?? "{}") as Record<string, unknown>;
  parts.push(`package.json: ${JSON.stringify({ dependencies: pkg.dependencies, devDependencies: pkg.devDependencies, scripts: pkg.scripts })}`);
  const tsconfig = readText(path.join(root, "tsconfig.json"));
  if (tsconfig) parts.push(`tsconfig.json compilerOptions: ${tsconfig.slice(0, 900)}`);
  const vite = viteConfig(root);
  if (vite) {
    const text = readText(vite) ?? "";
    const test = /\btest\s*:\s*\{[\s\S]*?\}/.exec(text)?.[0];
    parts.push(`${path.basename(vite)} test settings: ${test ?? "(none)"}`);
  }
  const setups = listFiles(path.join(root, "src"), /^(setupTests|test-setup|setup)\.(t|j)sx?$/).map((f) => path.relative(root, f).replace(/\\/g, "/"));
  parts.push(`test setup files: ${setups.join(", ") || "(none)"}`);
  const tests = listFiles(path.join(root, "src"), TEST_FILE).map((f) => path.relative(root, f).replace(/\\/g, "/"));
  parts.push(`test files: ${tests.join(", ") || "(none)"}`);
  // The lines around the first place the error happens.
  const first = parseErrors(`${group.example}`)[0];
  const file = group.files[0];
  if (file) {
    const text = readText(path.join(root, file)) ?? "";
    const lines = text.split("\n");
    const at = first?.line ?? 1;
    parts.push(`${file} (top, and around the error):\n${lines.slice(0, 12).join("\n")}\n…\n${lines.slice(Math.max(0, at - 8), at + 8).join("\n")}`);
  }
  return parts.join("\n\n");
};

const webEvidence = async (group: ErrorGroup, frameworks: string[]): Promise<{ text: string; sources: string[] }> => {
  const names = namesIn(group.example);
  const short = [group.code.startsWith("TS") ? "" : group.code, ...names, ...frameworks].filter(Boolean).join(" ");
  const tasks: Array<Promise<SearchResult[]>> = [
    searchStackOverflow(`${group.example} ${frameworks.join(" ")}`, 3),
    searchGitHubIssues(short, 3),
    ...(group.code === "TS2307" || names.some((n) => n.startsWith("@")) ? [searchNpm(names.join(" "), 3)] : [])
  ];
  const settled = await Promise.allSettled(tasks.map((task) => Promise.race([task, new Promise<SearchResult[]>((_, reject) => setTimeout(() => reject(new Error("slow")), 12_000))])));
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  return {
    text: results.map((r) => `[${r.provider}] ${r.title}\n${r.snippet}`).join("\n\n").slice(0, 3500),
    sources: results.map((r) => r.url)
  };
};

/* ─── asking for recipes ─── */

const RECIPE_HELP = `Actions (JSON objects; use only these):
- {"type":"add_package","name":"<npm package>","version":"<optional, e.g. ^6.4.0>","dev":true}
- {"type":"tsconfig_types","add":["<types entry, e.g. vitest/globals>"]}
- {"type":"add_import","where":"test_files" or "src/<file>","line":"import '<module>';"}
- {"type":"create_file","path":"src/<name>.d.ts" or "src/setupTests.ts","content":"<small file>"}
- {"type":"vitest_config","environment":"jsdom","setupFiles":["./src/setupTests.ts"]}
- {"type":"edit_file","path":"src/<file>","instruction":"<exactly what to change in that file>"}`;

interface Diagnosis {
  cause: string;
  recipes: FixAction[][];
}

const parseDiagnosis = (reply: string): Diagnosis | null => {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(reply.slice(start, end + 1)) as { cause?: unknown; recipes?: unknown };
    const recipes = (Array.isArray(data.recipes) ? data.recipes : [])
      .map((recipe) => {
        const actions = Array.isArray(recipe) ? recipe : Array.isArray((recipe as { actions?: unknown })?.actions) ? (recipe as { actions: unknown[] }).actions : [];
        const checked = actions.map(checkAction);
        return checked.every(Boolean) && checked.length > 0 && checked.length <= 4 ? (checked as FixAction[]) : null;
      })
      .filter((r): r is FixAction[] => r !== null)
      .slice(0, MAX_RECIPES);
    return { cause: String(data.cause ?? "").slice(0, 400), recipes };
  } catch {
    return null;
  }
};

const diagnose = async (ctx: DoctorContext, group: ErrorGroup, evidence: string, attempts: string[] = []): Promise<Diagnosis | null> => {
  const prompt = `A build keeps failing its ${ctx.check.name} check with the same error, and rewriting the code has not fixed it.${
    attempts.length ? `\n\nAlready tried, and the error stayed (do not suggest these again; think again about the cause):\n${attempts.join("\n")}` : ""
  }
Find the real cause from the evidence and give small fixes as JSON.

The error (${group.count}x${group.files.length ? ` in ${group.files.join(", ")}` : ""}):
${group.example}

Evidence:
${evidence}

${RECIPE_HELP}

Rules:
- If the evidence shows a setup problem (a type a package adds only once it is imported or listed, a test environment, a missing package), fix the setup, not the code.
- Only name packages that appear in the evidence or in package.json.
- Each recipe is complete on its own; give the smallest first. At most ${MAX_RECIPES} recipes, at most 4 actions each.

Reply with only JSON: {"cause":"<one sentence>","recipes":[[<actions>],[<actions>]]}`;
  for (const model of ctx.models) {
    try {
      const reply = await ModelRouter.generate(prompt, model ? { model } : {});
      const diagnosis = parseDiagnosis(reply);
      if (diagnosis && diagnosis.recipes.length) return diagnosis;
      Logger.warn("Stuck Doctor: the model's answer had no usable recipe", { model, reply: reply.slice(0, 400) });
    } catch (error) {
      Logger.warn("Stuck Doctor: model failed", { model, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return null;
};

/* ─── the doctor ─── */

const countFor = (output: string, group: ErrorGroup) => groupErrors(parseErrors(output)).find((g) => g.key === group.key)?.count ?? 0;

/** Apply, check again, keep if it helped. */
const trial = async (ctx: DoctorContext, group: ErrorGroup, actions: FixAction[], before: { total: number; group: number }) => {
  const backup: Backup = { files: new Map(), installed: false };
  try {
    const done = await apply(ctx.root, actions, ctx, group, backup);
    const after = await rerun(ctx.root, ctx.check.name);
    const total = after.passed ? 0 : errorCount(after.output);
    const groupLeft = after.passed ? 0 : countFor(after.output, group);
    // Better means the error it was for is fewer, and nothing else got worse overall.
    const better = after.passed || (groupLeft < before.group && total < before.total);
    if (!better) {
      await restore(ctx.root, backup);
      return { better: false, done, output: after.output, total: before.total, groupLeft: before.group };
    }
    return { better: true, done, output: after.output, total, groupLeft };
  } catch (error) {
    await restore(ctx.root, backup).catch(() => undefined);
    return { better: false, done: [], output: "", total: before.total, groupLeft: before.group, error: error instanceof Error ? error.message : String(error) };
  }
};

const frameworksIn = (root: string): string[] => {
  const pkg = JSON.parse(readText(path.join(root, "package.json")) ?? "{}") as Record<string, Record<string, string>>;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return ["vitest", "jest", "react", "vite", "next", "typescript"].filter((name) => deps[name]).slice(0, 3);
};

export const StuckDoctor = {
  async resolve(ctx: DoctorContext): Promise<DoctorResult> {
    const started = Date.now();
    const result: DoctorResult = { fixed: 0, tried: 0, learned: 0, notes: [] };
    let output = ctx.check.output;
    const groups = groupErrors(parseErrors(output)).slice(0, MAX_GROUPS);
    if (!groups.length) return result;
    const frameworks = frameworksIn(ctx.root);

    for (const group of groups) {
      if (Date.now() - started > TOTAL_BUDGET_MS) break;
      const before = { total: errorCount(output) || 1, group: countFor(output, group) || group.count };

      // 1. What it already knows.
      const known: PlaybookEntry[] = FixPlaybook.match(group.code, group.example);
      let solved = false;
      for (const entry of known) {
        result.tried += 1;
        const outcome = await trial(ctx, group, entry.actions, before);
        FixPlaybook.outcome(entry.id, outcome.better);
        if (outcome.better) {
          ctx.note(`Applied a fix it learned before`, `${entry.cause}\n${outcome.done.map((d) => `• ${d}`).join("\n")}\n${group.count} → ${outcome.groupLeft} of these errors.`);
          result.fixed += 1;
          result.notes.push(`known fix: ${entry.cause}`);
          output = outcome.output;
          solved = true;
          break;
        }
      }
      if (solved || ctx.playbookOnly) continue;

      // 2. Find out.
      ctx.note(`Stuck on: ${group.example.slice(0, 140)}`, `${group.count} error(s) the same as last time. Reading the installed packages, the project's setup and what others found, to work out why.`);
      const names = namesIn(group.example);
      const local = localEvidence(ctx.root, names, frameworks);
      const web = ctx.offline ? { text: "", sources: [] as string[] } : await webEvidence(group, frameworks);
      const evidence = [
        local.text ? `From the installed packages:\n${local.text}` : `None of the installed packages declares ${names.join(", ") || "the names in the error"}.`,
        `The project:\n${projectContext(ctx.root, group)}`,
        web.text ? `From Stack Overflow, GitHub issues and npm:\n${web.text}` : ""
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 9000);

      // 3. Try, keep what helps, learn it; a miss is fed back for one more think.
      const attempts: string[] = [];
      for (let round = 0; round < DIAGNOSIS_ROUNDS && !solved; round++) {
        if (Date.now() - started > TOTAL_BUDGET_MS) break;
        const diagnosis = await diagnose(ctx, group, evidence, attempts);
        if (!diagnosis) {
          result.notes.push(`no usable diagnosis for: ${group.example.slice(0, 120)}`);
          break;
        }
        ctx.note(round ? `Thinking again` : `Diagnosis`, `${diagnosis.cause}\nTrying: ${diagnosis.recipes.map((r) => r.map(describeAction).join(" + ")).join("  |  or  ")}`);
      for (const actions of diagnosis.recipes) {
        if (FixPlaybook.wasTried(group.example, actions)) continue;
        result.tried += 1;
        const outcome = await trial(ctx, group, actions, before);
        if (!outcome.better) {
          FixPlaybook.recordTried(group.example, actions);
          const left = parseErrors(outcome.output).filter((e) => `${e.code}: ${e.pattern}` === group.key).slice(0, 3).map((e) => `${e.file ?? ""}: ${e.message}`);
          attempts.push(`- ${actions.map(describeAction).join(" + ")} → ${outcome.error ? `failed: ${outcome.error}` : left.length ? `still: ${left.join(" | ").slice(0, 400)}` : "no better"}`);
          ctx.note(`That did not help; put it back`, `${actions.map(describeAction).join(" + ")}${outcome.error ? `\n(${outcome.error})` : ""}`);
          continue;
        }
        output = outcome.output;
        result.fixed += 1;
        const entry = FixPlaybook.learn({
          code: group.code,
          message: group.example,
          cause: diagnosis.cause,
          actions,
          evidence: [...local.sources, ...web.sources],
          foundIn: ctx.buildId ?? null
        });
        result.learned += 1;
        LessonMemory.recordFix(
          "build",
          LessonMemory.errorSignature(ctx.check.name, ctx.check.output),
          `${diagnosis.cause} Fix: ${actions.map(describeAction).join("; ")}.`.slice(0, 280),
          group.example.slice(0, 600)
        );
        ctx.note(`Fixed it, and learned it`, `${diagnosis.cause}\n${outcome.done.map((d) => `• ${d}`).join("\n")}\n${group.count} → ${outcome.groupLeft} of these errors. Saved to the playbook (${entry.id}), so the next build that meets this is fixed straight away.`);
        result.notes.push(`learned: ${diagnosis.cause}`);
        solved = true;
        break;
      }
      }
    }

    if (!ctx.playbookOnly && result.fixed === 0 && result.tried > 0) {
      const summary = `${groups.map((g) => `• ${g.example.slice(0, 160)}`).join("\n")}\nTried ${result.tried} fix(es); none made the errors go down.`;
      ctx.note(`Could not work this one out yet`, summary);
      void JarvisClient.send({
        type: "issue",
        severity: "warn",
        project: ctx.projectName ?? null,
        subject: `Agent Builder is stuck on ${ctx.projectName ?? "a build"}: ${groups[0].example.slice(0, 90)}`,
        body: `The ${ctx.check.name} check keeps failing the same way, and the Stuck Doctor's own fixes did not help.\n${summary}`,
        metadata: { buildId: ctx.buildId, check: ctx.check.name }
      });
    }
    return result;
  }
};
