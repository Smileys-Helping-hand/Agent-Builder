/**
 * Verifier - objective, fact-based checks against a generated project.
 *
 * QualityAnalyzer grades a string an LLM just wrote — the one signal
 * guaranteed not to improve across iterations. This is the replacement gate:
 * does it install, does it typecheck, does it build, do the tests pass, does
 * the linter agree. No model opinion in the score.
 */
import fs from "fs/promises";
import path from "path";
import { Executor } from "./Executor.js";
import { Workspace } from "./Workspace.js";
import { AutoFix } from "./AutoFix.js";
import { TypeFixer } from "./TypeFixer.js";
import { findBrowser, renderPage } from "./SiteAudit.js";
import { pathToFileURL } from "url";
import { CodeGuard } from "./CodeGuard.js";
import { Logger } from "../utils/Logger.js";

/** "tailoring": a template build still showing the template's sample content (added by the orchestrator). */
/** "completeness": a new app that compiles but leaves out what its brief asked for (added by the orchestrator). */
/** "runs": the built app opened in a real browser loads without errors and shows something. */
export type CheckName = "install" | "typecheck" | "build" | "test" | "lint" | "tailoring" | "completeness" | "runs";

export type CheckResult = {
  name: CheckName;
  applicable: boolean;
  passed: boolean;
  durationMs: number;
  output: string;
};

export type VerificationReport = {
  checks: CheckResult[];
  score: number;
  passed: boolean;
  blockingCheck?: CheckResult;
};

const MAX_OUTPUT_CHARS = 6000;
const CHECK_TIMEOUT_MS = 3 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const VITEST_VERSION = "^2.1.4";

