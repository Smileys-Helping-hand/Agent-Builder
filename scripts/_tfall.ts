import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TypeFixer } from "../src/orchestrator/TypeFixer.js";
const errors = (dir: string) => { try { execSync("npx tsc --noEmit", { cwd: dir, stdio: "pipe" }); return [] as string[]; } catch (e: any) { return String(e.stdout).split(/\r?\n/).filter((l) => /error TS/.test(l)); } };
let before = 0, after = 0, cleared = 0, total = 0;
const left = new Map<string, number>();
for (const d of fs.readdirSync("builds").filter((n) => n.startsWith("try_pgame_"))) {
  const dir = path.join("builds", d);
  if (!fs.existsSync(path.join(dir, "node_modules")) || !fs.existsSync(path.join(dir, "tsconfig.json"))) continue;
  const b = errors(dir).length; if (b === 0) continue;
  total++;
  const notes = TypeFixer.run(dir);
  const rest = errors(dir);
  before += b; after += rest.length; if (rest.length === 0) cleared++;
  for (const l of rest) { const code = /error (TS\d+)/.exec(l)?.[1] ?? "?"; left.set(code, (left.get(code) ?? 0) + 1); }
  console.log(`${d}: ${b} -> ${rest.length} errors  (${notes.length} fixes)`);
}
console.log(`TOTAL: ${before} -> ${after} errors; ${cleared}/${total} builds now compile`);
console.log("left by code:", [...left].sort((a, b) => b[1] - a[1]).slice(0, 12));
