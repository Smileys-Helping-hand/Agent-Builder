/**
 * Executor - runs a command in a working directory and captures its result.
 *
 * The missing organ in the build pipeline: every generated project needs
 * something that actually runs `npm install`, `tsc`, a test runner, in the
 * workspace it was generated into, and reports back what happened.
 */
import { spawn } from "child_process";

export type ExecutionResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
};

export type ExecuteOptions = {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_OUTPUT_CHARS = 200_000;
const GRACE_KILL_MS = 5000;

// npm-ecosystem CLIs are installed as .cmd/.bat shims on Windows, and Windows
// cannot CreateProcess a .cmd/.bat file directly — it needs cmd.exe to
// interpret it, so shell: false throws EINVAL even when the .cmd extension
// is given explicitly. shell: true is required for exactly these commands.
// Every call site in this codebase passes static, internally-constructed
// argument arrays to these shims (never raw user/model text) — do not add a
// call site that interpolates untrusted strings into `args` for one of these
// commands without re-checking this assumption.
const WINDOWS_CMD_SHIMS = new Set(["npm", "npx", "yarn", "pnpm", "tsc", "vitest", "eslint", "jest"]);

const needsWindowsShell = (command: string): boolean =>
  process.platform === "win32" && WINDOWS_CMD_SHIMS.has(command);

const truncate = (text: string): string =>
  text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)` : text;

export class Executor {
  static run(command: string, args: string[] = [], options: ExecuteOptions): Promise<ExecutionResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: needsWindowsShell(command),
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, GRACE_KILL_MS);
      }, timeoutMs);

      const finish = (exitCode: number | null, extraStderr?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        resolve({
          command,
          args,
          exitCode,
          stdout: truncate(stdout),
          stderr: truncate(extraStderr ? `${stderr}\n${extraStderr}` : stderr),
          timedOut,
          durationMs: Date.now() - startedAt
        });
      };

      child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("close", (code) => finish(code));
      child.on("error", (error) => finish(null, error.message));
    });
  }
}
