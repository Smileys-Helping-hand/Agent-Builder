/**
 * VM tests — an agent (or you) runs test profiles against a real running OS.
 *
 * A profile is a list of steps the runner performs on the VM, with no person
 * at the keyboard:
 *   start       boot the VM (from a snapshot when asked)
 *   wait        until the serial console shows a pattern (a boot line, a login prompt)
 *   login       answer the login prompt (user, password) and confirm a shell
 *   run         type a command on the serial console; its output and exit code are
 *               captured with a marker and checked against what was expected
 *   send        type raw text on the serial console
 *   keys        type on the VM's screen (keyboard events through QEMU)
 *   click       move the mouse to a point on the screen and click
 *   screenshot  capture the screen; optionally require it to show something
 *   restart     reset the VM
 *   sleep       wait
 *
 * Every step records what was expected, what happened, whether it passed,
 * its output and its timing; screenshots and the serial log are kept with the
 * run (data/vmlab/runs/<id>/). A run is evidence (vm-test), linked to its VM
 * and to whatever it was run for (a continuous-builder step, a project), so a
 * failure is a defect the builder sees and fixes.
 *
 * The built-in profiles cover a Linux system through its serial console and
 * screen: boot, login, basics, services, network, packages, storage, memory,
 * CPU, terminal, graphics and desktop, audio, security, stability, restart.
 * Commands work on GNU and busybox systems alike. Optional steps only warn.
 */
import fs from "fs";
import path from "path";

import { Evidence } from "../knowledge/Evidence.js";
import { Logger } from "../utils/Logger.js";
import { VmLab } from "./VmLab.js";

export type Step =
  | { do: "start"; snapshot?: string; what?: string }
  | { do: "wait"; for: string; timeoutMs?: number; what?: string; optional?: boolean }
  | { do: "login"; user?: string; password?: string; timeoutMs?: number; what?: string }
  | { do: "run"; command: string; expect?: string; reject?: string; exit?: number | "any"; timeoutMs?: number; what?: string; optional?: boolean }
  | { do: "send"; text: string; what?: string }
  | { do: "keys"; text?: string; combos?: string[][]; what?: string }
  | { do: "click"; x: number; y: number; button?: "left" | "right"; what?: string }
  | { do: "screenshot"; name: string; minCoverage?: number; /** Keep looking this long for the screen to show it. */ withinMs?: number; what?: string; optional?: boolean }
  | { do: "restart"; what?: string }
  | { do: "sleep"; ms: number; what?: string };

export interface Profile {
  id: string;
  name: string;
  about: string;
  steps: Step[];
  builtIn?: boolean;
}

export interface StepResult {
  index: number;
  profile: string;
  what: string;
  step: Step;
  expected: string;
  actual: string;
  result: "passed" | "failed" | "warned" | "skipped";
  output: string;
  screenshot: string | null;
  startedAt: string;
  durationMs: number;
}

export interface TestRun {
  id: string;
  vmId: string;
  vmName: string;
  /** What was tested: the ISO and when it was built. */
  build: { iso: string | null; isoModifiedAt: string | null; label: string | null };
  profiles: string[];
  agent: string;
  /** What it was run for: a session, a step, a project. */
  task: string | null;
  state: "running" | "passed" | "failed" | "stopped" | "error";
  startedAt: string;
  finishedAt: string | null;
  steps: StepResult[];
  counts: { passed: number; failed: number; warned: number; skipped: number };
  frames: string[];
  error: string | null;
  feedback: Array<{ at: string; by: string; text: string; kind: string; followUp: string | null }>;
}

const RUNS = () => path.resolve(process.env.VMLAB_DIR ?? "data/vmlab", "runs");
const PROFILES_FILE = () => path.resolve(process.env.VMLAB_DIR ?? "data/vmlab", "profiles.json");
const runFile = (id: string) => path.join(RUNS(), id, "run.json");

const BOOT_TIMEOUT = Number(process.env.VMLAB_BOOT_TIMEOUT_MS) || 15 * 60_000;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][A-Z0-9]|\x1b[=>]|\r/g;
const clean = (text: string) => text.replace(ANSI, "");

/* ─── the built-in profiles ─── */