const trim = (text: string): string =>
  text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)` : text;

const exists = async (target: string): Promise<boolean> =>
  fs.access(target).then(() => true).catch(() => false);

const readJson = async (file: string): Promise<Record<string, any> | null> => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
};

const skip = (name: CheckName, reason: string): CheckResult => ({
  name,
  applicable: false,
  passed: true,
  durationMs: 0,
  output: reason
});

export class Verifier {
  /** What the type fixer changed in each folder's last verify, so the build can say so. */
  static typeFixes = new Map<string, string[]>();

  /**
   * Ensure the workspace has a runnable test setup regardless of what the
   * model generated (or forgot to). Only fills gaps — never overwrites a
   * test script that already looks real.
   */
  /**
   * Models sometimes write JSX into a file named .ts (most often a test that
   * calls render(<App />)). TypeScript then fails on every line of it, and the
   * model rarely spots the cause, so a build can stall on that alone. A .ts
   * file with a closing tag or a self-closing tag (neither appears in
   * TypeScript generics) is renamed to .tsx, unless a .tsx of that name exists.
   * Imports are unaffected: they leave the extension off.
   */
  static async fixJsxExtensions(workspace: Workspace): Promise<string[]> {
    const renamed: string[] = [];
    // Only a cheap first look ("a tag might be here"); parsing decides. A
    // stricter pattern missed <Game onClick={() => {}} />, whose "=>" has a ">".
    const jsx = /<\/?[A-Za-z][\w.]*[\s/>]/;
    const walk = async (dir: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) continue;
        const text = await fs.readFile(full, "utf8").catch(() => "");
        if (!jsx.test(text)) continue;
        // Only when it is actually broken as .ts and fine as .tsx: a tag inside a
        // string is not JSX, and some valid TypeScript (a generic arrow) breaks in .tsx.
        if (CodeGuard.syntaxErrors(entry.name, text).length === 0) continue;
        if (CodeGuard.syntaxErrors(`${entry.name.slice(0, -3)}.tsx`, text).length > 0) continue;
        const target = `${full.slice(0, -3)}.tsx`;
        if (await exists(target)) {
          // The model wrote the file again under the right name and left the
          // broken .ts beside it; it can never compile, and it stops the
          // typecheck before it reaches any other error.
          await fs.rm(full);
          renamed.push(`${path.relative(workspace.root, full)} (removed: broken duplicate of ${path.basename(target)})`);
          continue;
        }
        await fs.rename(full, target);
        renamed.push(path.relative(workspace.root, target));
      }
    };
    await walk(path.join(workspace.root, "src"));
    return renamed;
  }

  static async scaffoldTests(workspace: Workspace): Promise<void> {
    const pkgPath = path.join(workspace.root, "package.json");
    const existing = await readJson(pkgPath);

    // A package.json that exists but does not parse is a bug for the repair
    // loop to fix, not an empty slate. Replacing it with a stub threw away the
    // project's dependencies and build script, and every later check failed on
    // a project that could no longer build (a customer order ended at 31/100).
    if (!existing && (await exists(pkgPath))) return;

    // A project that already runs its own tests needs nothing added: rewriting
    // its package.json and dropping in a second test config only fights it.
    const ownTestScript = existing?.scripts?.test as string | undefined;
    if (ownTestScript && !/^echo\b/.test(ownTestScript) && !/no test specified/i.test(ownTestScript)) return;

    const pkg = existing ?? { name: "generated-app", version: "0.0.1" };

    pkg.devDependencies = pkg.devDependencies ?? {};
    if (!pkg.devDependencies.vitest && !pkg.dependencies?.vitest) {
      pkg.devDependencies.vitest = VITEST_VERSION;
    }

    pkg.scripts = pkg.scripts ?? {};
    const currentTestScript = pkg.scripts.test as string | undefined;
    if (!currentTestScript || /^echo\b/.test(currentTestScript) || /no test specified/i.test(currentTestScript)) {
      pkg.scripts.test = "vitest run";
    }

    await fs.mkdir(workspace.root, { recursive: true });
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

    const configCandidates = ["vitest.config.ts", "vitest.config.js", "vitest.config.mjs"];
    const hasConfig = (
      await Promise.all(configCandidates.map((file) => exists(path.join(workspace.root, file))))
    ).some(Boolean);

    if (!hasConfig) {
      // globals: true lets Jest-style `describe`/`it`/`expect` (no imports) work unmodified —
      // that's what a model asked for "tests" tends to generate by default.
      //
      // include widens vitest's default glob (**/*.{test,spec}.<ext>) to also catch bare
      // test.js/tests.js and a __tests__/ directory — both observed in practice: a model asked
      // for tests sometimes writes one without the .test. suffix vitest expects by default,
      // which otherwise silently finds zero tests and fails the check for a reason that has
      // nothing to do with the code itself.
      await fs.writeFile(
        path.join(workspace.root, "vitest.config.mjs"),
        "import { defineConfig } from 'vitest/config';\n\n" +
          "export default defineConfig({\n" +
          "  test: {\n" +
          "    globals: true,\n" +
          "    environment: 'node',\n" +
          "    include: [\n" +
          "      '**/*.{test,spec}.?(c|m)[jt]s?(x)',\n" +
          "      '**/test.?(c|m)[jt]s?(x)',\n" +
          "      '**/tests.?(c|m)[jt]s?(x)',\n" +
          "      '**/__tests__/**/*.?(c|m)[jt]s?(x)'\n" +
          "    ]\n" +
          "  }\n" +
          "});\n",
        "utf8"
      );
    }

    await workspace.commitCurrentState("Scaffold test runner (vitest)");
  }

  /**
   * Run the objective checks.
   *
   * `scaffoldTests` adds a test runner when the project has none, which is what
   * a freshly generated app needs — but it rewrites package.json, so anything
   * pointed at a project the user already owns (see ProjectDoctor) must pass
   * false rather than inject files into someone's repository.
   */
  static async verify(
    workspace: Workspace,
    options: { scaffoldTests?: boolean; autofix?: boolean } = {}
  ): Promise<VerificationReport> {
    if (options.scaffoldTests !== false) await this.scaffoldTests(workspace);
    // Fixing the model's usual slips is safe on anything we generated (a fresh
    // build, or a copy of one of our templates), never on a user's own project.
    if (options.autofix ?? options.scaffoldTests !== false) {
      const renamed = await this.fixJsxExtensions(workspace);
      const fixed = await AutoFix.run(workspace.root).catch(() => [] as string[]);
      if (renamed.length || fixed.length) {
        Logger.log("Auto-fixed common mistakes before checking", { renamed, fixed });
      }
    }

    const root = workspace.root;
    const checks: CheckResult[] = [];
    const hasPackageJson = await exists(path.join(root, "package.json"));

    if (!hasPackageJson) {
      checks.push(skip("install", "no package.json"));
      checks.push(skip("typecheck", "no package.json"));
      checks.push(skip("build", "no package.json"));
      checks.push(skip("test", "no package.json"));
      checks.push(skip("lint", "no package.json"));
      return this.score(checks);
    }

    const installResult = await Executor.run("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: root,
      timeoutMs: INSTALL_TIMEOUT_MS
    });
    const installPassed = installResult.exitCode === 0;
    checks.push({
      name: "install",
      applicable: true,
      passed: installPassed,
      durationMs: installResult.durationMs,
      output: trim(`${installResult.stdout}\n${installResult.stderr}`)
    });

    if (!installPassed) {
      checks.push(skip("typecheck", "skipped: install failed"));
      checks.push(skip("build", "skipped: install failed"));
      checks.push(skip("test", "skipped: install failed"));
      checks.push(skip("lint", "skipped: install failed"));
      return this.score(checks);
    }

    const pkg = (await readJson(path.join(root, "package.json"))) ?? {};

    const hasTsconfig = await exists(path.join(root, "tsconfig.json"));
    // Type errors with a mechanical fix are fixed by TypeScript itself, now that
    // the packages (and so the types) are installed. Same rule as above: only
    // on what we generated.
    if (hasTsconfig && (options.autofix ?? options.scaffoldTests !== false)) {
      const typeFixes = TypeFixer.run(root);
      if (typeFixes.length) Logger.log("Fixed type errors without the model", { fixes: typeFixes });
      this.typeFixes.set(root, typeFixes);
    } else {
      this.typeFixes.delete(root);
    }
    if (hasTsconfig) {
      const result = await Executor.run("npx", ["tsc", "--noEmit"], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS });
      checks.push({
        name: "typecheck",
        applicable: true,
        passed: result.exitCode === 0,
        durationMs: result.durationMs,
        output: trim(`${result.stdout}\n${result.stderr}`)
      });
    } else {
      checks.push(skip("typecheck", "no tsconfig.json"));
    }

    const hasBuildScript = Boolean(pkg.scripts?.build);
    if (hasBuildScript) {
      const result = await Executor.run("npm", ["run", "build"], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS });
      checks.push({
        name: "build",
        applicable: true,
        passed: result.exitCode === 0,
        durationMs: result.durationMs,
        output: trim(`${result.stdout}\n${result.stderr}`)
      });
      // The build script runs the strict type check first, so one leftover
      // type error meant no dist/ and a blank preview — while the app itself
      // runs fine (Vite drops types, it does not check them). Build it anyway
      // for the preview pane, so there is always something to try. The check
      // above still fails; this changes nothing about the score.
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) } as Record<string, string>;
      if (result.exitCode !== 0 && deps.vite && (options.autofix ?? options.scaffoldTests !== false)) {
        const preview = await Executor.run("npx", ["vite", "build", "--base", "./"], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS });
        if (preview.exitCode === 0) Logger.log("Built a preview despite the failing checks", { root });
      }
    } else {
      checks.push(skip("build", "no build script"));
    }

    // Without scaffolding, a project may simply have no tests. npm's own
    // placeholder script ("no test specified && exit 1") is not a test that
    // fails; it is no test at all, and failing on it would block every build.
    const testScript = typeof pkg.scripts?.test === "string" ? pkg.scripts.test : "";
    if (!testScript || /no test specified/i.test(testScript)) {
      checks.push(skip("test", "no test script"));
    } else {
      const testResult = await Executor.run("npm", ["test"], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS });
      checks.push({
        name: "test",
        applicable: true,
        passed: testResult.exitCode === 0,
        durationMs: testResult.durationMs,
        output: trim(`${testResult.stdout}\n${testResult.stderr}`)
      });
    }

    const hasLintScript = Boolean(pkg.scripts?.lint);
    if (hasLintScript) {
      const result = await Executor.run("npm", ["run", "lint"], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS });
      checks.push({
        name: "lint",
        applicable: true,
        passed: result.exitCode === 0,
        durationMs: result.durationMs,
        output: trim(`${result.stdout}\n${result.stderr}`)
      });
    } else {
      checks.push(skip("lint", "no lint script"));
    }

    return this.score(checks);
  }

  /**
   * Whether the built app actually runs: open dist/index.html in headless
   * Chrome/Edge (as a double-click would — our builds are one file that works
   * from disk), let it load, and fail on script errors or a blank page. The
   * other checks say the code is well-typed and its tests pass; only this says
   * a person opening it sees an app. Null when there is no browser or no build
   * to open: then nothing is claimed either way.
   */
  static async runsCheck(root: string, builtSince = 0): Promise<CheckResult | null> {
    const page = path.join(root, "dist", "index.html");
    const browser = findBrowser();
    if (!browser || !(await exists(page))) return null;
    // A dist/ left from an earlier pass is not this code: say nothing rather than vouch for it.
    if ((await fs.stat(page)).mtimeMs < builtSince) return null;
    const started = Date.now();
    const rendered = await renderPage(browser, pathToFileURL(page).href);
    if (!rendered) return null;
    // What a visitor would read: the body's text, without scripts and styles.
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(rendered.dom)?.[1] ?? rendered.dom;
    const text = body
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    // A missing favicon is not the app failing.
    const errors = rendered.errors.filter((error) => !/favicon/i.test(error));
    const reasons: string[] = [];
    if (errors.length > 0) reasons.push(`it throws while loading:\n${errors.slice(0, 8).join("\n")}`);
    // A start screen can be one "Play" button, a game one <canvas>: those are drawn, not blank.
    const drawn = /<(button|canvas|input|select|textarea|svg|img|video)\b/i.test(body.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " "));
    if (text.length < 15 && !drawn) reasons.push("the page is blank: nothing is drawn once it has loaded (an error before the first screen, or a screen that renders nothing)");
    return {
      name: "runs",
      applicable: true,
      passed: reasons.length === 0,
      durationMs: Date.now() - started,
      output: reasons.length === 0 ? `Opened in a browser: it loads and shows "${text.slice(0, 80)}…".` : `Opened in a browser, ${reasons.join("; and ")}`
    };
  }

  /** The same report with one more check, scored again. */
  static withCheck(report: VerificationReport, check: CheckResult): VerificationReport {
    return this.score([...report.checks.filter((existing) => existing.name !== check.name), check]);
  }

  private static score(checks: CheckResult[]): VerificationReport {
    const weights: Record<CheckName, number> = { install: 25, typecheck: 20, build: 15, test: 35, lint: 5, tailoring: 30, completeness: 30, runs: 30 };

    const applicable = checks.filter((check) => check.applicable);
    const totalWeight = applicable.reduce((sum, check) => sum + weights[check.name], 0) || 1;
    const earnedWeight = applicable.reduce((sum, check) => sum + (check.passed ? weights[check.name] : 0), 0);

    const blockingCheck = checks.find((check) => check.applicable && !check.passed);

    return {
      checks,
      score: Math.round((earnedWeight / totalWeight) * 100),
      passed: !blockingCheck,
      blockingCheck
    };
  }
}
