/**
 * Smoketest: reinforcement learning — the policies learn the best approach,
 * every reward path reaches them, and the training data exports. Runs on a
 * temporary knowledge database with a stand-in model.
 *
 *   npx tsx scripts/rl-smoketest.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rl-"));
process.env.KNOWLEDGE_DB_PATH = path.join(dir, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";

const fail = (message: string): never => {
  throw new Error(message);
};

const main = async () => {
  const { Reinforcement, sampleBeta } = await import("../src/learning/Reinforcement.js");
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  const { ResearchStore } = await import("../src/research/ResearchStore.js");
  const { ResearchChat } = await import("../src/research/ResearchChat.js");
  const { StudyCourse } = await import("../src/research/StudyCourse.js");
  const { getKnowledgeDb } = await import("../src/knowledge/KnowledgeDb.js");
  const { buildEvents } = await import("../src/orchestrator/BuildService.js");
  const { RewardWiring } = await import("../src/learning/RewardWiring.js");

  // 1. The Beta sampler is right: mean of Beta(8, 2) is 0.8.
  let total = 0;
  for (let i = 0; i < 20000; i++) total += sampleBeta(8, 2);
  if (Math.abs(total / 20000 - 0.8) > 0.01) fail(`Beta(8,2) mean ${total / 20000}`);
  console.log("[PASS] Beta sampling");

  // 2. It learns: three teaching approaches whose real success rates are 30%, 50% and 80%.
  const truth: Record<string, number> = { "analogy-first": 0.3, "worked-example": 0.8, "first-principles": 0.5 };
  const late: Record<string, number> = {};
  for (let round = 0; round < 400; round++) {
    const { episodeId, arm } = Reinforcement.choose("lesson.style", { bucket: "sim", agent: "sim" });
    Reinforcement.reward(episodeId, Math.random() < truth[arm.id] ? 1 : 0, "sim");
    if (round >= 300) late[arm.id] = (late[arm.id] ?? 0) + 1;
  }
  const lesson = Reinforcement.stats().find((p) => p.id === "lesson.style")!;
  const best = lesson.arms.find((a) => a.id === "worked-example")!;
  if ((late["worked-example"] ?? 0) < 75 || best.chanceBest < 0.9) fail(`did not learn: last 100 picks ${JSON.stringify(late)}, chanceBest ${best.chanceBest}`);
  console.log(`[PASS] learns the best approach: ${late["worked-example"]}/100 of the last picks, ${Math.round(best.chanceBest * 100)}% sure`);

  // 3. A second reward refines the first instead of counting twice.
  const one = Reinforcement.choose("chat.style", { agent: "test" });
  Reinforcement.reward(one.episodeId, 1, "quiz");
  const after = Reinforcement.reward(one.episodeId, 0, "app-rating")!;
  if (after.reward !== 0.5 || after.rewards.length !== 2) fail(`averaging: ${JSON.stringify(after)}`);
  const again = Reinforcement.reward(one.episodeId, 1, "app-rating")!;
  if (again.reward !== 1 || again.rewards.length !== 2) fail("a source's second rating should replace its first");
  const unused = Reinforcement.choose("chat.style", { agent: "test" });
  Reinforcement.forget(unused.episodeId);
  if (Reinforcement.recent(50).some((e) => e.id === unused.episodeId)) fail("forget left the episode");
  console.log("[PASS] rewards from several sources average; a source can change its mind; unused choices are taken back");

  // 4. Research chat: answers carry their episode; 👍 rewards it; "answer differently" uses another style.
  (ModelRouter as unknown as { generate: (p: string, o?: unknown) => Promise<string> }).generate = async (prompt: string) =>
    /Style: give the direct answer/.test(prompt) ? "Direct: WAL lets readers read while one writer writes." : /Style: teach it/.test(prompt) ? "Step by step: first, … Did that make sense?" : "For example, a library… That is WAL.";
  const topic = ResearchStore.createTopic("SQLite speed", "How does WAL help?");
  for (let i = 0; i < 3; i++) ResearchStore.addOrReinforceFinding(topic.id, { claim: `WAL mode finding ${i}: readers keep reading while a writer commits.`, sourceId: null, confidence: 0.8 }, 1);
  const waitAnswer = async () => {
    for (let i = 0; i < 100 && ResearchChat.pending(topic.id); i++) await new Promise((r) => setTimeout(r, 50));
    return ResearchChat.history(topic.id).filter((m) => m.role === "research").pop()!;
  };
  const { question } = ResearchChat.start(topic.id, "How does WAL help readers?");
  const first = await waitAnswer();
  if (!first.episodeId || first.answers !== question.id) fail(`answer not linked: ${JSON.stringify(first)}`);
  const rated = ResearchChat.feedback(topic.id, first.id, true);
  const firstEpisode = Reinforcement.episodeFor("chat.style", `chat:${first.id}`)!;
  if (rated.feedback !== 1 || firstEpisode.reward !== 1) fail("👍 did not reward the answer's style");
  ResearchChat.regenerate(topic.id, question.id);
  const second = await waitAnswer();
  const secondEpisode = Reinforcement.episodeFor("chat.style", `chat:${second.id}`)!;
  if (second.answers !== question.id || secondEpisode.arm === firstEpisode.arm) fail(`answer differently reused ${secondEpisode.arm}`);
  ResearchChat.feedback(topic.id, second.id, false);
  console.log(`[PASS] chat: 👍 rewards "${firstEpisode.arm}"; answering differently used "${secondEpisode.arm}"`);

  // 5. Lessons: the first quiz attempt rewards the teaching approach, later attempts do not.
  StudyCourse.list();
  const db = getKnowledgeDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO study_courses (topic_id, title, level, status, syllabus, created_at, updated_at) VALUES (?, 'SQLite', 'beginner', 'ready', ?, ?, ?)").run(
    topic.id,
    JSON.stringify([{ index: 0, title: "WAL", goal: "g", keyIdeas: [], findingIds: [] }]),
    now,
    now
  );
  const quiz = [0, 1, 2, 3].map((i) => ({ question: `Q${i}`, options: ["a", "b"], answer: 0, why: "" }));
  db.prepare("INSERT INTO study_lessons (topic_id, idx, title, goal, status, markdown, quiz, sources, written_at) VALUES (?, 0, 'WAL', 'g', 'ready', '# L', ?, '[]', ?)").run(topic.id, JSON.stringify(quiz), now);
  const lessonEpisode = Reinforcement.choose("lesson.style", { bucket: "beginner", ref: `lesson:${topic.id}:0`, prompt: "lesson prompt" });
  StudyCourse.grade(topic.id, 0, [0, 0, 0, 1]);
  StudyCourse.grade(topic.id, 0, [0, 0, 0, 0]);
  const graded = Reinforcement.episodeFor("lesson.style", `lesson:${topic.id}:0`)!;
  if (graded.id !== lessonEpisode.episodeId || graded.reward !== 0.75 || graded.rewards.length !== 1) fail(`quiz reward: ${JSON.stringify(graded)}`);
  StudyCourse.feedback(topic.id, 0, true);
  if (Reinforcement.episodeFor("lesson.style", `lesson:${topic.id}:0`)!.reward !== 0.875) fail("lesson 👍 did not join the quiz score");
  console.log("[PASS] lessons: the first quiz score (75%) and the rating (👍) reward its teaching approach");

  // 6. Builds: the finished build's score rewards its approach; an infrastructure failure does not count.
  RewardWiring.start();
  const build = Reinforcement.choose("build.approach", { bucket: "game", ref: "build:test1", prompt: "a snake game" });
  buildEvents.emit("completed", { buildId: "test1", bestScore: 82, passed: true } as never);
  if (Reinforcement.episodeFor("build.approach", "build:test1")!.reward !== 0.92) fail("build outcome not rewarded");
  const crashed = Reinforcement.choose("build.approach", { bucket: "game", ref: "build:test2", prompt: "x" });
  buildEvents.emit("failed", { buildId: "test2", bestScore: 0, passed: false, error: "Ollama model server is not answering" } as never);
  if (Reinforcement.episodeFor("build.approach", "build:test2")!.reward !== null) fail("an infrastructure failure was held against the approach");
  void build;
  void crashed;
  console.log("[PASS] builds: score 82 + passed → 0.92; a model-server failure is not counted");

  // 7. Training data: best answers, and the preference pair from "answer differently".
  const exported = Reinforcement.exportDataset(0.8);
  const dpo = fs.readFileSync(path.join(exported.dir, "dpo.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const pair = dpo.find((p) => p.policy === "chat.style");
  if (!pair || !pair.chosen || pair.chosen === pair.rejected) fail(`no chat preference pair: ${JSON.stringify(dpo)}`);
  if (exported.sft < 1) fail("no high-reward answers exported");
  console.log(`[PASS] export: ${exported.sft} best answers, ${exported.dpo} preference pair(s) → ${exported.dir}`);
  // The real data/rl export must not hold test data.
  fs.rmSync(path.join(exported.dir, "sft.jsonl"), { force: true });
  fs.rmSync(path.join(exported.dir, "dpo.jsonl"), { force: true });

  console.log("All reinforcement-learning checks passed.");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("RL smoketest failed:", error?.message ?? error);
    process.exit(1);
  });
