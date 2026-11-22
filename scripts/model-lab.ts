/**
 * Run the Model Laboratory from the command line (the builder's API does the same):
 *   npx tsx scripts/model-lab.ts [model ...]
 * Without models: the production model, the installed Qwen 3 models, the 7B and llama3.2:3b.
 */
import { ModelLab } from "../src/learning/ModelLab.js";
import { ensureOllama } from "../src/utils/Ollama.js";

const models = process.argv.slice(2).length ? process.argv.slice(2) : [process.env.OLLAMA_MODEL ?? "qwen2.5-coder:14b", "qwen3-coder:30b", "qwen3.6:35b", "qwen2.5-coder:7b", "llama3.2:3b"];
if (!(await ensureOllama(60_000))) throw new Error("The model server did not start.");
const run = await ModelLab.run({ models });
for (const m of run.results) console.log(`${m.model.padEnd(20)} ${m.state.padEnd(8)} score ${m.score ?? "-"} | ${m.medianTokensPerSec ?? "-"} t/s | ttft ${m.medianTtftMs ?? "-"} ms | load ${m.loadMs ?? "-"} ms | GPU ${m.gpuPercent ?? "-"}% | peak VRAM ${m.peakVramMB ?? "-"} MB | RAM +${m.ramIncreaseMB ?? "-"} MB | errors ${m.errors} ${m.reason ?? ""}`);
console.log(`\n${run.recommendation}`);
process.exit(0);
