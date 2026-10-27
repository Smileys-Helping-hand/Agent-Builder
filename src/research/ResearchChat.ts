/**
 * ResearchChat — talk to a research topic and learn from it.
 *
 * Answers come from what the topic has actually found (each finding is
 * numbered and cited as [F12]), not from the model's general knowledge, and it
 * says so plainly when its research does not cover the question — then the
 * app offers to research exactly that next. Quick prompts ("explain it to a
 * beginner", "quiz me", "what is still uncertain") make it a tutor.
 *
 * Every finding goes to the model with the kind of evidence it rests on
 * (academic, reference, community, speculative, fiction: SourceCredibility),
 * and the answer must keep them apart — a worldbuilding guide is not evidence
 * about the real world.
 *
 * A local model takes minutes to answer, longer than the app's tunnel holds a
 * request open (Cloudflare: 100 s), so start() returns at once and the answer
 * is written in the background; the app polls pending() and shows the text as
 * it is written. Asking goes ahead of research cycles on the GPU.
 *
 * The conversation is kept per topic in data/knowledge.db.
 */
import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { gpuLock } from "../utils/GpuLock.js";
import { Logger } from "../utils/Logger.js";
import { ResearchStore, type ResearchFinding } from "./ResearchStore.js";
import { classifySource } from "./SourceCredibility.js";
import { SharedKnowledge } from "../knowledge/SharedKnowledge.js";
import { Reinforcement } from "../learning/Reinforcement.js";

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
  /** An answer: the question it answers (several when asked to answer differently). */
  answers: number | null;
  /** The reinforcement-learning episode it was written in. */
  episodeId: number | null;
  /** 1 👍, -1 👎, 0 none. */
  feedback: number;
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
    // Columns added for answering differently and learning from feedback.
    const columns = new Set((database.prepare("PRAGMA table_info(research_messages)").all() as Array<{ name: string }>).map((c) => c.name));
    if (!columns.has("answers")) database.exec("ALTER TABLE research_messages ADD COLUMN answers INTEGER");
    if (!columns.has("episode_id")) database.exec("ALTER TABLE research_messages ADD COLUMN episode_id INTEGER");
    if (!columns.has("feedback")) database.exec("ALTER TABLE research_messages ADD COLUMN feedback INTEGER NOT NULL DEFAULT 0");
    ready = true;
  }
  return database;
};

type Row = {
  id: number;
  topic_id: string;
  role: string;
  text: string;
  cites: string;
  gap: number;
  created_at: string;
  answers: number | null;
  episode_id: number | null;
  feedback: number | null;
};
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
  createdAt: row.created_at,
  answers: row.answers ?? null,
  episodeId: row.episode_id ?? null,
  feedback: row.feedback ?? 0
});

