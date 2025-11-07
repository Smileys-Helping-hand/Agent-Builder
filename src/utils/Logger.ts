import { emitServerEvent } from "../server/eventBus.js";
import { LogStore } from "../state/LogStore.js";

const stringify = (values: any[]) =>
  values
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value, null, 2);
      } catch (error) {
        return String(value);
      }
    })
    .join(" ");

const createPayload = (level: "info" | "warn" | "error", values: any[]) => ({
  level,
  message: stringify(values),
  timestamp: new Date().toISOString()
});

export class Logger {
  private static async write(level: "info" | "warn" | "error", args: any[]) {
    const payload = createPayload(level, args);
    const contextArg = args.find((value) => typeof value === "object" && value !== null);
    const entry = {
      ...payload,
      context: contextArg && typeof contextArg === "object" ? (contextArg as Record<string, unknown>) : undefined
    };
    console.log(JSON.stringify({ source: "agent-builder", ...entry }));
    try {
      await LogStore.append(entry);
    } catch (error) {
      console.error("Failed to persist log entry", error);
    }
    emitServerEvent({ type: "log", payload });
  }
  static error(...args: any[]) {
    void this.write("error", args);
  }
  static warn(...args: any[]) {
    void this.write("warn", args);
  }
  static log(...args: any[]) {
    void this.write("info", args);
  }
}
