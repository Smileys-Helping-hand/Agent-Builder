import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { Logger } from "../../utils/Logger.js";

class ProcessManager {
  private static instance: ProcessManager;
  private process: ChildProcessWithoutNullStreams | null = null;
  private logs: string[] = [];

  static getInstance() {
    if (!this.instance) {
      this.instance = new ProcessManager();
    }
    return this.instance;
  }

  startBackendProcess() {
    if (this.process) {
      return { running: true, message: "Backend already running" };
    }

    const cwd = process.cwd();
    this.process = spawn(/^win/.test(process.platform) ? "npm.cmd" : "npm", ["run", "start"], {
      cwd,
      env: { ...process.env },
      shell: true
    });

    this.process.stdout.on("data", (data) => this.appendLog(data.toString()));
    this.process.stderr.on("data", (data) => this.appendLog(data.toString()));
    this.process.on("exit", (code) => {
      this.appendLog(`Backend process exited with code ${code ?? "unknown"}`);
      this.process = null;
    });

    return { running: true, message: "Backend started", pid: this.process.pid };
  }

  stopBackendProcess() {
    if (!this.process) {
      return { running: false, message: "Backend not running" };
    }
    this.process.kill();
    this.process = null;
    this.appendLog("Backend process stopped by user");
    return { running: false, message: "Backend stopped" };
  }

  readLogs(limit = 200) {
    return this.logs.slice(-limit);
  }

  status() {
    return { running: Boolean(this.process?.pid), pid: this.process?.pid ?? null };
  }

  private appendLog(line: string) {
    this.logs.push(line.trim());
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(-500);
    }
    Logger.log(line.trim());
  }
}

export const registerProcessRoutes = (app: import("express").Application) => {
  const manager = ProcessManager.getInstance();

  app.post("/api/system/start-backend", (_req, res) => {
    const result = manager.startBackendProcess();
    res.json(result);
  });

  app.post("/api/system/stop-backend", (_req, res) => {
    const result = manager.stopBackendProcess();
    res.json(result);
  });

  app.get("/api/system/logs", (_req, res) => {
    res.json({ logs: manager.readLogs(), status: manager.status() });
  });
};

export { ProcessManager };
