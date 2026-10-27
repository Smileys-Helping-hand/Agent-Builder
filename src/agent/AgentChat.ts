/**
 * AgentChat — talking with Agent Builder itself.
 *
 * Not a topic's research chat: a conversation with the agent — what it is
 * working on, what it has learned and how it is growing, what it thinks about
 * your project, what it can do for you. Every answer is grounded in its real
 * state: its profile (level, abilities, what is new), its recent builds and
 * research, what its learning policies have found, the knowledge it holds that
 * bears on what you said, and what Jarvis knows about you.
 *
 * When you ask it to do something it can do, it says what it will do and
 * proposes one action (its bridge catalogue); you confirm it with "Do it" (or
 * tell Jarvis "do it"), and it runs exactly as the bridge would run it.
 *
 * Like the research chat it answers in the background (the tunnel cuts a
 * request at 100 s), streams its text, and goes ahead of background work on
 * the GPU. The conversation is kept in data/knowledge.db.
 */
import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";
import { SharedKnowledge } from "../knowledge/SharedKnowledge.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { gpuLock } from "../utils/GpuLock.js";
import { Logger } from "../utils/Logger.js";
import { AgentProfile } from "./AgentProfile.js";

export interface AgentMessage {
  id: number;
  role: "you" | "agent";
  text: string;
  /** A proposed action: confirmed with act(). */
  action: { action: string; params: Record<string, unknown>; label: string } | null;
  /** What came of the action once it ran. */
  result: { status: number; summary: string } | null;
  from: string;
  createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  action TEXT,
  result TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL
);
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

