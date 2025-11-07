import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export type TemplateRecord = {
  id: string;
  name: string;
  description?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

const TEMPLATE_PATH = path.resolve("./data/templates.json");

const ensureStore = async () => {
  await fs.promises.mkdir(path.dirname(TEMPLATE_PATH), { recursive: true });
};

const readStore = async (): Promise<TemplateRecord[]> => {
  try {
    const raw = await fs.promises.readFile(TEMPLATE_PATH, "utf8");
    return JSON.parse(raw) as TemplateRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeStore = async (records: TemplateRecord[]) => {
  await ensureStore();
  await fs.promises.writeFile(TEMPLATE_PATH, JSON.stringify(records, null, 2));
};

export class TemplateLibrary {
  static async list(): Promise<TemplateRecord[]> {
    return readStore();
  }

  static async create(entry: Omit<TemplateRecord, "id" | "createdAt" | "updatedAt">): Promise<TemplateRecord> {
    const records = await readStore();
    const now = new Date().toISOString();
    const record: TemplateRecord = { ...entry, id: uuidv4(), createdAt: now, updatedAt: now };
    records.push(record);
    await writeStore(records);
    return record;
  }

  static async update(id: string, patch: Partial<TemplateRecord>): Promise<TemplateRecord | null> {
    const records = await readStore();
    const record = records.find((item) => item.id === id);
    if (!record) return null;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    await writeStore(records);
    return record;
  }

  static async remove(id: string) {
    const records = await readStore();
    const filtered = records.filter((item) => item.id !== id);
    await writeStore(filtered);
  }
}