const save = (
  topicId: string,
  role: ChatMessage["role"],
  text: string,
  cites: number[] = [],
  gap = false,
  answers: number | null = null,
  episodeId: number | null = null
): ChatMessage => {
  const result = db()
    .prepare("INSERT INTO research_messages (topic_id, role, text, cites, gap, created_at, answers, episode_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(topicId, role, text, JSON.stringify(cites), gap ? 1 : 0, nowIso(), answers, episodeId);
  return fromRow(db().prepare("SELECT * FROM research_messages WHERE id = ?").get(result.lastInsertRowid) as Row);
};

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

/** The findings worth putting in front of the model for this question: by overlap, full-text match and strength. */
const groundingFor = (topicId: string, question: string, title: string): ResearchFinding[] => {
  const all = ResearchStore.listFindings(topicId, 400, "strongest").filter((finding) => finding.status !== "contested");
  // The topic's own name counts too: "I mean pocket dimensions" on a topic
  // called "Pocket Dimensions" should pull in the pocket-dimension findings.
  const asked = new Set([...words(question), ...words(title)]);
  const fts = new Set(
    ResearchStore.search(question, 60)
      .filter((hit) => hit.topicId === topicId && hit.kind === "finding")
      .map((hit) => Number(hit.refId))
  );
  const scored = all.map((finding) => {
    const overlap = [...words(finding.claim)].filter((word) => asked.has(word)).length;
    return { finding, score: overlap * 2 + (fts.has(finding.id) ? 4 : 0) + finding.confidence + (finding.status === "corroborated" ? 1 : 0) };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 22)
    .map((item) => item.finding);
};

const evidenceNote = (finding: ResearchFinding): string =>
  `${classifySource(finding.sourceUrl, finding.sourceTitle).tier}${finding.status === "corroborated" ? ", confirmed by several sources" : ""}`;

const buildPrompt = (topic: { title: string; question: string }, findings: ResearchFinding[], earlier: ChatMessage[], text: string, owner = "", style = ""): string => `You are the research assistant and tutor for the topic "${topic.title}" (main question: ${topic.question}).
You have studied sources and recorded the findings below. The person wants to understand and learn from them.

${owner}
Each finding says what kind of source it comes from:
- academic / reference / news: evidence about the real world
- community: practitioners, companies and forums — useful, but unreviewed
- speculative: claims without evidence (paranormal, "are portals real?")
- fiction: games, novels, worldbuilding — invented worlds, never evidence about reality

Findings (cite them like [F12] when you use them):
${findings.map((f) => `[F${f.id}] ${f.claim} (${evidenceNote(f)}${f.sourceTitle ? `; source: ${f.sourceTitle}` : ""})`).join("\n") || "(no findings yet)"}

Conversation so far:
${earlier.map((m) => `${m.role === "you" ? "Person" : "You"}: ${m.text}`).join("\n") || "(this is the start)"}

Person: ${text}

How to answer:
- Base the answer on the findings above and cite each one you use, like [F12]. Do not invent facts or sources.
- Keep what is established apart from what is speculative or fictional. Say "in fiction and worldbuilding…" or
  "this is speculative…" when you use those; never present them as how the real world works.
- Explain plainly, with a concrete example where it helps. Short paragraphs or a short list.
- If the findings do not cover the question (or only partly), say so in one sentence that starts exactly with
  "My research does not cover" and say what you would look into. Then give what partial answer you can.
- If they ask to be quizzed, ask 3 questions from the findings, one at a time is fine.
${style}
Answer now, without a preamble.`;

interface Pending {
  questionId: number;
  startedAt: number;
  partial: string;
}
const pending = new Map<string, Pending>();

export const ResearchChat = {
  history(topicId: string, limit = 60): ChatMessage[] {
    const rows = db()
      .prepare("SELECT * FROM (SELECT * FROM research_messages WHERE topic_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
      .all(topicId, limit) as Row[];
    return rows.map(fromRow);
  },

  clear(topicId: string): number {
    if (pending.has(topicId)) throw new Error("It is still answering; clear the chat once the answer is in.");
    return db().prepare("DELETE FROM research_messages WHERE topic_id = ?").run(topicId).changes;
  },

  /** The answer being written for this topic: its text so far, and how many model calls are ahead of it. */
  pending(topicId: string): { questionId: number; seconds: number; partial: string; queueAhead: number } | null {
    const p = pending.get(topicId);
    if (!p) return null;
    return { questionId: p.questionId, seconds: Math.round((Date.now() - p.startedAt) / 1000), partial: p.partial, queueAhead: p.partial ? 0 : gpuLock.waiting };
  },

  /** Saves the question and starts the answer in the background; returns at once. */
  start(topicId: string, message: string, onDone?: (answer: ChatMessage) => void): { question: ChatMessage } {
    const topic = ResearchStore.getTopic(topicId);
    if (!topic) throw new Error("Research topic not found.");
    const text = message.replace(/\s+$/g, "").trim().slice(0, 2000);
    if (text.length < 2) throw new Error("Ask something first.");
    if (pending.has(topicId)) throw new Error("Still answering your last question — the answer is on its way.");

    const earlier = ResearchChat.history(topicId, 8);
    const question = save(topicId, "you", text);
    answerInBackground(topic, question, earlier, null, onDone);
    return { question };
  },

  /**
   * "Answer differently": the same question answered again in another style.
   * The two answers to one request, one liked over the other, are exactly the
   * preference pairs the model's own training learns from.
   */
  regenerate(topicId: string, questionId: number): { question: ChatMessage } {
    const topic = ResearchStore.getTopic(topicId);
    if (!topic) throw new Error("Research topic not found.");
    if (pending.has(topicId)) throw new Error("Still answering your last question — the answer is on its way.");
    const all = ResearchChat.history(topicId, 200);
    const index = all.findIndex((m) => m.id === questionId && m.role === "you");
    if (index < 0) throw new Error("That question is not in this conversation.");
    const question = all[index];
    const tried = all.slice(index + 1).filter((m) => m.role === "research" && m.answers === questionId && m.episodeId);
    const usedArms = tried.map((m) => Reinforcement.episodeFor("chat.style", `chat:${m.id}`)?.arm).filter((a): a is string => Boolean(a));
    answerInBackground(topic, question, all.slice(Math.max(0, index - 8), index), usedArms, undefined);
    return { question };
  },

  /** 👍 / 👎 on an answer: a reward for the style it was written in. */
  feedback(topicId: string, messageId: number, good: boolean, source = "app"): ChatMessage {
    const row = db().prepare("SELECT * FROM research_messages WHERE id = ? AND topic_id = ?").get(messageId, topicId) as Row | undefined;
    if (!row || row.role !== "research") throw new Error("That is not one of its answers.");
    db().prepare("UPDATE research_messages SET feedback = ? WHERE id = ?").run(good ? 1 : -1, messageId);
    if (row.episode_id) Reinforcement.reward(row.episode_id, good ? 1 : 0, source);
    return fromRow(db().prepare("SELECT * FROM research_messages WHERE id = ?").get(messageId) as Row);
  },

  /** Asks and waits for the answer (scripts and loopback callers; the app uses start + pending). */
  ask(topicId: string, message: string) {
    return askAndWait(topicId, message);
  }
};

/** Writes the answer to a saved question in the background, in a style the chat's policy picks. */
function answerInBackground(
  topic: { id: string; title: string; question: string; cycles: number },
  question: ChatMessage,
  earlier: ChatMessage[],
  excludeArms: string[] | null,
  onDone?: (answer: ChatMessage) => void
) {
  const topicId = topic.id;
  const text = question.text;
  const entry: Pending = { questionId: question.id, startedAt: Date.now(), partial: "" };
  pending.set(topicId, entry);
  const findings = groundingFor(topicId, `${text} ${earlier.filter((m) => m.role === "you").slice(-2).map((m) => m.text).join(" ")}`, topic.title);

  void (async () => {
    let answer: ChatMessage;
    try {
      const owner = await SharedKnowledge.ownerContext(`${topic.title} ${text}`);
      const base = buildPrompt(topic, findings, earlier, text, owner);
      // The style is the policy's choice; "answer differently" rules out the ones already tried.
      let choice = Reinforcement.choose("chat.style", { agent: "research-chat", prompt: base });
      for (let i = 0; excludeArms?.includes(choice.arm.id) && i < 8; i++) {
        Reinforcement.forget(choice.episodeId);
        choice = Reinforcement.choose("chat.style", { agent: "research-chat", prompt: base });
      }
      const reply = (
        await ModelRouter.generate(buildPrompt(topic, findings, earlier, text, owner, choice.arm.instruction), {
          priority: "interactive",
          onText: (soFar) => {
            entry.partial = soFar;
          }
        })
      ).trim();
      const cites = Array.from(new Set(Array.from(reply.matchAll(/\[F(\d+)\]/g)).map((m) => Number(m[1])))).filter((id) =>
        findings.some((f) => f.id === id)
      );
      const gap = /my research does not cover/i.test(reply) || findings.length === 0;
      answer = save(topicId, "research", reply || "I could not put an answer together just now. Try asking again.", cites, gap, question.id, choice.episodeId);
      Reinforcement.recordResponse(choice.episodeId, reply);
      Reinforcement.setRef(choice.episodeId, `chat:${answer.id}`);
      ResearchStore.logActivity(topicId, topic.cycles, "thought", `You asked: "${text.slice(0, 120)}"${gap ? " — not covered yet" : ""}`);
    } catch (error) {
      Logger.warn("Research chat answer failed", { topicId, error: (error as Error)?.message });
      answer = save(topicId, "research", `I could not answer just now (${(error as Error)?.message ?? error}). Ask again in a moment.`, [], false, question.id);
    } finally {
      pending.delete(topicId);
    }
    onDone?.(answer);
  })();
}

/** Asks and waits for the answer (scripts and loopback callers; the app uses start + pending). */
export const askAndWait = (topicId: string, message: string): Promise<{ question: ChatMessage; answer: ChatMessage; findings: ResearchFinding[] }> =>
  new Promise((resolve, reject) => {
    try {
      const { question } = ResearchChat.start(topicId, message, (answer) => {
        const findings = ResearchStore.listFindings(topicId, 400, "strongest").filter((f) => answer.cites.includes(f.id));
        resolve({ question, answer, findings });
      });
    } catch (error) {
      reject(error);
    }
  });