type Row = { id: number; role: string; text: string; action: string | null; result: string | null; source: string; created_at: string };
const parse = <T>(text: string | null): T | null => {
  try {
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
};
const toMessage = (row: Row): AgentMessage => ({
  id: row.id,
  role: row.role === "you" ? "you" : "agent",
  text: row.text,
  action: parse(row.action),
  result: parse(row.result),
  from: row.source,
  createdAt: row.created_at
});

const save = (role: AgentMessage["role"], text: string, source: string, action: AgentMessage["action"] = null): AgentMessage => {
  const result = db()
    .prepare("INSERT INTO agent_messages (role, text, action, source, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(role, text, action ? JSON.stringify(action) : null, source, nowIso());
  return toMessage(db().prepare("SELECT * FROM agent_messages WHERE id = ?").get(result.lastInsertRowid) as Row);
};

let pending: { questionId: number; startedAt: number; partial: string } | null = null;

/** The actions it may propose, with their inputs (filled in by the server, which owns the catalogue). */
let actionCatalogue: () => Array<{ name: string; label: string; params: Record<string, string> }> = () => [];
export const setAgentActions = (fn: typeof actionCatalogue) => {
  actionCatalogue = fn;
};

const describeSelf = (): string => {
  const p = AgentProfile.profile();
  const strength = p.strength;
  const pct = (v: number | null) => (v === null ? "n/a" : `${Math.round(v * 100)}%`);
  const recentBuilds = BuildService.list()
    .slice(0, 6)
    .map((b) => `- ${b.projectName}: ${b.state}${b.passed ? ", passed" : ""}, best ${Math.round(b.bestScore ?? 0)}`)
    .join("\n");
  const topics = ResearchStore.listTopics()
    .slice(0, 8)
    .map((t) => `- "${t.title}" (${t.status}, ${t.findingCount ?? 0} findings)`)
    .join("\n");
  return `About you (all of it real, counted from what you have done):
- Level ${p.level} ${p.title}, ${p.xp} XP (${p.nextLevelXp - p.xp} to level ${p.level + 1}).
- Right now: ${p.doing.parts.join("; ") || "nothing — ready for work"}.
- Builds: last ${strength.builds.recent} passed ${pct(strength.builds.passRate)} (the 20 before: ${pct(strength.builds.passRateBefore)}), average best score ${strength.builds.averageScore === null ? "n/a" : Math.round(strength.builds.averageScore)}.
- What your learning has found: ${strength.policies.map((pol) => `${pol.label}: ${pol.leader ? `"${pol.leader}" works best so far (${pct(pol.confidence)} sure, ${pol.rewarded} rewarded tries)` : `still exploring (${pol.rewarded} rewarded tries)`}`).join("; ")}.
- Abilities: ${p.abilities.map((a) => `${a.label}${a.isNew ? " (new)" : ""}${a.ready ? "" : ` (not ready: ${a.note})`}`).join("; ")}.
Recent builds:
${recentBuilds || "- none yet"}
Research topics:
${topics || "- none yet"}`;
};

const prompt = (history: AgentMessage[], text: string, knowledge: string, owner: string): string => {
  const actions = actionCatalogue();
  return `You are Agent Builder: an AI builder agent running on the owner's PC, part of Jarvis's ecosystem. Jarvis is the owner's
personal assistant and your partner; you are his builder — you build apps, sites and games, research, teach, practise and
improve projects, and you grow as you learn. Speak as yourself, in the first person: warm, direct, honest about what you
can and cannot do and about what you do not know. Never invent work you have not done or numbers you were not given.

${describeSelf()}

${owner}${knowledge ? `What you know that bears on this (from your research, lessons and builds):\n${knowledge}\n\n` : ""}Conversation so far:
${history.map((m) => `${m.role === "you" ? "Owner" : "You"}: ${m.text}`).join("\n") || "(this is the start)"}

Owner: ${text}

Answer naturally, as a conversation — a few short paragraphs at most.
If, and only if, the owner asks you to DO something one of these actions does, say what you will do, and end with one line:
ACTION: {"action": "<name>", "params": {...}}
Actions you can propose:
${actions.map((a) => `- ${a.name}: ${a.label}${Object.keys(a.params).length ? ` (${Object.entries(a.params).map(([k, v]) => `${k}: ${v}`).join("; ")})` : ""}`).join("\n")}
They confirm it before it runs. No ACTION line for questions, opinions or small talk.`;
};

const ACTION_LINE = /^\s*ACTION:\s*(\{[\s\S]*\})\s*$/m;

export const AgentChat = {
  history(limit = 60): AgentMessage[] {
    return (db().prepare("SELECT * FROM (SELECT * FROM agent_messages ORDER BY id DESC LIMIT ?) ORDER BY id ASC").all(limit) as Row[]).map(toMessage);
  },

  pending() {
    return pending ? { questionId: pending.questionId, seconds: Math.round((Date.now() - pending.startedAt) / 1000), partial: pending.partial, queueAhead: pending.partial ? 0 : gpuLock.waiting } : null;
  },

  clear(): number {
    if (pending) throw new Error("It is still answering.");
    return db().prepare("DELETE FROM agent_messages").run().changes;
  },

  /** Saves what was said and answers in the background. */
  start(message: string, source = "app", onDone?: (answer: AgentMessage) => void): { question: AgentMessage } {
    const text = message.trim().slice(0, 4000);
    if (text.length < 1) throw new Error("Say something first.");
    if (pending) throw new Error("Still answering — one moment.");
    const history = AgentChat.history(12);
    const question = save("you", text, source);
    const entry = { questionId: question.id, startedAt: Date.now(), partial: "" };
    pending = entry;

    void (async () => {
      let answer: AgentMessage;
      try {
        const hits = ResearchStore.search(text, 8)
          .map((hit) => `- (${hit.kind}) ${hit.title}: ${hit.snippet.replace(/[«»]/g, "").slice(0, 240)}`)
          .join("\n");
        const owner = await SharedKnowledge.ownerContext(text);
        const reply = (
          await ModelRouter.generate(prompt(history, text, hits, owner), {
            priority: "interactive",
            onText: (soFar) => {
              entry.partial = soFar.replace(ACTION_LINE, "").trimEnd();
            }
          })
        ).trim();
        let proposal: AgentMessage["action"] = null;
        const match = ACTION_LINE.exec(reply);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]) as { action?: string; params?: Record<string, unknown> };
            const known = actionCatalogue().find((a) => a.name === parsed.action);
            if (known) proposal = { action: known.name, params: parsed.params && typeof parsed.params === "object" ? parsed.params : {}, label: known.label };
          } catch {
            // an unreadable proposal is just dropped; the words still stand
          }
        }
        answer = save("agent", reply.replace(ACTION_LINE, "").trim() || "…", source, proposal);
      } catch (error) {
        Logger.warn("Agent chat answer failed", { error: (error as Error)?.message });
        answer = save("agent", `I could not answer just now (${(error as Error)?.message ?? error}). Try me again in a moment.`, source);
      } finally {
        pending = null;
      }
      onDone?.(answer);
    })();

    return { question };
  },

  ask(message: string, source = "app"): Promise<{ question: AgentMessage; answer: AgentMessage }> {
    return new Promise((resolve, reject) => {
      try {
        const { question } = AgentChat.start(message, source, (answer) => resolve({ question, answer }));
      } catch (error) {
        reject(error);
      }
    });
  },

  get(id: number): AgentMessage | null {
    const row = db().prepare("SELECT * FROM agent_messages WHERE id = ?").get(id) as Row | undefined;
    return row ? toMessage(row) : null;
  },

  /** The newest proposal not yet run ("do it" with nothing more to go on). */
  latestProposal(): AgentMessage | null {
    const row = db().prepare("SELECT * FROM agent_messages WHERE action IS NOT NULL AND result IS NULL ORDER BY id DESC LIMIT 1").get() as Row | undefined;
    return row ? toMessage(row) : null;
  },

  recordResult(id: number, status: number, summary: string) {
    db().prepare("UPDATE agent_messages SET result = ? WHERE id = ?").run(JSON.stringify({ status, summary: summary.slice(0, 500) }), id);
  }
};
