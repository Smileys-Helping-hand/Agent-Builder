/**
 * Try the Stuck Doctor on a real stuck project, outside a build.
 *
 *   npx tsx --env-file=.env scripts/stuck-doctor-trial.ts <project folder> [check]
 *
 * It works on that folder as the builder would (and puts back whatever does
 * not help); fixes it learns go into this checkout's data/fix-playbook.json.
 */
import { Executor } from "../src/orchestrator/Executor.js";
import { ModelRouter } from "../src/tools/ModelRouter.js";
import { StuckDoctor } from "../src/repair/StuckDoctor.js";
import { errorCount } from "../src/repair/ErrorFingerprint.js";

const root = process.argv[2];
const check = process.argv[3] ?? "typecheck";
if (!root) throw new Error("Name the project folder.");

const run = async () => {
  const r = await Executor.run("npx", ["tsc", "--noEmit"], { cwd: root, timeoutMs: 240_000 });
  return `${r.stdout}\n${r.stderr}`;
};
const before = await run();
console.log(`before: ${errorCount(before)} errors`);
const started = Date.now();
const result = await StuckDoctor.resolve({
  root,
  check: { name: check, output: before },
  models: [process.env.REVIEW_MODEL || "qwen2.5-coder:14b", undefined],
  note: (title, text) => console.log(`\n== ${title}\n${text}`),
  projectName: "doctor trial",
  editFile: async (file, content, instruction, errors) => {
    const reply = await ModelRouter.generate(`Fix this one file. Change only what the instruction asks; keep everything else exactly as it is.\n\nInstruction: ${instruction}\nThe error it must fix: ${errors}\n\nFILE: ${file}\n\`\`\`\n${content}\n\`\`\`\n\nReply with the whole corrected file in one code block, nothing else.`);
    return /```[a-z]*\n([\s\S]*?)```/.exec(reply)?.[1] ?? null;
  }
});
const after = await run();
console.log(`\nresult: ${JSON.stringify(result)}\nafter: ${errorCount(after)} errors (${Math.round((Date.now() - started) / 1000)}s)`);
