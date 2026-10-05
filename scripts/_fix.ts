import { AutoFix } from "../src/orchestrator/AutoFix.js";
import { TypeFixer } from "../src/orchestrator/TypeFixer.js";
import { Verifier } from "../src/orchestrator/Verifier.js";
import { execSync } from "node:child_process";
const dir = process.argv[2];
console.log(await AutoFix.run(dir));
console.log(TypeFixer.run(dir));
try { execSync("npx tsc --noEmit", { cwd: dir, stdio: "pipe" }); console.log("typecheck: clean"); } catch (e: any) { console.log("typecheck:", String(e.stdout).split("\n").filter((l) => /error TS/.test(l)).slice(0, 5)); }
execSync("npx vite build --base ./", { cwd: dir, stdio: "pipe" });
const r = await Verifier.runsCheck(dir);
console.log(r ? `${r.passed ? "RUNS" : "FAILS"} — ${r.output.slice(0, 220)}` : "not checked");
