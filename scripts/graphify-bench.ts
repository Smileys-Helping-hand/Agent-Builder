/**
 * Does the Graphify code graph save context, and does it find the right files?
 *
 *   npx tsx scripts/graphify-bench.ts
 *
 * For each task (a real question about this codebase, with the files that
 * answer it known): the graph's answer (`graphify query`, default budget) is
 * measured against the usual approach of grepping for the key name and reading
 * every file that matches. Tokens are estimated as characters / 4. Accuracy is
 * the share of the right files each approach names; noise is the files it
 * names that are not needed. Grep is given the exact identifier, which favours
 * it; the graph gets the question in plain words, then the identifier.
 * Results go to docs/GRAPHIFY.md's table by hand, and to data/graphify-bench.json.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const GRAPHIFY = process.env.GRAPHIFY_EXE ?? "E:\\Tools\\graphify-venv\\Scripts\\graphify.exe";
const env = { ...process.env, GRAPHIFY_BACKEND: "none", GRAPHIFY_QUERY_LOG_DISABLE: "1" };

const TASKS = [
  { q: "How does Resume All put paused workloads back after Gaming Mode?", term: "resumeAll", truth: ["src/system/ResourceModes.ts", "src/server/gameMode.ts", "src/server/system.ts"] },
  { q: "Where is a failing npm install repaired without a model?", term: "InstallDoctor", truth: ["src/repair/InstallDoctor.ts", "src/agent/ContinuousImprover.ts", "src/orchestrator/AutonomousOrchestrator.ts"] },
  { q: "How are cloud AI providers refused when local only is on?", term: "CloudInferenceRefused", truth: ["src/tools/LocalOnly.ts", "src/tools/ModelRouter.ts", "src/tools/OpenAIClient.ts", "src/tools/AnthropicClient.ts", "src/tools/GeminiClient.ts"] },
  { q: "Which code benches knowledge that makes evaluations worse?", term: "KnowledgeImpact", truth: ["src/learning/KnowledgeImpact.ts", "src/learning/LessonMemory.ts", "src/research/ResearchStore.ts", "src/learning/Evaluations.ts"] },
  { q: "How is a running game detected?", term: "GameWatcher", truth: ["src/system/GameWatcher.ts", "src/server/system.ts"] },
  { q: "What judges whether a continuous step made the checks worse?", term: "madeWorse", truth: ["src/agent/ContinuousImprover.ts"] }
];

const norm = (p: string) => p.replace(/\\/g, "/");
const filesIn = (text: string) => new Set([...norm(text).matchAll(/((?:src|scripts|remote|dashboard|docs|templates|unity)\/[\w./-]+\.\w+)/g)].map((m) => m[1]));
const score = (named: Set<string>, truth: string[]) => ({ found: truth.filter((t) => named.has(t)).length, noise: [...named].filter((f) => !truth.includes(f)).length });

const query = (text: string) => {
  const started = Date.now();
  let out = "";
  try {
    out = execFileSync(GRAPHIFY, ["query", text], { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    out = String((error as { stdout?: string }).stdout ?? "");
  }
  return { out, ms: Date.now() - started };
};

const rows = TASKS.map((task) => {
  const plain = query(task.q);
  const byName = query(task.term);
  const started = Date.now();
  const grepped = execFileSync("git", ["grep", "-l", task.term, "--", "src", "scripts", "remote/app", "remote/lib"], { encoding: "utf8", windowsHide: true }).split("\n").filter(Boolean).map(norm);
  const grepChars = grepped.reduce((sum, file) => sum + fs.readFileSync(file, "utf8").length, 0);
  const grepMs = Date.now() - started;
  const a = score(filesIn(plain.out), task.truth);
  const b = score(filesIn(byName.out), task.truth);
  const c = score(new Set(grepped), task.truth);
  return {
    task: task.q,
    truth: task.truth.length,
    graphPlain: { tokens: Math.round(plain.out.length / 4), found: a.found, noise: a.noise, ms: plain.ms },
    graphByName: { tokens: Math.round(byName.out.length / 4), found: b.found, noise: b.noise, ms: byName.ms },
    grepAndRead: { tokens: Math.round(grepChars / 4), found: c.found, noise: c.noise, files: grepped.length, ms: grepMs }
  };
});

const total = (key: "graphPlain" | "graphByName" | "grepAndRead", field: "tokens" | "found" | "noise") => rows.reduce((sum, r) => sum + r[key][field], 0);
const truth = rows.reduce((sum, r) => sum + r.truth, 0);
for (const r of rows) console.log(`${r.task}\n  graph (question): ${r.graphPlain.tokens} tokens, ${r.graphPlain.found}/${r.truth} right files, ${r.graphPlain.noise} other\n  graph (name):     ${r.graphByName.tokens} tokens, ${r.graphByName.found}/${r.truth}, ${r.graphByName.noise} other\n  grep + read:      ${r.grepAndRead.tokens} tokens, ${r.grepAndRead.found}/${r.truth}, ${r.grepAndRead.noise} other (${r.grepAndRead.files} files)`);
const summary = {
  at: new Date().toISOString(),
  graphQuestion: { tokens: total("graphPlain", "tokens"), recall: total("graphPlain", "found") / truth, noise: total("graphPlain", "noise") },
  graphName: { tokens: total("graphByName", "tokens"), recall: total("graphByName", "found") / truth, noise: total("graphByName", "noise") },
  grepAndRead: { tokens: total("grepAndRead", "tokens"), recall: total("grepAndRead", "found") / truth, noise: total("grepAndRead", "noise") }
};
console.log("\nTotals:", JSON.stringify(summary, null, 1));
console.log(`Context saved by the graph (by name) against grep + read: ${Math.round((1 - summary.graphName.tokens / summary.grepAndRead.tokens) * 100)}%, at recall ${Math.round(summary.graphName.recall * 100)}% against ${Math.round(summary.grepAndRead.recall * 100)}%.`);
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync(path.join("data", "graphify-bench.json"), JSON.stringify({ summary, rows }, null, 2));