const shell = (command: string, what: string, extra: Partial<Extract<Step, { do: "run" }>> = {}): Step => ({ do: "run", command, what, ...extra });

const WINDOW_MANAGERS = "xfwm4|openbox|i3|mutter|kwin|marco|metacity|sway|labwc|wayfire";

export const BUILT_IN: Profile[] = [
  {
    id: "boot",
    name: "Boot and startup",
    about: "It boots: the kernel starts and the system reaches a login prompt, and the screen shows it.",
    steps: [
      { do: "start", what: "Start the VM" },
      { do: "wait", for: "Linux version|Booting|ISOLINUX|GRUB|SeaBIOS", timeoutMs: 5 * 60_000, what: "Firmware and kernel start", optional: true },
      { do: "wait", for: "login:", timeoutMs: BOOT_TIMEOUT, what: "Reaches a login prompt" },
      { do: "screenshot", name: "booted", minCoverage: 0.002, withinMs: 5 * 60_000, what: "The screen shows the booted system" }
    ]
  },
  {
    id: "login",
    name: "Login and authentication",
    about: "Logs in at the prompt and gets a shell as the expected user.",
    steps: [{ do: "login", what: "Log in" }, shell("id -un; id -u", "Logged-in identity", { expect: "\\d" })]
  },
  {
    id: "basics",
    name: "Terminal, memory, CPU and storage",
    about: "The shell works; memory, CPUs and the virtual disk are seen; the clock and kernel are sane.",
    steps: [
      shell("uname -a", "Kernel identifies itself", { expect: "Linux" }),
      shell("tty; echo TERM=$TERM", "A terminal is attached", { expect: "/dev/" }),
      shell("grep -E 'MemTotal|MemAvailable' /proc/meminfo", "Memory is seen", { expect: "MemTotal:\\s+\\d+" }),
      shell("nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo", "CPUs are seen", { expect: "^\\s*[1-9]" }),
      shell("cat /proc/partitions", "The virtual disk is seen", { expect: "vd[a-z]|sd[a-z]|nvme" }),
      shell("df -h / 2>/dev/null | tail -1", "The root filesystem is mounted", { expect: "/" }),
      shell("date -u +%Y", "The clock is set", { expect: "20[2-9]\\d" })
    ]
  },
  {
    id: "performance",
    name: "CPU, memory and disk performance",
    about: "Times a CPU loop, a memory copy and a disk write, so builds can be compared.",
    steps: [
      shell("time sh -c 'i=0; while [ $i -lt 100000 ]; do i=$((i+1)); done'", "CPU: 100,000 shell loop iterations", { exit: "any" }),
      shell("dd if=/dev/zero of=/dev/null bs=1M count=512 2>&1 | tail -1", "Memory: copy 512 MB", { expect: "bytes|copied" }),
      shell("dd if=/dev/zero of=/tmp/ab-disk bs=1M count=64 conv=fsync 2>&1 | tail -1; rm -f /tmp/ab-disk", "Disk: write 64 MB", { expect: "bytes|copied" })
    ]
  },
  {
    id: "services",
    name: "System services",
    about: "No system service has failed.",
    steps: [
      shell(
        "if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then systemctl --failed --no-legend --plain; echo FAILED=$(systemctl --failed --no-legend --plain | wc -l); elif command -v rc-status >/dev/null 2>&1; then rc-status --crashed; echo FAILED=$(rc-status --crashed | wc -l); else echo FAILED=0 'no service manager found'; fi",
        "Failed services",
        { expect: "FAILED=0\\b" }
      ),
      shell("ps -e 2>/dev/null | wc -l || ps | wc -l", "Processes are running", { expect: "\\d" })
    ]
  },
  {
    id: "network",
    name: "Networking",
    about: "A network interface exists and gets an address (and, with internet, names resolve).",
    steps: [
      shell("ip -o link | grep -v ': lo:'", "A network interface exists", { expect: "eth|ens|enp" }),
      shell(
        "ip -4 -o addr | grep -v ' lo ' || { IF=$(ip -o link | grep -v ': lo:' | head -1 | cut -d: -f2 | tr -d ' '); ip link set $IF up; (udhcpc -i $IF -q -n -t 5 || dhclient -1 $IF || dhcpcd -w $IF) >/dev/null 2>&1; ip -4 -o addr | grep -v ' lo '; }",
        "It gets an address",
        { expect: "inet \\d" }
      ),
      shell("getent hosts dl-cdn.alpinelinux.org 2>/dev/null || nslookup deb.debian.org 2>/dev/null | tail -2", "Names resolve (internet networking only)", { expect: "\\d+\\.\\d+", optional: true })
    ]
  },
  {
    id: "packages",
    name: "Package management",
    about: "A package manager is present and knows its installed packages.",
    steps: [
      shell("command -v apt-get || command -v apk || command -v dnf || command -v pacman || command -v zypper", "A package manager exists", { expect: "/" }),
      shell("(dpkg -l 2>/dev/null | grep -c ^ii) || (apk info 2>/dev/null | wc -l) || (rpm -qa 2>/dev/null | wc -l) || (pacman -Q 2>/dev/null | wc -l)", "Installed packages are listed", { expect: "^\\s*[1-9]" })
    ]
  },
  {
    id: "graphics",
    name: "Graphics, display and desktop",
    about: "A display device exists; on a desktop system a display server, window manager, launcher and file manager run.",
    steps: [
      shell("ls /dev/fb0 /dev/dri/card0 2>/dev/null; cat /sys/class/graphics/fb0/virtual_size 2>/dev/null", "A display device exists", { expect: "fb0|card0", optional: true }),
      // Under an emulated CPU a desktop takes minutes after the login prompt: wait for it, where one is installed.
      shell(
        `if [ -x /usr/sbin/lightdm ] || [ -x /usr/sbin/gdm3 ] || [ -x /usr/bin/sddm ] || [ -x /usr/sbin/sddm ]; then i=0; while [ $i -lt 90 ] && ! ps -e | grep -qE '${WINDOW_MANAGERS}'; do sleep 5; i=$((i+1)); done; fi; ps -e | grep -E 'Xorg|Xwayland|weston|gnome-shell|kwin|sway|mutter' | grep -v grep`,
        "A display server runs",
        { optional: true, timeoutMs: 9 * 60_000 }
      ),
      shell(`ps -e | grep -E '${WINDOW_MANAGERS}' | grep -v grep`, "A window manager runs", { optional: true }),
      shell("ps -e | grep -E 'xfce4-panel|gnome-shell|plasmashell|lxpanel|mate-panel|waybar' | grep -v grep", "A desktop panel runs", { optional: true }),
      shell("command -v thunar nautilus pcmanfm dolphin caja nemo 2>/dev/null | head -3", "A file manager is installed", { expect: "/", optional: true }),
      shell("ls /usr/share/applications 2>/dev/null | wc -l", "Applications are registered for a launcher", { expect: "^\s*[1-9]", optional: true }),
      { do: "screenshot", name: "desktop", minCoverage: 0.05, withinMs: 5 * 60_000, what: "The screen shows a desktop", optional: true }
    ]
  },
  {
    id: "audio",
    name: "Audio",
    about: "A sound card is detected (the VM has an Intel HDA device with no host output).",
    steps: [shell("cat /proc/asound/cards 2>/dev/null || ls /dev/snd 2>/dev/null", "A sound card is detected", { expect: "HDA|Intel|card|pcm", optional: true })]
  },
  {
    id: "security",
    name: "Security configuration",
    about: "No account without a password, root SSH login off, and what listens on the network.",
    steps: [
      shell("awk -F: '($2==\"\" ){print \"NO PASSWORD: \"$1}' /etc/shadow 2>/dev/null; echo checked", "No account lacks a password", { reject: "NO PASSWORD" }),
      shell("grep -E '^\\s*PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null || echo 'no sshd config'", "Root cannot log in over SSH", { reject: "PermitRootLogin\\s+yes", optional: true }),
      shell("(ss -tln 2>/dev/null || netstat -tln 2>/dev/null) | tail -n +2", "Listening ports (for review)", { exit: "any" }),
      shell("ls -l /etc/shadow", "Password hashes are not world-readable", { reject: "^-.......r", optional: true })
    ]
  },
  {
    id: "stability",
    name: "Stability under load",
    about: "Four CPU-bound jobs for 20 seconds; the system stays responsive and nothing is killed.",
    steps: [
      shell("for i in 1 2 3 4; do (yes > /dev/null &); done; sleep 20; killall yes 2>/dev/null || pkill yes; echo survived", "Stays up under load", { expect: "survived", timeoutMs: 120_000 }),
      shell("dmesg 2>/dev/null | grep -iE 'oops|panic|out of memory|segfault' | tail -5; echo end", "No kernel errors", { reject: "(?i)oops|panic|out of memory" }),
      shell("uptime", "Still up", { expect: "up" })
    ]
  },
  {
    id: "restart",
    name: "Restart",
    about: "It restarts cleanly and comes back to a login prompt.",
    steps: [{ do: "restart", what: "Reset the VM" }, { do: "wait", for: "login:", timeoutMs: BOOT_TIMEOUT, what: "Back at a login prompt" }, { do: "login", what: "Log in again" }]
  }
];

