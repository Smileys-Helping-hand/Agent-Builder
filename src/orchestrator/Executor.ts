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

// npm-ecosystem CLIs are installed as .cmd shims on Windows and cannot be
// launched by bare name without a shell. Resolving the extension directly
// (rather than passing shell: true) keeps argument handling free of shell
// metacharacter interpretation.
const WINDOWS_CMD_SHIMS = new Set(["npm", "npx", "yarn", "pnpm", "tsc", "vitest", "eslint", "jest"]);

const resolveCommand = (command: string): string => {
  if (process.platform === "win32" && WINDOWS_CMD_SHIMS.has(command)) {
    return `${command}.cmd`;
  }
  return command;
};

const truncate = (text: string): string =>
  text.length > MAX_OUTPUT_CHARS ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n…(truncated)` : text;

export class Executor {
  static run(command: string, args: string[] = [], options: ExecuteOptions): Promise<ExecutionResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = Date.now();
    const resolvedCommand = resolveCommand(command);

    return new Promise((resolve) => {
      const child = spawn(resolvedCommand, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        shell: false,
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
