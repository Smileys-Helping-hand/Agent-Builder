import fs from "fs";
import type { Task } from "../orchestrator/types.js";

export type MemorySnapshot = Record<string, Task>;

export class MemoryStore {
  private static path = "./data/memory.json";

  static load(): MemorySnapshot {
    if (!fs.existsSync(this.path)) return {};
    return JSON.parse(fs.readFileSync(this.path, "utf8")) as MemorySnapshot;
  }

  static save(data: MemorySnapshot) {
    fs.mkdirSync("./data", { recursive: true });
    fs.writeFileSync(this.path, JSON.stringify(data, null, 2));
  }
}
