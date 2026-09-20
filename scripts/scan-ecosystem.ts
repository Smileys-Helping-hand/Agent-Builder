/** One-off ecosystem scan from the command line: npm run ecosystem:scan */
import "dotenv/config";

import { ProjectScanner } from "../src/ecosystem/ProjectScanner.js";
import { EcosystemStore } from "../src/ecosystem/EcosystemStore.js";

const result = await ProjectScanner.scanAll();
console.log(`Scanned ${result.scanned} project(s) in ${(result.durationMs / 1000).toFixed(1)}s (removed ${result.removed} stale).`);
console.log(`Roots: ${result.roots.join(", ")}`);
const counts = EcosystemStore.counts();
console.log(`Registry now holds ${counts.projects} project(s), ${counts.openIssues} open issue(s).`);
for (const project of EcosystemStore.listProjects().slice(0, 10)) {
  console.log(`  ${project.name.padEnd(28)} ${project.kind.padEnd(8)} ${project.gitBranch ?? "?"} (${project.gitDirty} dirty)`);
}
