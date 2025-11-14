import fs from "fs";
import path from "path";

export type FeedbackRecord = {
  id: string;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

const FEEDBACK_PATH = path.resolve("./data/feedback.jsonl");
const CURSOR_PATH = path.resolve("./data/feedback.cursor");

const ensureFiles = async () => {
  await fs.promises.mkdir(path.dirname(FEEDBACK_PATH), { recursive: true });
  if (!fs.existsSync(FEEDBACK_PATH)) {
    await fs.promises.writeFile(FEEDBACK_PATH, "");
  }
  if (!fs.existsSync(CURSOR_PATH)) {
    await fs.promises.writeFile(CURSOR_PATH, "0");
  }
};

const readCursor = async (): Promise<number> => {
  await ensureFiles();
  const raw = await fs.promises.readFile(CURSOR_PATH, "utf8");
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

const writeCursor = async (value: number) => {
  await ensureFiles();
  await fs.promises.writeFile(CURSOR_PATH, String(Math.max(0, Math.floor(value))));
};

export class FeedbackStore {
  static async append(record: FeedbackRecord): Promise<void> {
    await ensureFiles();
    const line = JSON.stringify(record);
    await fs.promises.appendFile(FEEDBACK_PATH, `${line}\n`);
  }

  static async listRecent(limit = 50): Promise<FeedbackRecord[]> {
    await ensureFiles();
    const content = await fs.promises.readFile(FEEDBACK_PATH, "utf8");
    const lines = content
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-limit);
    return lines.map((line) => {
      try {
        return JSON.parse(line) as FeedbackRecord;
      } catch (error) {
        return {
          id: `parse-${Date.now()}`,
          source: "feedback-store",
          message: line,
          createdAt: new Date().toISOString()
        } satisfies FeedbackRecord;
      }
    });
  }

  static async consume(limit = 50): Promise<FeedbackRecord[]> {
    await ensureFiles();
    const cursor = await readCursor();
    const content = await fs.promises.readFile(FEEDBACK_PATH, "utf8");
    const lines = content
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (cursor >= lines.length) {
      return [];
    }
    const slice = lines.slice(cursor, cursor + limit);
    const records: FeedbackRecord[] = slice.map((line, index) => {
      try {
        return JSON.parse(line) as FeedbackRecord;
      } catch (error) {
        return {
          id: `parse-${cursor + index}`,
          source: "feedback-store",
          message: line,
          createdAt: new Date().toISOString()
        } satisfies FeedbackRecord;
      }
    });
    await writeCursor(cursor + records.length);
    return records;
  }
}
