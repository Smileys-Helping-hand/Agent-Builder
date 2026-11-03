/**
 * MachineProfile — what really works on this PC, measured, not guessed.
 *
 * A model writing code cannot know that `bash` here is WSL's bash and WSL
 * cannot start (virtualization is off), so it wrote a check that ran
 * `bash -n` and then spent 24 attempts "fixing" scripts that were fine. So
 * each tool is run once with a trivial command and the answer is kept: what
 * works, what is installed but broken, what is missing. Every build step is
 * told, and a check failure that comes from a broken or missing tool is
 * recognised as the machine's, not the code's.
 *
 * Measured once per process and again every six hours; `refresh()` forces it.
 */
import { execFile } from "child_process";
import os from "os";

export type ToolState = "works" | "broken" | "missing";

export interface Tool {
  name: string;
  state: ToolState;
  /** The version line, or why it does not work. */
  detail: string;
}

export interface Profile {
  platform: string;
  measuredAt: string;
  tools: Tool[];
}

/** Each tool and the trivial command that proves it runs. */
const PROBES: Array<{ name: string; command: string; args: string[] }> = [
  { name: "node", command: "node", args: ["--version"] },
  { name: "npm", command: "npm", args: ["--version"] },
  { name: "git", command: "git", args: ["--version"] },
  { name: "bash", command: "bash", args: ["-c", "echo ok"] },
  { name: "wsl", command: "wsl", args: ["-e", "true"] },
  { name: "python", command: process.platform === "win32" ? "python" : "python3", args: ["--version"] },
  { name: "make", command: "make", args: ["--version"] },
  { name: "gcc", command: "gcc", args: ["--version"] },
  { name: "cargo", command: "cargo", args: ["--version"] },
  { name: "go", command: "go", args: ["version"] },
  { name: "docker", command: "docker", args: ["info", "--format", "{{.ServerVersion}}"] },
  { name: "qemu", command: "qemu-system-x86_64", args: ["--version"] }
];

const probe = (name: string, command: string, args: string[]): Promise<Tool> =>
  new Promise((resolve) => {
    // Through the shell on Windows (npm is a .cmd), as one line: the arguments here are fixed and safe.
    const windows = process.platform === "win32";
    execFile(windows ? [command, ...args].join(" ") : command, windows ? [] : args, { timeout: 20_000, windowsHide: true, shell: windows }, (error, stdout, stderr) => {
      const text = `${stdout ?? ""}${stderr ?? ""}`.replace(/\0/g, "").trim();
      if (!error) return resolve({ name, state: "works", detail: text.split(/\r?\n/)[0]?.slice(0, 80) || "ok" });
      const notFound = /not recognized|not found|ENOENT|No such file/i.test(`${error.message} ${text}`) && !/virtualization|WSL|HCS_E/i.test(text);
      resolve({ name, state: notFound ? "missing" : "broken", detail: (text.split(/\r?\n/).find((l) => l.trim()) ?? error.message).slice(0, 160) });
    });
  });

let cached: Profile | null = null;
let measuring: Promise<Profile> | null = null;
const STALE_MS = 6 * 3_600_000;

export const MachineProfile = {
  /** The measured profile (measures the first time, and when it is six hours old). */
  async get(): Promise<Profile> {
    if (cached && Date.now() - Date.parse(cached.measuredAt) < STALE_MS) return cached;
    return MachineProfile.refresh();
  },

  refresh(): Promise<Profile> {
    measuring ??= Promise.all(PROBES.map((p) => probe(p.name, p.command, p.args)))
      .then((tools) => {
        cached = { platform: `${os.type()} ${os.release()} (${process.platform})`, measuredAt: new Date().toISOString(), tools };
        return cached;
      })
      .finally(() => {
        measuring = null;
      });
    return measuring;
  },

  /** The facts for a build step: what to use and what not to rely on. */
  async promptText(): Promise<string> {
    const profile = await MachineProfile.get();
    const works = profile.tools.filter((t) => t.state === "works").map((t) => t.name);
    const broken = profile.tools.filter((t) => t.state === "broken");
    const missing = profile.tools.filter((t) => t.state === "missing").map((t) => t.name);
    return `This PC (measured): ${profile.platform}. Tools that work: ${works.join(", ") || "none"}.${
      broken.length ? ` Installed but NOT working: ${broken.map((t) => `${t.name} (${t.detail})`).join("; ")}.` : ""
    }${missing.length ? ` Not installed: ${missing.join(", ")}.` : ""}
Checks and scripts that run here must only use tools that work here. Where a tool is missing or broken, do it another way (for
example check shell scripts' syntax with a small Node parser, or skip that check here and leave it to CI) — never retry it.`;
  },

  /**
   * Whether a check's failure is the machine's: it mentions a tool that is
   * broken or missing here, or the usual signs of one. Returns the reason, or null.
   */
  async environmentProblem(output: string): Promise<string | null> {
    const profile = await MachineProfile.get();
    for (const tool of profile.tools.filter((t) => t.state !== "works")) {
      const mentioned = new RegExp(`(^|[\\s'"\`/\\\\])${tool.name}(\\.exe)?(\\s|$|'|"|\`)`, "m").test(output);
      if (mentioned) return `${tool.name} is ${tool.state === "broken" ? `installed but does not work here (${tool.detail})` : "not installed here"}`;
    }
    if (/virtualization is not enabled|HCS_E_HYPERV_NOT_INSTALLED|WSL2 is unable to start/i.test(output)) return "WSL cannot start on this PC (virtualization is off)";
    if (/is not recognized as an internal or external command|command not found|spawn \S+ ENOENT/i.test(output)) {
      const name = /'([^']+)' is not recognized|(\S+): command not found|spawn (\S+) ENOENT/i.exec(output);
      return `${name?.[1] ?? name?.[2] ?? name?.[3] ?? "a command"} is not available on this PC`;
    }
    return null;
  },

  /** For tests: set the profile instead of measuring it. */
  setForTest(profile: Profile | null) {
    cached = profile;
  }
};
