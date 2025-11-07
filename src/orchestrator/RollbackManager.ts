import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { Task } from "./types.js";

export type RollbackRecord = {
  id: string;
  taskId: string;
  snapshot: Task;
  createdAt: string;
};

const ROLLBACK_PATH = path.resolve("./data/rollbacks.json");

const readRecords = async (): Promise<RollbackRecord[]> => {
  try {
    const raw = await fs.promises.readFile(ROLLBACK_PATH, "utf8");
    return JSON.parse(raw) as RollbackRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeRecords = async (records: RollbackRecord[]) => {
  await fs.promises.mkdir(path.dirname(ROLLBACK_PATH), { recursive: true });
  await fs.promises.writeFile(ROLLBACK_PATH, JSON.stringify(records, null, 2));
};

export class RollbackManager {
  static async capture(task: Task): Promise<RollbackRecord> {
    const records = await readRecords();
    const record: RollbackRecord = {
      id: uuidv4(),
      taskId: task.id,
      snapshot: { ...task },
      createdAt: new Date().toISOString()
    };
    records.push(record);
    await writeRecords(records);
    return record;
  }

  static async list(taskId?: string) {
    const records = await readRecords();
    if (!taskId) return records;
    return records.filter((record) => record.taskId === taskId);
  }

  static async restore(recordId: string): Promise<Task | null> {
    const records = await readRecords();
    const match = records.find((record) => record.id === recordId);
    return match ? { ...match.snapshot } : null;
  }
}
