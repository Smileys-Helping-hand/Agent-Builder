/**
 * VmCheck — "it boots and passes its tests" as part of a project's checks.
 *
 * A continuous-builder session (or anything else) can require that its
 * operating system is built, booted in a real VM and tested: the build command
 * makes the ISO, a disposable VM boots it, the chosen profiles run, and any
 * failed step comes back as a failing check with its evidence, for the next
 * step to fix. Nothing is rebuilt or rebooted while the files the OS is made
 * from have not changed since the last run: the last result stands.
 */
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { VmLab } from "./VmLab.js";
import { VmTests, type TestRun } from "./VmTests.js";

const run = promisify(execFile);

export interface VmTestConfig {
  /** Makes the ISO, run in the workspace (e.g. wsl.exe -e bash os/image/build-iso.sh). */
  buildCommand: string;
  /** The ISO it makes, relative to the workspace. */
  iso: string;
  /** Folders the OS is made from: unchanged, and the last result stands. */
  paths: string[];
  profiles: string[];
  login?: { user?: string; password?: string };
  cpus?: number;
  memoryMb?: number;
  network?: "none" | "isolated" | "internet";
  /** The last run, kept by the session. */
  lastTree?: string | null;
  lastRun?: string | null;
  lastPassed?: boolean | null;
  lastReport?: string | null;
}

export interface VmCheckResult {
  passed: boolean;
  /** Why it failed, with evidence, for the builder. */
  report: string;
  runId: string | null;
  reused: boolean;
  tree: string | null;
  failure: "build" | "iso" | "test" | null;
}

const BUILD_LIMIT_MS = Number(process.env.VM_CHECK_BUILD_LIMIT_MS) || 3 * 3_600_000;

const treeOf = async (dir: string, paths: string[]): Promise<string | null> => {
  try {
    const parts: string[] = [];
    for (const item of paths) {
      const { stdout } = await run("git", ["rev-parse", `HEAD:${item.replace(/\\/g, "/")}`], { cwd: dir, windowsHide: true });
      parts.push(stdout.trim());
    }
    return parts.join(",");
  } catch {
    return null;
  }
};

const shell = (command: string, cwd: string, timeoutMs: number) =>
  new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    const add = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-40_000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      child.kill();
      output += `\n(stopped after ${Math.round(timeoutMs / 60_000)} minutes)`;
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\n${error.message}` });
    });
  });

export const VmCheck = {
  async run(config: VmTestConfig, dir: string, context: { name: string; task: string; projectId?: string | null; agent?: string; onPhase?: (phase: string) => void }): Promise<VmCheckResult> {
    const tree = await treeOf(dir, config.paths);
    if (tree && tree === config.lastTree && config.lastPassed !== null && config.lastPassed !== undefined) {
      return { passed: config.lastPassed, report: config.lastReport ?? "", runId: config.lastRun ?? null, reused: true, tree, failure: config.lastPassed ? null : "test" };
    }

    context.onPhase?.(`Building the OS image: ${config.buildCommand}`);
    const build = await shell(config.buildCommand, dir, BUILD_LIMIT_MS);
    if (!build.ok) {
      return { passed: false, report: `The OS image did not build (${config.buildCommand}):\n${build.output.split(/\r?\n/).slice(-40).join("\n")}`, runId: null, reused: false, tree, failure: "build" };
    }
    const iso = path.resolve(dir, config.iso);
    if (!fs.existsSync(iso)) return { passed: false, report: `The build finished but made no ${config.iso}.`, runId: null, reused: false, tree, failure: "iso" };

    context.onPhase?.(`Booting ${path.basename(iso)} in a VM and testing it`);
    const vm = await VmLab.create({
      name: `${context.name} test`.slice(0, 60),
      purpose: `Testing ${path.basename(iso)} for ${context.task}`,
      projectId: context.projectId ?? null,
      iso,
      cpus: config.cpus ?? 4,
      memoryMb: config.memoryMb ?? 2048,
      diskGb: 4,
      network: config.network ?? "isolated",
      disposable: true,
      maxRuntimeMinutes: 180
    });
    let result: TestRun;
    try {
      result = await VmTests.runToEnd({ vmId: vm.id, profiles: config.profiles, agent: context.agent ?? "continuous-builder", task: context.task, login: config.login, label: context.name });
    } finally {
      await VmLab.remove(vm.id).catch(() => undefined);
    }
    const passed = result.state === "passed";
    return {
      passed,
      report: passed ? "" : VmTests.failureReport(result) || `The VM test run ended ${result.state}${result.error ? `: ${result.error}` : ""}.`,
      runId: result.id,
      reused: false,
      tree,
      failure: passed ? null : "test"
    };
  }
};
