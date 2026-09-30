/**
 * Smoke test for editing research from the app: rename a topic, steer it with
 * a question, bump and drop questions, confirm and reject findings. Runs
 * against a throwaway database and never starts a research cycle.
 *
 *   npm run test:research-edit
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-research-edit-"));
process.env.KNOWLEDGE_DB_PATH = path.join(dir, "knowledge.db");

const { ResearchStore } = await import("../src/research/ResearchStore.js");

const topic = ResearchStore.createTopic("Fast SQLite", "How do we keep SQLite fast as data grows?");
const other = ResearchStore.createTopic("Other topic", "Something else entirely for isolation checks");

// Rename and sharpen.
const edited = ResearchStore.updateTopic(topic.id, { title: "Fast SQLite at scale", question: "What keeps SQLite fast past ten million rows?" });
assert.equal(edited?.title, "Fast SQLite at scale");
assert.equal(edited?.question, "What keeps SQLite fast past ten million rows?");
assert.equal(ResearchStore.updateTopic("missing", { title: "x" }), null, "unknown topic");

// Steer with a question: goes to the top.
assert.equal(ResearchStore.addPriorityQuestion(topic.id, "Does WAL mode help concurrent readers?", 0), true);
assert.equal(ResearchStore.addPriorityQuestion(topic.id, "short", 0), false, "too short is refused");
const next = ResearchStore.nextQuestions(topic.id, 5);
assert.ok(next.some((q) => q.text.startsWith("Does WAL mode") && q.priority === 1), "steered question is top priority");

// Drop and bump stay inside their own topic.
const wal = next.find((q) => q.text.startsWith("Does WAL mode"))!;
assert.equal(ResearchStore.deleteQuestion(other.id, wal.id), false, "cannot drop another topic's question");
ResearchStore.markQuestionExplored(wal.id);
assert.equal(ResearchStore.prioritiseQuestion(topic.id, wal.id), true);
assert.equal(ResearchStore.listQuestions(topic.id, 10, "open").find((q) => q.id === wal.id)?.priority, 1, "bumped back to the top");
assert.equal(ResearchStore.deleteQuestion(topic.id, wal.id), true);
assert.equal(ResearchStore.listQuestions(topic.id, 10).some((q) => q.id === wal.id), false, "dropped");

// Findings: confirm and reject.
const source = ResearchStore.addSource(topic.id, { url: "https://sqlite.org/wal.html", title: "WAL", provider: "test", excerpt: null, contentHash: "abc" }, 1);
const { finding } = ResearchStore.addOrReinforceFinding(topic.id, { claim: "WAL mode lets readers proceed while a writer is active.", sourceId: source?.id ?? null, confidence: 0.5 }, 1);
assert.equal(ResearchStore.judgeFinding(other.id, finding.id, "confirm"), false, "cannot judge another topic's finding");
assert.equal(ResearchStore.judgeFinding(topic.id, finding.id, "confirm"), true);
let stored = ResearchStore.listFindings(topic.id, 10, "recent").find((f) => f.id === finding.id)!;
assert.equal(stored.status, "corroborated");
assert.equal(stored.confidence, 1);
ResearchStore.judgeFinding(topic.id, finding.id, "reject");
stored = ResearchStore.listFindings(topic.id, 10, "recent").find((f) => f.id === finding.id)!;
assert.equal(stored.status, "contested");
assert.ok(stored.confidence <= 0.05);

console.log("research edit: all checks passed");
