/**
 * One failure in a background job must not take the builder down.
 *
 * Node ends the process on an unhandled promise rejection or an uncaught
 * exception. In this server those come from timers and loops (research cycles,
 * the order poller, scans), not from the request a customer's build depends
 * on, and ending the process stops every build in flight: a "database is
 * locked" in a research timer once killed a customer build mid-pass. So they
 * are logged and the builder carries on.
 *
 * Something really broken throws again and again; past a burst of them the
 * process does exit, and the launcher's watchdog starts a fresh one.
 *
 * Imported for its effect, as early as possible (server.ts).
 */
import { Logger } from "./Logger.js";

const BURST = 20;
const WINDOW_MS = 60_000;
let recent: number[] = [];

const survive = (kind: "uncaughtException" | "unhandledRejection", reason: unknown): void => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  const now = Date.now();
  recent = [...recent.filter((at) => now - at < WINDOW_MS), now];
  Logger.error(`Survived an ${kind}; the builder keeps running`, {
    error: error.message,
    stack: error.stack?.split("\n").slice(0, 8).join("\n"),
    inLastMinute: recent.length
  });
  if (recent.length >= BURST) {
    Logger.error(`${recent.length} failures in a minute; exiting so the launcher starts a fresh builder`);
    // A moment for the log line to reach the file.
    setTimeout(() => process.exit(1), 500).unref();
  }
};

if (!(globalThis as { __crashGuard?: boolean }).__crashGuard) {
  (globalThis as { __crashGuard?: boolean }).__crashGuard = true;
  process.on("uncaughtException", (error) => survive("uncaughtException", error));
  process.on("unhandledRejection", (reason) => survive("unhandledRejection", reason));
}
