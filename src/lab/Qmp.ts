/**
 * A QMP (QEMU Machine Protocol) client: JSON commands to a running VM over
 * TCP — pause, resume, reset, power off, screenshots, keys, snapshots — and
 * its events (SHUTDOWN, STOP, RESUME…).
 */
import { EventEmitter } from "events";
import net from "net";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class Qmp extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = "";
  private queue: Pending[] = [];
  private ready = false;

  constructor(private readonly port: number, private readonly host = "127.0.0.1") {
    super();
  }

  get connected(): boolean {
    return this.ready && Boolean(this.socket && !this.socket.destroyed);
  }

  /** Connect and negotiate capabilities; retries while the VM is still starting. */
  async connect(timeoutMs = 20_000): Promise<void> {
    const started = Date.now();
    let lastError: unknown = null;
    while (Date.now() - started < timeoutMs) {
      try {
        await this.open();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw new Error(`Could not reach the VM's control port ${this.port}: ${(lastError as Error)?.message ?? lastError}`);
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.port, this.host);
      let greeted = false;
      const fail = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.setEncoding("utf8");
      socket.once("error", fail);
      socket.on("data", (chunk: string) => {
        this.buffer += chunk;
        let index: number;
        while ((index = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, index).trim();
          this.buffer = this.buffer.slice(index + 1);
          if (!line) continue;
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (!greeted && message.QMP) {
            greeted = true;
            socket.write(`${JSON.stringify({ execute: "qmp_capabilities" })}\n`);
            continue;
          }
          if (message.event) {
            this.emit("event", message);
            continue;
          }
          if (!this.ready && "return" in message) {
            this.ready = true;
            socket.off("error", fail);
            socket.on("error", () => undefined);
            resolve();
            continue;
          }
          const pending = this.queue.shift();
          if (!pending) continue;
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(String((message.error as { desc?: string }).desc ?? "QMP error")));
          else pending.resolve(message.return);
        }
      });
      socket.on("close", () => {
        this.ready = false;
        for (const pending of this.queue.splice(0)) {
          clearTimeout(pending.timer);
          pending.reject(new Error("The VM's control connection closed."));
        }
        this.emit("close");
      });
      this.socket = socket;
      setTimeout(() => {
        if (!this.ready) fail(new Error("no QMP greeting"));
      }, 5000);
    });
  }

  command<T = unknown>(execute: string, args?: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    if (!this.socket || !this.ready) return Promise.reject(new Error("The VM's control connection is not open."));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.queue.findIndex((p) => p.timer === timer);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new Error(`${execute} timed out`));
      }, timeoutMs);
      this.queue.push({ resolve: resolve as (value: unknown) => void, reject, timer });
      this.socket!.write(`${JSON.stringify(args ? { execute, arguments: args } : { execute })}\n`);
    });
  }

  /** The human monitor (savevm, loadvm, info snapshots…), for what QMP has no command for. */
  async hmp(commandLine: string, timeoutMs = 120_000): Promise<string> {
    return String(await this.command("human-monitor-command", { "command-line": commandLine }, timeoutMs));
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
    this.ready = false;
  }
}

/** Characters as QEMU key codes, for typing into a VM's screen. */
const SHIFTED: Record<string, string> = {
  "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  _: "minus", "+": "equal", "{": "bracket_left", "}": "bracket_right", "|": "backslash", ":": "semicolon",
  '"': "apostrophe", "~": "grave_accent", "<": "comma", ">": "dot", "?": "slash"
};
const PLAIN: Record<string, string> = {
  " ": "spc", "\n": "ret", "\t": "tab", "-": "minus", "=": "equal", "[": "bracket_left", "]": "bracket_right",
  "\\": "backslash", ";": "semicolon", "'": "apostrophe", "`": "grave_accent", ",": "comma", ".": "dot", "/": "slash"
};

/** One send-key per character: [["shift","a"], ["b"], …]. */
export const keysFor = (text: string): string[][] =>
  [...text].map((ch) => {
    if (/[a-z0-9]/.test(ch)) return [ch];
    if (/[A-Z]/.test(ch)) return ["shift", ch.toLowerCase()];
    if (PLAIN[ch]) return [PLAIN[ch]];
    if (SHIFTED[ch]) return ["shift", SHIFTED[ch]];
    return [];
  }).filter((keys) => keys.length);
