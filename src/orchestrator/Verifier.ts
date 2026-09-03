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

export type CheckName = "install" | "typecheck" | "build" | "test" | "lint";

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
  /**
   * Ensure the workspace has a runnable test setup regardless of what the
   * model generated (or forgot to). Only fills gaps — never overwrites a
   * test script that already looks real.
   */
  static async scaffoldTests(workspace: Workspace): Promise<void> {
    const pkgPath = path.join(workspace.root, "package.json");
    const pkg = (await readJson(pkgPath)) ?? { name: "generated-app", version: "0.0.1" };

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
      await fs.writeFile(
        path.join(workspace.root, "vitest.config.mjs"),
        "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({\n  test: {\n    globals: true,\n    environment: 'node'\n  }\n});\n",
        "utf8"
      );
    }

    await workspace.commitCurrentState("Scaffold test runner (vitest)");
  }

  static async verify(workspace: Workspace): Promise<VerificationReport> {
    await this.scaffoldTests(workspace);

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
    } else {
      checks.push(skip("build", "no build script"));
    }

    const testResult = await Executor.run("npm", ["test"], { cwd: root, timeoutMs: CHECK_TIMEOUT_MS });
    checks.push({
      name: "test",
      applicable: true,
      passed: testResult.exitCode === 0,
      durationMs: testResult.durationMs,
      output: trim(`${testResult.stdout}\n${testResult.stderr}`)
    });

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

  private static score(checks: CheckResult[]): VerificationReport {
    const weights: Record<CheckName, number> = { install: 25, typecheck: 20, build: 15, test: 35, lint: 5 };

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
