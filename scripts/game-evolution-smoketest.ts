/**
 * Smoketest: Game Evolution Studio & Codebase Deconstruction Engine
 */
import fs from "fs";
import path from "path";
import { GameEvolutionStudio } from "../src/orchestrator/GameEvolutionStudio.js";
import { AppDeconstructor } from "../src/orchestrator/AppDeconstructor.js";

async function run() {
  console.log("==========================================================");
  console.log(" 🎮 Game Evolution Studio & App Deconstructor Smoketest");
  console.log("==========================================================");

  // 1. Gamemaker Detection
  console.log("\nTest 1: Gamemaker & Unity AI Bridge Status...");
  const gmStatus = GameEvolutionStudio.checkGamemakerStatus();
  console.log("  - Installed:", gmStatus.installed);
  console.log("  - Path:", gmStatus.path);
  console.log("  - Has Unity Bridge:", gmStatus.hasUnityBridge);
  if (!gmStatus.path.includes("Gamemaker")) throw new Error("Unexpected Gamemaker path");
  console.log("  [PASS] Gamemaker check verified.");

  // 2. Games list: what is on disk, nothing invented
  console.log("\nTest 2: Games list...");
  const games = GameEvolutionStudio.listAllGames();
  console.log(`  - Total Games: ${games.length}`);
  for (const g of games) {
    console.log(`    * ${g.name} [${g.engine}] (Live: v${g.liveVersion}, Staged: ${g.stagedVersion ? `v${g.stagedVersion}` : "none"}, Rating: ${g.funRating ?? "not checked"})`);
  }
  const webGames = fs.readdirSync("games").filter((d) => fs.existsSync(path.join("games", d, "index.html")));
  if (games.filter((g) => g.engine === "web").length < webGames.length) throw new Error("A web game in games/ is missing from the list");
  if (games.some((g) => g.gameId.startsWith("block-blaster"))) throw new Error("Invented seed games are still listed");
  console.log("  [PASS] Games list matches disk.");

  // 3. Stage and promote a version (on a throwaway game, removed afterwards)
  console.log("\nTest 3: Stage and promote...");
  const testId = `smoketest-${Date.now()}`;
  GameEvolutionStudio.registerGame({ gameId: testId, name: "Smoketest Game", engine: "web", liveVersion: "1.0.0", liveOutputDir: "games/snake" });
  GameEvolutionStudio.stageVersion(testId, "1.1.0", "games/snake");
  const promoRes = GameEvolutionStudio.promoteStagedToLive(testId);
  console.log("  - Promotion Result:", promoRes.message);
  if (!promoRes.success || promoRes.liveVersion !== "1.1.0") throw new Error("Promotion did not make 1.1.0 live");
  const db = JSON.parse(fs.readFileSync(path.resolve("data", "game-studio", "games.json"), "utf8"));
  if (db[testId].history.length !== 1 || db[testId].stagedVersion !== null) throw new Error("History or staged slot wrong after promotion");
  delete db[testId];
  fs.writeFileSync(path.resolve("data", "game-studio", "games.json"), JSON.stringify(db, null, 2));
  console.log("  [PASS] Promotion verified.");

  // 4. Codebase Deconstruction
  console.log("\nTest 4: Codebase Deconstruction on self workspace...");
  const deconstruction = await AppDeconstructor.deconstruct(path.resolve("src/orchestrator"));
  console.log("  - Project Name:", deconstruction.projectName);
  console.log("  - Total Files Analyzed:", deconstruction.totalFiles);
  console.log("  - Features Dissected:", deconstruction.features.length);
  console.log("  - Components Identified:", deconstruction.components.length);
  console.log("  - Blueprint Title:", deconstruction.rebuildBlueprint.title);
  if (deconstruction.totalFiles === 0) throw new Error("Deconstruction found 0 files");
  console.log("  [PASS] Codebase deconstruction verified.");

  // 5. Game Checkup Diagnostics
  console.log("\nTest 5: Game Checkup Diagnostics...");
  // A short wait: a local model will not answer in time, which exercises the measured fallback.
  process.env.CHECKUP_TIMEOUT_MS ??= "5000";
  const checkup = await GameEvolutionStudio.runGameCheckup(path.resolve("games/snake"), "Snake");
  console.log("  - Scorecard Game:", checkup.gameName);
  console.log("  - Overall Score:", checkup.overallScore);
  console.log("  - Story Lore Found:", checkup.storyAndPlot.loreFound);
  console.log("  - Assessed By:", checkup.assessedBy, checkup.note ?? "");
  console.log("  - Evolution Title:", checkup.nextEvolutionPlan.title);
  if (!["model", "heuristic"].includes(checkup.assessedBy)) throw new Error("Scorecard does not say how it was assessed");
  if (checkup.overallScore < 0 || checkup.overallScore > 100) throw new Error("Score out of range");
  console.log("  [PASS] Game checkup diagnostics verified.");

  console.log("\n==========================================================");
  console.log(" 🌟 All Game Evolution & Deconstructor Tests Passed 100%!");
  console.log("==========================================================");
  // A model call the checkup stopped waiting for may still be running.
  process.exit(0);
}

run().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
