/**
 * ResearchChat — talk to a research topic and learn from it.
 *
 * Answers come from what the topic has actually found (each finding is
 * numbered and cited as [F12]), not from the model's general knowledge, and it
 * says so plainly when its research does not cover the question — then the
 * app offers to research exactly that next. Quick prompts ("explain it to a
 * beginner", "quiz me", "what is still uncertain") make it a tutor.
 *
 * The conversation is kept per topic in data/knowledge.db.
 */
import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { ResearchStore, type ResearchFinding } from "./ResearchStore.js";

export interface ChatMessage {
  id: number;
  topicId: string;
  role: "you" | "research";
  text: string;
  /** Finding ids the answer cites. */
  cites: number[];
  /** The answer says its research does not cover this: offer to research it. */
  gap: boolean;
  createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS research_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  cites TEXT NOT NULL DEFAULT '[]',
  gap INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_messages ON research_messages(topic_id, id);
`;

let ready = false;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    ready = true;
  }
  return database;
};

type Row = { id: number; topic_id: string; role: string; text: string; cites: string; gap: number; created_at: string };
const fromRow = (row: Row): ChatMessage => ({
  id: row.id,
  topicId: row.topic_id,
  role: row.role === "you" ? "you" : "research",
  text: row.text,
  cites: (() => {
    try {
      return JSON.parse(row.cites) as number[];
    } catch {
      return [];
    }
  })(),
  gap: row.gap === 1,
  createdAt: row.created_at
});

const save = (topicId: string, role: ChatMessage["role"], text: string, cites: number[] = [], gap = false): ChatMessage => {
  const result = db()
    .prepare("INSERT INTO research_messages (topic_id, role, text, cites, gap, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(topicId, role, text, JSON.stringify(cites), gap ? 1 : 0, nowIso());
  return fromRow(db().prepare("SELECT * FROM research_messages WHERE id = ?").get(result.lastInsertRowid) as Row);
};

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/** The findings worth putting in front of the model for this question. */
const groundingFor = (topicId: string, question: string): ResearchFinding[] => {
  const all = ResearchStore.listFindings(topicId, 300, "strongest").filter((finding) => finding.status !== "contested");
  const asked = words(question);
  const scored = all.map((finding) => {
    const overlap = [...words(finding.claim)].filter((word) => asked.has(word)).length;
    return { finding, score: overlap * 2 + finding.confidence + (finding.status === "corroborated" ? 1 : 0) };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 18)
    .map((item) => item.finding);
};

export const ResearchChat = {
  history(topicId: string, limit = 60): ChatMessage[] {
    const rows = db()
      .prepare("SELECT * FROM (SELECT * FROM research_messages WHERE topic_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
      .all(topicId, limit) as Row[];
    return rows.map(fromRow);
  },

  clear(topicId: string): number {
    return db().prepare("DELETE FROM research_messages WHERE topic_id = ?").run(topicId).changes;
  },

  async ask(topicId: string, message: string): Promise<{ question: ChatMessage; answer: ChatMessage; findings: ResearchFinding[] }> {
    const topic = ResearchStore.getTopic(topicId);
    if (!topic) throw new Error("Research topic not found.");
    const text = message.replace(/\s+$/g, "").trim().slice(0, 2000);
    if (text.length < 2) throw new Error("Ask something first.");

    const earlier = ResearchChat.history(topicId, 8);
    const question = save(topicId, "you", text);
    const findings = groundingFor(topicId, `${text} ${earlier.filter((m) => m.role === "you").slice(-2).map((m) => m.text).join(" ")}`);

    const prompt = `You are the research assistant for the topic "${topic.title}" (main question: ${topic.question}).
You have studied sources and recorded the findings below. You are also a patient teacher: the person wants to
understand and learn from what you found.

Findings (cite them like [F12] when you use them; confirmed means several sources agree):
${findings.map((f) => `[F${f.id}] ${f.claim} (${Math.round(f.confidence * 100)}%${f.status === "corroborated" ? ", confirmed" : ""}${f.sourceTitle ? `, source: ${f.sourceTitle}` : ""})`).join("\n") || "(no findings yet)"}

Conversation so far:
${earlier.map((m) => `${m.role === "you" ? "Person" : "You"}: ${m.text}`).join("\n") || "(this is the start)"}

Person: ${text}

How to answer:
- Base the answer on the findings above and cite each one you use, like [F12]. Do not invent facts or sources.
- Explain plainly, with a concrete example where it helps. Short paragraphs or a short list.
- If the findings do not cover the question (or only partly), say so in one sentence that starts exactly with
  "My research does not cover" and say what you would look into. Then give what partial answer you can.
- If they ask to be quizzed, ask 3 questions from the findings, one at a time is fine.
Answer now, without a preamble.`;

    const reply = (await ModelRouter.generate(prompt)).trim();
    const cites = Array.from(new Set(Array.from(reply.matchAll(/\[F(\d+)\]/g)).map((m) => Number(m[1])))).filter((id) =>
      findings.some((f) => f.id === id)
    );
    const gap = /my research does not cover/i.test(reply) || findings.length === 0;
    const answer = save(topicId, "research", reply || "I could not put an answer together just now. Try asking again.", cites, gap);
    ResearchStore.logActivity(topicId, topic.cycles, "thought", `You asked: "${text.slice(0, 120)}"${gap ? " — not covered yet" : ""}`);
    return { question, answer, findings: findings.filter((f) => cites.includes(f.id)) };
  }
};
