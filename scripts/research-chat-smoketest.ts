/**
 * Smoke test for talking to a research topic. The model is replaced with a
 * stand-in that records what it was given, so this checks the plumbing:
 * grounding in the topic's own findings, citations kept, gaps flagged, history
 * stored and cleared. Runs against a throwaway database.
 *
 *   npm run test:research-chat
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-research-chat-"));
process.env.KNOWLEDGE_DB_PATH = path.join(dir, "knowledge.db");

const { ResearchStore } = await import("../src/research/ResearchStore.js");
const { ResearchChat } = await import("../src/research/ResearchChat.js");
const { ModelRouter } = await import("../src/tools/ModelRouter.js");

const topic = ResearchStore.createTopic("Fast SQLite", "How do we keep SQLite fast as data grows?");
const other = ResearchStore.createTopic("Something else", "An unrelated topic for isolation");
const source = ResearchStore.addSource(topic.id, { url: "https://sqlite.org/wal.html", title: "WAL", provider: "test", excerpt: null, contentHash: "a" }, 1);
const wal = ResearchStore.addOrReinforceFinding(topic.id, { claim: "WAL mode lets readers keep reading while a single writer commits changes.", sourceId: source?.id ?? null, confidence: 0.9 }, 1).finding;
ResearchStore.addOrReinforceFinding(topic.id, { claim: "An index on the filtered and sorted columns avoids full table scans on large tables.", sourceId: null, confidence: 0.8 }, 1);
const elsewhere = ResearchStore.addOrReinforceFinding(other.id, { claim: "Completely unrelated finding about gardening and tomato plants in summer.", sourceId: null, confidence: 0.9 }, 1).finding;

let lastPrompt = "";
let reply = "";
(ModelRouter as unknown as { generate: (prompt: string) => Promise<string> }).generate = async (prompt: string) => {
  lastPrompt = prompt;
  return reply;
};

// A covered question: grounded in this topic's findings, citation kept.
reply = `Readers do not wait for the writer in WAL mode [F${wal.id}], which keeps reads fast while data is written.`;
const first = await ResearchChat.ask(topic.id, "Does WAL help readers while writing?");
assert.match(lastPrompt, new RegExp(`\\[F${wal.id}\\] WAL mode`), "the topic's findings are in front of the model");
assert.ok(!lastPrompt.includes("tomato"), "another topic's findings are not");
assert.deepEqual(first.answer.cites, [wal.id], "citations are recorded");
assert.equal(first.answer.gap, false);
assert.equal(first.findings[0].id, wal.id, "the cited finding comes back for the app to show");

// A question its research does not cover: flagged as a gap.
reply = "My research does not cover backups yet; I would look into the online backup API next.";
const second = await ResearchChat.ask(topic.id, "How should I back it up?");
assert.equal(second.answer.gap, true, "an uncovered question is flagged");
assert.match(lastPrompt, /Person: Does WAL help readers while writing\?/, "earlier turns are in the prompt");

// Made-up citations are dropped.
reply = `Something about [F${elsewhere.id}] and [F999999].`;
const third = await ResearchChat.ask(topic.id, "Tell me more");
assert.deepEqual(third.answer.cites, [], "citations of findings it was not given are dropped");

// History, then clearing it.
const history = ResearchChat.history(topic.id);
assert.equal(history.length, 6, "three questions and three answers stored");
assert.equal(history[0].role, "you");
assert.equal(ResearchChat.history(other.id).length, 0, "conversations are per topic");
assert.equal(ResearchChat.clear(topic.id), 6);
assert.equal(ResearchChat.history(topic.id).length, 0);

await assert.rejects(() => ResearchChat.ask(topic.id, " "), /Ask something/);
await assert.rejects(() => ResearchChat.ask("missing", "hello there"), /not found/);

console.log("research chat: all checks passed");
