/**
 * Run a PowerShell script and read its JSON answer.
 *
 * The script is passed as -EncodedCommand (UTF-16LE base64), so nothing in it
 * needs quoting. Output that is not JSON is an error with the first of it.
 * Never used with text that came from a request: the system modules build
 * every script from constants and validated values only.
 */
import { execFile } from "child_process";

export const powershellJson = <T>(script: string, timeoutMs = 60_000): Promise<T> =>
  new Promise((resolve, reject) => {
    if (process.platform !== "win32") return reject(new Error("This needs Windows (PowerShell)."));
    const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='SilentlyContinue'\n${script}`, "utf16le").toString("base64");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        const text = String(stdout ?? "").trim();
        const start = text.search(/[[{]/);
        if (start >= 0) {
          try {
            return resolve(JSON.parse(text.slice(start)) as T);
          } catch {
            // fall through to the error below
          }
        }
        reject(new Error(error ? `PowerShell failed: ${error.message.split("\n")[0]}` : `PowerShell gave no JSON: ${text.slice(0, 200)}`));
      }
    );
  });

/** A value safe to put inside a single-quoted PowerShell string. */
export const psQuote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