export const FULL = ["boot", "login", "basics", "services", "network", "packages", "graphics", "audio", "security", "performance", "stability", "restart"];

/* ─── profiles ─── */

const custom = (): Profile[] => {
  try {
    return JSON.parse(fs.readFileSync(PROFILES_FILE(), "utf8")) as Profile[];
  } catch {
    return [];
  }
};

export const profiles = (): Profile[] => [...BUILT_IN.map((p) => ({ ...p, builtIn: true })), ...custom()];

export const saveProfile = (profile: { id?: string; name: string; about?: string; steps: Step[] }): Profile => {
  const id = (profile.id ?? profile.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  if (!id || BUILT_IN.some((p) => p.id === id)) throw new Error("Give the profile its own name (not a built-in one).");
  if (!Array.isArray(profile.steps) || !profile.steps.length) throw new Error("A profile needs steps.");
  const allowed = new Set(["start", "wait", "login", "run", "send", "keys", "click", "screenshot", "restart", "sleep"]);
  for (const step of profile.steps) if (!allowed.has((step as { do: string }).do)) throw new Error(`Unknown step: ${(step as { do: string }).do}`);
  const saved: Profile = { id, name: profile.name.slice(0, 80), about: (profile.about ?? "").slice(0, 300), steps: profile.steps.slice(0, 100) };
  const all = custom().filter((p) => p.id !== id);
  fs.mkdirSync(path.dirname(PROFILES_FILE()), { recursive: true });
  fs.writeFileSync(PROFILES_FILE(), JSON.stringify([...all, saved], null, 2));
  return saved;
};

/* ─── runs ─── */

const readRun = (id: string): TestRun | null => {
  try {
    return JSON.parse(fs.readFileSync(runFile(id), "utf8")) as TestRun;
  } catch {
    return null;
  }
};
const writeRun = (run: TestRun) => {
  fs.mkdirSync(path.dirname(runFile(run.id)), { recursive: true });
  fs.writeFileSync(runFile(run.id), JSON.stringify(run, null, 2));
};

const stopping = new Set<string>();
/** Where this boot's output starts in the serial log, which is kept across boots: an old login prompt must not count. */
const bootMarks = new Map<string, number>();
const active = new Map<string, Promise<TestRun>>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the serial log, from `from` on, matches. */
const waitSerial = async (vmId: string, pattern: RegExp, from: number, timeoutMs: number, runId: string): Promise<{ matched: boolean; text: string }> => {
  const started = Date.now();
  let text = "";
  while (Date.now() - started < timeoutMs) {
    if (stopping.has(runId)) return { matched: false, text };
    text = clean(VmLab.serialLog(vmId, from).text);
    if (pattern.test(text)) return { matched: true, text };
    const state = VmLab.get(vmId)?.state;
    if (state !== "running" && state !== "paused" && state !== "starting") return { matched: false, text: `${text}\n(the VM is ${state})` };
    await sleep(500);
  }
  return { matched: false, text };
};

const toRegex = (pattern: string): RegExp => {
  const insensitive = pattern.startsWith("(?i)");
  return new RegExp(insensitive ? pattern.slice(4) : pattern, insensitive ? "im" : "m");
};

let counter = 0;

/** Type a command on the serial console and capture its output and exit code. */
export const runOnSerial = async (vmId: string, command: string, timeoutMs: number, runId = ""): Promise<{ done: boolean; exit: number | null; output: string }> => {
  const marker = `__AB${Date.now().toString(36)}${counter++}__`;
  const from = VmLab.serialLog(vmId).size;
  // The marker is printed with its exit code; the typed line shows "$?" there, so only the real one matches.
  await VmLab.writeSerial(vmId, `${command}; echo "${marker}$?${marker}"\n`);
  const result = await waitSerial(vmId, new RegExp(`${marker}(\\d+)${marker}`), from, timeoutMs, runId);
  const match = new RegExp(`${marker}(\\d+)${marker}`).exec(result.text);
  // Output: after the echoed command line, before the marker line.
  let output = result.text;
  const echoed = output.indexOf(`${marker}$?${marker}`);
  if (echoed >= 0) output = output.slice(output.indexOf("\n", echoed) + 1);
  if (match) output = output.slice(0, output.lastIndexOf(match[0])).replace(/[^\n]*$/, (tail) => tail);
  return { done: Boolean(match), exit: match ? Number(match[1]) : null, output: output.trim().slice(-6000) };
};

const describe = (step: Step): string => {
  switch (step.do) {
    case "start":
      return step.snapshot ? `boots from snapshot ${step.snapshot}` : "the VM starts";
    case "wait":
      return `the console shows /${step.for}/`;
    case "login":
      return step.user ? `logs in as ${step.user} and gets a shell` : "logs in and gets a shell";
    case "run":
      return `\`${step.command.slice(0, 120)}\` exits ${step.exit === "any" ? "(any code)" : step.exit ?? 0}${step.expect ? `, output matches /${step.expect}/` : ""}${step.reject ? `, output has no /${step.reject}/` : ""}`;
    case "screenshot":
      return step.minCoverage ? `the screen shows content (≥ ${Math.round(step.minCoverage * 1000) / 10}% non-background)` : "a screenshot";
    case "keys":
      return "keys are typed on the screen";
    case "click":
      return `a click at ${Math.round(step.x * 100)}%, ${Math.round(step.y * 100)}%`;
    case "send":
      return "text is typed on the console";
    case "restart":
      return "the VM resets";
    case "sleep":
      return `${step.ms} ms pass`;
  }
};

const perform = async (run: TestRun, vmId: string, step: Step, login: { user: string; password: string }): Promise<Omit<StepResult, "index" | "profile" | "what" | "step" | "startedAt" | "durationMs">> => {
  const dir = path.join(RUNS(), run.id);
  const expected = describe(step);
  switch (step.do) {
    case "start": {
      const vm = VmLab.get(vmId)!;
      // Already up: its prompt may have been printed a little while ago.
      const size = VmLab.serialLog(vmId).size;
      bootMarks.set(run.id, vm.state === "running" && !step.snapshot ? Math.max(0, size - 4096) : size);
      if (step.snapshot && vm.state === "stopped") await VmLab.restore(vmId, step.snapshot);
      if (vm.state !== "running") await VmLab.start(vmId);
      else if (step.snapshot) await VmLab.restore(vmId, step.snapshot);
      return { expected, actual: `running (${VmLab.get(vmId)!.state})`, result: "passed", output: "", screenshot: null };
    }
    case "wait": {
      const from = bootMarks.get(run.id) ?? Math.max(0, VmLab.serialLog(vmId).size - 4096);
      const result = await waitSerial(vmId, toRegex(step.for), from, step.timeoutMs ?? 120_000, run.id);
      return { expected, actual: result.matched ? "seen on the console" : `not seen within ${Math.round((step.timeoutMs ?? 120_000) / 1000)} s`, result: result.matched ? "passed" : step.optional ? "warned" : "failed", output: result.text.slice(-3000), screenshot: null };
    }
    case "login": {
      const user = step.user ?? login.user;
      const password = step.password ?? login.password;
      // Wake the console and get a fresh prompt.
      let from = VmLab.serialLog(vmId).size;
      await VmLab.writeSerial(vmId, "\n");
      const prompt = await waitSerial(vmId, /login:\s*$|[#$]\s*$/m, Math.max(0, from - 2048), step.timeoutMs ?? 120_000, run.id);
      if (!prompt.matched) return { expected, actual: "no login prompt or shell", result: "failed", output: prompt.text.slice(-2000), screenshot: null };
      if (/login:\s*$/m.test(prompt.text.split("\n").slice(-3).join("\n"))) {
        from = VmLab.serialLog(vmId).size;
        await VmLab.writeSerial(vmId, `${user}\n`);
        const next = await waitSerial(vmId, /Password:|[#$]\s*$/im, from, 60_000, run.id);
        if (/Password:/i.test(next.text)) {
          from = VmLab.serialLog(vmId).size;
          await VmLab.writeSerial(vmId, `${password}\n`);
          await waitSerial(vmId, /[#$]\s*$|incorrect|failed/im, from, 60_000, run.id);
        }
      }
      const check = await runOnSerial(vmId, "echo shell-ok; id -un", 60_000, run.id);
      const ok = check.done && check.exit === 0 && /shell-ok/.test(check.output);
      return { expected, actual: ok ? `shell as ${check.output.split("\n").pop()?.trim()}` : "no shell after logging in", result: ok ? "passed" : "failed", output: check.output, screenshot: null };
    }
    case "run": {
      const timeout = step.timeoutMs ?? 120_000;
      const result = await runOnSerial(vmId, step.command, timeout, run.id);
      if (!result.done) return { expected, actual: `no answer within ${Math.round(timeout / 1000)} s`, result: step.optional ? "warned" : "failed", output: result.output, screenshot: null };
      const exitOk = step.exit === "any" || result.exit === (step.exit ?? 0);
      const expectOk = !step.expect || toRegex(step.expect).test(result.output);
      const rejectOk = !step.reject || !toRegex(step.reject).test(result.output);
      const passed = exitOk && expectOk && rejectOk;
      const why = [!exitOk ? `exit ${result.exit}` : "", !expectOk ? "output did not match" : "", !rejectOk ? "output had what it must not" : ""].filter(Boolean).join(", ");
      return { expected, actual: passed ? `exit ${result.exit}` : why, result: passed ? "passed" : step.optional ? "warned" : "failed", output: result.output, screenshot: null };
    }
    case "send":
      await VmLab.writeSerial(vmId, step.text);
      return { expected, actual: "typed", result: "passed", output: "", screenshot: null };
    case "keys":
      if (step.combos) await VmLab.sendKeys(vmId, step.combos);
      if (step.text) await VmLab.typeText(vmId, step.text);
      return { expected, actual: "typed", result: "passed", output: "", screenshot: null };
    case "click":
      await VmLab.mouse(vmId, step.x, step.y, step.button ?? "left");
      return { expected, actual: "clicked", result: "passed", output: "", screenshot: null };
    case "screenshot": {
      let shot = await VmLab.screenshot(vmId, dir);
      // The screen can be black for a moment while a display server starts: look again, within the limit.
      const until = Date.now() + (step.withinMs ?? 0);
      while (step.minCoverage && shot.coverage < step.minCoverage && Date.now() < until && !stopping.has(run.id)) {
        await sleep(5000);
        fs.rmSync(shot.file, { force: true });
        shot = await VmLab.screenshot(vmId, dir);
      }
      const name = `${String(run.steps.length + 1).padStart(3, "0")}-${step.name.replace(/[^A-Za-z0-9_-]+/g, "-")}.png`;
      fs.renameSync(shot.file, path.join(dir, name));
      const ok = !step.minCoverage || shot.coverage >= step.minCoverage;
      return {
        expected,
        actual: `${shot.width}×${shot.height}, ${Math.round(shot.coverage * 1000) / 10}% non-background, ${shot.colours} colours`,
        result: ok ? "passed" : step.optional ? "warned" : "failed",
        output: "",
        screenshot: name
      };
    }
    case "restart":
      bootMarks.set(run.id, VmLab.serialLog(vmId).size);
      await VmLab.restart(vmId);
      return { expected, actual: "reset", result: "passed", output: "", screenshot: null };
    case "sleep":
      await sleep(Math.min(step.ms, 10 * 60_000));
      return { expected, actual: "waited", result: "passed", output: "", screenshot: null };
  }
};

export interface StartRun {
  vmId: string;
  profiles: string[];
  agent?: string;
  task?: string | null;
  login?: { user?: string; password?: string };
  label?: string | null;
  /** A screenshot every this many seconds while it runs (a recording). */
  recordEverySec?: number;
}

export const VmTests = {
  profiles,
  saveProfile,

  list(limit = 50): TestRun[] {
    if (!fs.existsSync(RUNS())) return [];
    return fs
      .readdirSync(RUNS())
      .map((id) => readRun(id))
      .filter((r): r is TestRun => r !== null)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit);
  },

  get: readRun,

  file(runId: string, name: string): string | null {
    if (!/^[A-Za-z0-9_-]+$/.test(runId) || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
    const file = path.join(RUNS(), runId, name);
    return fs.existsSync(file) ? file : null;
  },

  /** Start a run in the background; returns at once with its record. */
  start(input: StartRun): TestRun {
    const vm = VmLab.get(input.vmId);
    if (!vm) throw new Error("Unknown VM.");
    if ([...active.keys()].some((id) => readRun(id)?.vmId === vm.id)) throw new Error("A test run is already using this VM.");
    const known = new Map(profiles().map((p) => [p.id, p]));
    const chosen = (input.profiles.length ? input.profiles : FULL).filter((id) => known.has(id));
    if (!chosen.length) throw new Error("Choose at least one known profile.");
    let isoModifiedAt: string | null = null;
    try {
      isoModifiedAt = vm.iso ? fs.statSync(vm.iso).mtime.toISOString() : null;
    } catch {
      isoModifiedAt = null;
    }
    const run: TestRun = {
      id: `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      vmId: vm.id,
      vmName: vm.name,
      build: { iso: vm.iso ? path.basename(vm.iso) : null, isoModifiedAt, label: input.label ?? null },
      profiles: chosen,
      agent: input.agent ?? "owner",
      task: input.task ?? null,
      state: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      steps: [],
      counts: { passed: 0, failed: 0, warned: 0, skipped: 0 },
      frames: [],
      error: null,
      feedback: []
    };
    writeRun(run);
    const work = VmTests.execute(run, chosen.map((id) => known.get(id)!), { user: input.login?.user ?? "root", password: input.login?.password ?? "" }, input.recordEverySec ?? 0);
    active.set(run.id, work);
    void work.finally(() => active.delete(run.id));
    return run;
  },

  /** Runs to the end (the same as start, awaited): for the continuous builder's checks and the tests. */
  async runToEnd(input: StartRun): Promise<TestRun> {
    const run = VmTests.start(input);
    return (await active.get(run.id)) ?? readRun(run.id)!;
  },

  async execute(run: TestRun, chosen: Profile[], login: { user: string; password: string }, recordEverySec: number): Promise<TestRun> {
    const dir = path.join(RUNS(), run.id);
    let recorder: NodeJS.Timeout | null = null;
    if (recordEverySec > 0) {
      recorder = setInterval(() => {
        void VmLab.screenshot(run.vmId, path.join(dir, "frames"))
          .then((shot) => {
            run.frames.push(path.basename(shot.file));
          })
          .catch(() => undefined);
      }, Math.max(2, recordEverySec) * 1000);
    }
    try {
      for (const profile of chosen) {
        for (const step of profile.steps) {
          if (stopping.has(run.id)) throw new Error("stopped");
          const started = Date.now();
          let outcome: Awaited<ReturnType<typeof perform>>;
          try {
            outcome = await perform(run, run.vmId, step, login);
          } catch (error) {
            outcome = { expected: describe(step), actual: (error as Error).message, result: "failed", output: "", screenshot: null };
          }
          const result: StepResult = {
            index: run.steps.length,
            profile: profile.id,
            what: step.what ?? step.do,
            step,
            ...outcome,
            startedAt: new Date(started).toISOString(),
            durationMs: Date.now() - started
          };
          run.steps.push(result);
          run.counts[result.result] += 1;
          writeRun(run);
          // A VM that did not start or boot fails everything after it: say so instead of timing out on each.
          if (result.result === "failed" && (step.do === "start" || (step.do === "wait" && profile.id === "boot"))) {
            for (const rest of chosen.flatMap((p) => p.steps.map((s) => ({ p, s }))).slice(run.steps.length)) {
              run.steps.push({ index: run.steps.length, profile: rest.p.id, what: rest.s.what ?? rest.s.do, step: rest.s, expected: describe(rest.s), actual: "not run: the system did not boot", result: "skipped", output: "", screenshot: null, startedAt: new Date().toISOString(), durationMs: 0 });
              run.counts.skipped += 1;
            }
            throw new Error("The system did not boot.");
          }
        }
      }
      run.state = run.counts.failed ? "failed" : "passed";
    } catch (error) {
      const message = (error as Error).message;
      run.state = message === "stopped" ? "stopped" : run.counts.failed ? "failed" : "error";
      if (message !== "stopped" && message !== "The system did not boot.") run.error = message;
      if (message === "The system did not boot.") run.state = "failed";
    } finally {
      if (recorder) clearInterval(recorder);
      stopping.delete(run.id);
      bootMarks.delete(run.id);
      run.finishedAt = new Date().toISOString();
      // The whole serial log of the run, as evidence.
      try {
        fs.writeFileSync(path.join(dir, "serial.log"), clean(VmLab.serialLog(run.vmId, 0, 2 * 1024 * 1024).text));
      } catch {
        // No log.
      }
      writeRun(run);
      const failures = run.steps.filter((s) => s.result === "failed");
      Evidence.record({
        kind: "vm-test",
        ref: `vmrun:${run.id}`,
        task: run.task,
        agent: run.agent,
        title: `${run.vmName}: ${run.profiles.join(", ")} — ${run.state} (${run.counts.passed} passed, ${run.counts.failed} failed, ${run.counts.warned} warnings)`,
        outcome: run.state,
        data: { build: run.build, counts: run.counts, failures: failures.map((f) => ({ what: f.what, expected: f.expected, actual: f.actual })) },
        links: [{ to: `vm:${run.vmId}`, relation: "tested" }, ...(run.task ? [{ to: run.task, relation: "tested-for" }] : [])]
      });
      Logger.log("VM test run finished", { run: run.id, state: run.state, counts: run.counts });
    }
    return run;
  },

  stop(runId: string): TestRun | null {
    if (active.has(runId)) stopping.add(runId);
    return readRun(runId);
  },

  /** The owner's comment on a run (a defect, a critique, a request): kept with it, and as evidence linked to it. */
  feedback(runId: string, input: { text: string; kind?: string; by?: string; followUp?: string | null }): TestRun {
    const run = readRun(runId);
    if (!run) throw new Error("Unknown test run.");
    const text = input.text.trim().slice(0, 3000);
    if (!text) throw new Error("Write the feedback.");
    const item = { at: new Date().toISOString(), by: input.by ?? "owner", text, kind: (input.kind ?? "comment").slice(0, 30), followUp: input.followUp ?? null };
    run.feedback.push(item);
    writeRun(run);
    Evidence.record({ kind: "feedback", ref: `feedback:vmrun:${run.id}:${run.feedback.length}`, task: run.task, agent: item.by, title: `${item.kind} on ${run.vmName}: ${text.slice(0, 120)}`, outcome: "open", data: item, links: [{ to: `vmrun:${run.id}`, relation: "feedback-on" }] });
    return run;
  },

  /** Plain-text account of a run's failures, for a builder to fix them. */
  failureReport(run: TestRun): string {
    const failed = run.steps.filter((s) => s.result === "failed");
    if (!failed.length) return "";
    return `VM test run ${run.id} on ${run.vmName} (${run.build.iso ?? "disk"}) failed ${failed.length} step(s):\n${failed
      .map((s) => `- [${s.profile}] ${s.what}: expected ${s.expected}; got ${s.actual}${s.output ? `\n  output:\n  ${s.output.slice(-800).split("\n").join("\n  ")}` : ""}`)
      .join("\n")}`;
  }
};
