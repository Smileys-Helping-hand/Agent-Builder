/**
 * Smoketest: teaching from research — evidence labels, the GPU's priority
 * lane, courses, quizzes, flashcards, the study pack and background chat.
 * Runs against a temporary knowledge database (never data/knowledge.db).
 *
 *   npx tsx scripts/study-smoketest.ts               offline checks (no model)
 *   SMOKE_LIVE=1 npx tsx scripts/study-smoketest.ts  also plans a course and writes a lesson with the real model (minutes)
 */
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "study-"));
process.env.KNOWLEDGE_DB_PATH = path.join(dir, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "off";
if (process.env.SMOKE_LIVE !== "1") {
  // Offline: every model call (including lessons written ahead in the background)
  // goes to a closed port and fails at once, instead of loading the real model.
  process.env.MODEL_PROVIDER = "lmstudio";
  process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
  process.env.MODEL_WAIT_MS = "0";
}

const fail = (message: string): never => {
  throw new Error(message);
};

const main = async () => {
  const { classifySource } = await import("../src/research/SourceCredibility.js");
  const { GpuLock } = await import("../src/utils/GpuLock.js");
  const { ResearchStore } = await import("../src/research/ResearchStore.js");
  const { StudyCourse } = await import("../src/research/StudyCourse.js");
  const { ResearchChat } = await import("../src/research/ResearchChat.js");
  const { getKnowledgeDb } = await import("../src/knowledge/KnowledgeDb.js");

  // 1. Evidence labels.
  const cases: Array<[string, string, string]> = [
    ["https://arxiv.org/abs/1", "A novel method for thin film growth", "academic"],
    ["https://en.wikipedia.org/wiki/Quantum_computing", "Quantum computing", "reference"],
    ["https://en.wikipedia.org/wiki/List_of_Apex_Legends_characters", "List of Apex Legends characters", "fiction"],
    ["https://www.dndbeyond.com/x", "Pocket Dimension - Rules", "fiction"],
    ["https://www.gaia.com/x", "Are Portals Real?", "speculative"],
    ["https://blog.example.com/x", "Worldbuilding with pocket dimensions", "fiction"],
    ["https://stackoverflow.com/q/1", "How do I use useEffect", "community"],
    ["https://www.youtube.com/watch?v=1", "Episode 4 — Exam Format", "community"]
  ];
  for (const [url, title, want] of cases) {
    const got = classifySource(url, title).tier;
    if (got !== want) fail(`${title}: ${got}, expected ${want}`);
  }
  console.log(`[PASS] evidence labels (${cases.length} cases)`);

  // 2. Someone waiting goes ahead of background work, in arrival order.
  const lock = new GpuLock();
  const order: string[] = [];
  const job = (name: string, ms = 20) => () => new Promise<void>((resolve) => setTimeout(() => (order.push(name), resolve()), ms));
  const running = [
    lock.run(job("research-1", 40)),
    lock.run(job("research-2")),
    lock.run(job("research-3")),
    lock.run(job("chat-a"), "interactive"),
    lock.run(job("chat-b"), "interactive")
  ];
  await Promise.all(running);
  if (order.join(",") !== "research-1,chat-a,chat-b,research-2,research-3") fail(`GPU order was ${order.join(",")}`);
  console.log("[PASS] interactive calls jump the GPU queue, in arrival order");

  // 3. A topic with real-world and fictional evidence.
  const topic = ResearchStore.createTopic("Pocket dimensions", "Can pocket dimensions be made?");
  const paper = ResearchStore.addSource(topic.id, { url: "https://arxiv.org/abs/2401.1", title: "Compact extra dimensions in string theory", provider: "arxiv", contentHash: "a", excerpt: "Extra spatial dimensions, if they exist, are compactified at scales far below what experiments can probe." }, 1)!;
  const wiki = ResearchStore.addSource(topic.id, { url: "https://www.dndbeyond.com/pocket", title: "Pocket Dimension - Rules & Game Mechanics", provider: "web", contentHash: "b", excerpt: "A bag of holding opens onto an extradimensional space." }, 1)!;
  const f1 = ResearchStore.addOrReinforceFinding(topic.id, { claim: "Extra spatial dimensions, if they exist, would be compactified at tiny scales.", sourceId: paper.id, confidence: 0.8 }, 1).finding;
  const f2 = ResearchStore.addOrReinforceFinding(topic.id, { claim: "A bag of holding opens onto an extradimensional pocket space.", sourceId: wiki.id, confidence: 0.8 }, 1).finding;
  for (let i = 0; i < 4; i++) ResearchStore.addOrReinforceFinding(topic.id, { claim: `Kaluza-Klein theory finding number ${i} about compact dimension radius ${i}.`, sourceId: paper.id, confidence: 0.7 }, 1);

  // 4. A course, as the planner would leave it (no model here).
  StudyCourse.list(); // creates the tables
  const db = getKnowledgeDb();
  const syllabus = [
    { index: 0, title: "What a dimension is", goal: "Explain extra dimensions", keyIdeas: ["compactification"], findingIds: [f1.id] },
    { index: 1, title: "Fact, theory and fiction", goal: "Sort real physics from stories", keyIdeas: ["fiction"], findingIds: [f2.id] }
  ];
  const now = new Date().toISOString();
  db.prepare("INSERT INTO study_courses (topic_id, title, level, status, error, syllabus, created_at, updated_at) VALUES (?, ?, 'beginner', 'ready', NULL, ?, ?, ?)").run(topic.id, topic.title, JSON.stringify(syllabus), now, now);
  const quiz = [
    { question: "Where would extra dimensions be?", options: ["Huge", "Compactified, tiny", "In a bag"], answer: 1, why: "They are compactified." },
    { question: "Is a bag of holding evidence?", options: ["Yes", "No, it is fiction"], answer: 1, why: "It is from a game." },
    { question: "Q3", options: ["a", "b"], answer: 0, why: "" },
    { question: "Q4", options: ["a", "b"], answer: 0, why: "" }
  ];
  db.prepare("INSERT INTO study_lessons (topic_id, idx, title, goal, status, markdown, quiz, sources, written_at) VALUES (?, 0, ?, ?, 'ready', ?, ?, ?, ?)").run(
    topic.id,
    syllabus[0].title,
    syllabus[0].goal,
    "# Lesson 1: What a dimension is\n\n## In short\n\n- one\n\n## Read the sources\n\n### Academic research\n\n1. [Compact extra dimensions](https://arxiv.org/abs/2401.1)\n   > Extra spatial dimensions…",
    JSON.stringify(quiz),
    JSON.stringify([{ n: 1, title: "Compact extra dimensions", url: "https://arxiv.org/abs/2401.1", tier: "academic", label: "Academic research", excerpt: "…" }]),
    now
  );
  db.prepare("INSERT INTO study_lessons (topic_id, idx, title, goal, status) VALUES (?, 1, ?, ?, 'planned')").run(topic.id, syllabus[1].title, syllabus[1].goal);
  db.prepare("INSERT INTO study_cards (topic_id, idx, front, back, box, due_at) VALUES (?, 0, 'Compactified means?', 'Curled up very small', 1, ?)").run(topic.id, now);

  // 5. Opening, marking, progress.
  const opened = StudyCourse.open(topic.id, 0);
  if (opened.status !== "ready" || StudyCourse.currentLesson(topic.id) !== 0) fail("opening a lesson did not record it");
  const bad = StudyCourse.grade(topic.id, 0, [0, 0, 0, 0]);
  if (bad.passed || Math.round(bad.score * 100) !== 50) fail(`wrong answers scored ${bad.score}`);
  const good = StudyCourse.grade(topic.id, 0, [1, 1, 0, 0]);
  if (!good.passed || good.next?.index !== 1) fail("right answers did not complete the lesson");
  const overview = StudyCourse.overview(topic.id)!;
  if (overview.progress.find((p) => p.index === 0)?.bestScore !== 1 || overview.lessons.some((l) => "markdown" in l)) fail(`overview wrong: ${JSON.stringify(overview.progress)}`);
  console.log("[PASS] lessons open, quizzes mark (75% completes), progress keeps the best score");

  // 6. Flashcards on the Leitner schedule.
  const [card] = StudyCourse.dueCards(topic.id);
  if (!card) fail("no card due");
  const knew = StudyCourse.review(card.id, true);
  if (knew.box !== 2 || new Date(knew.dueAt).getTime() < Date.now() + 2.5 * 86_400_000) fail(`knew it: box ${knew.box}, due ${knew.dueAt}`);
  const missed = StudyCourse.review(card.id, false);
  if (missed.box !== 1 || StudyCourse.dueCards(topic.id).length !== 0) fail("a missed card should come back tomorrow, not now");
  console.log("[PASS] flashcards: knew it moves up a box, missed goes back to box 1 for tomorrow");

  // 7. The study pack.
  const pack = StudyCourse.pack(topic.id);
  for (const part of ["# Study pack: Pocket dimensions", "## Syllabus", "Lesson 1: What a dimension is", "### Check yourself", "## Answers", "## Flashcards", "## Reading list", "### Academic research"]) {
    if (!pack.includes(part)) fail(`study pack lacks "${part}"`);
  }
  console.log("[PASS] study pack: syllabus, lessons, questions, answers, cards, reading list by evidence");

  // 8. Chat answers in the background and reports progress (model calls fail fast here).
  if (process.env.SMOKE_LIVE !== "1") {
    const { question } = ResearchChat.start(topic.id, "Can I make a pocket dimension?");
    if (!question.id || !ResearchChat.pending(topic.id)) fail("chat did not start in the background");
    let busy = false;
    try {
      ResearchChat.start(topic.id, "And another?");
    } catch {
      busy = true;
    }
    if (!busy) fail("a second question was accepted while the first was being answered");
    for (let i = 0; i < 300 && ResearchChat.pending(topic.id); i++) await new Promise((r) => setTimeout(r, 100));
    const last = ResearchChat.history(topic.id).pop();
    if (ResearchChat.pending(topic.id) || last?.role !== "research") fail("the answer (or its failure) was not saved");
    console.log("[PASS] chat: returns at once, one question at a time, the answer (here: the model being down) is saved");
  } else {
    // Distinct findings, as a topic that has researched a while would have.
    for (const claim of [
      "Kaluza-Klein theory unifies gravity and electromagnetism by adding a fifth, curled-up spatial dimension.",
      "String theory requires ten spacetime dimensions, six of them compactified on Calabi-Yau manifolds.",
      "Experiments at the Large Hadron Collider have found no evidence of large extra dimensions at TeV energies.",
      "Torsion-balance tests of Newton's inverse-square law constrain extra dimensions to below about 50 micrometres.",
      "The ADD model proposes large extra dimensions to explain why gravity is so much weaker than other forces.",
      "In the Randall-Sundrum model a warped extra dimension separates two branes.",
      "A tesseract is the four-dimensional analogue of a cube, used to visualise a fourth spatial dimension."
    ]) {
      ResearchStore.addOrReinforceFinding(topic.id, { claim, sourceId: paper.id, confidence: 0.85 }, 2);
    }
    console.log("Live: planning a course with the real model…");
    StudyCourse.plan(topic.id, "beginner");
    for (let i = 0; i < 900 && StudyCourse.get(topic.id)?.status === "planning"; i++) await new Promise((r) => setTimeout(r, 2000));
    const course = StudyCourse.get(topic.id)!;
    if (course.status !== "ready") fail(`planning: ${course.status} ${course.error}`);
    console.log(`  syllabus: ${course.syllabus.map((s) => s.title).join(" | ")}`);
    StudyCourse.open(topic.id, 0);
    for (let i = 0; i < 900 && !["ready", "failed"].includes(StudyCourse.lesson(topic.id, 0)!.status); i++) await new Promise((r) => setTimeout(r, 2000));
    const lesson = StudyCourse.lesson(topic.id, 0)!;
    if (lesson.status !== "ready") fail(`lesson: ${lesson.status} ${lesson.error}`);
    console.log(`[PASS] live: course planned and lesson 1 written (${lesson.markdown!.length} chars, ${lesson.quiz.length} questions)`);
    console.log(lesson.markdown!.slice(0, 1500));
  }

  console.log("All study checks passed.");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Study smoketest failed:", error?.message ?? error);
    process.exit(1);
  })
  .finally(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // the database file may still be open on Windows
    }
  });
