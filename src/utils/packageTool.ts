/**
 * npm and npx as a command and arguments for execFile/spawn.
 *
 * On Windows they are .cmd scripts, which Node only starts through a shell,
 * and Node 24 deprecates passing arguments beside `shell: true` (DEP0190)
 * because it joins them unescaped. So on Windows the command line is built
 * here, each argument quoted where it needs it, and handed over as one string
 * with no separate arguments. Elsewhere nothing changes.
 */
export const isWindows = process.platform === "win32";

/** cmd.exe quoting: plain tokens as they are, anything else in double quotes. */
const quote = (arg: string): string => (/^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);

/** One cmd.exe command line, for a shell spawn with no separate arguments. */
export const commandLine = (command: string, args: string[]): string => [command, ...args].map(quote).join(" ");

export const packageTool = (tool: "npm" | "npx", args: string[]): { file: string; args: string[] } =>
  isWindows ? { file: commandLine(`${tool}.cmd`, args), args: [] } : { file: tool, args };
