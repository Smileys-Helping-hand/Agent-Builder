/**
 * Smoketest: Unity Level Studio — plans a level from the biome rules (no model
 * call), builds it in Unity batch mode, and checks the scene and previews exist.
 * Run with: npx tsx scripts/unity-level-smoketest.ts ["prompt"] [none|windows|webgl]
 * Needs a Unity editor (Unity Hub). The first run creates the level project.
 */
import fs from "fs";
import path from "path";
import { UnityLevelStudio, sanitizePlan, RECIPES } from "../src/media/UnityLevelStudio.js";

const prompt = process.argv[2] ?? "A misty pine forest valley with an old watchtower, glowing spirit crystals and patrol drones";
const target = (process.argv[3] ?? "none") as "none" | "windows" | "webgl";

const main = async () => {
  // 1. Plans are always buildable, whatever the model sends.
  const empty = sanitizePlan({}, prompt, "rules");
  const junk = sanitizePlan({ biome: "moon", assets: [{ kind: "nope", parts: [{ shape: "blob" }] }], terrain: { size: 99999 } }, "snowy peaks", "model");
  if (!empty.assets.some((a) => a.id === empty.objective.pickupAssetId)) throw new Error("pickup asset missing");
  if (!empty.assets.some((a) => a.id === empty.objective.goalAssetId)) throw new Error("goal asset missing");
  if (junk.biome !== "snow" || junk.terrain.size !== 400) throw new Error(`sanitize failed: ${junk.biome} ${junk.terrain.size}`);
  if (junk.assets.some((a) => a.parts.length === 0)) throw new Error("asset without parts");
  for (const [kind, recipe] of Object.entries(RECIPES)) if (!recipe().length) throw new Error(`empty recipe ${kind}`);
  console.log(`[PASS] plan sanitising (${empty.biome}: ${empty.assets.length} assets, ${empty.scatter.length} scatter rules)`);

  // 2. Build it in Unity.
  const status = UnityLevelStudio.status();
  console.log("Unity:", status.unity.version, status.unity.exe, "| Blender:", status.blender.installed ? status.blender.path : "not installed", "| project:", status.project);
  if (!status.unity.installed) {
    console.log("(skipped Unity build: no editor)");
    return;
  }
  const job = UnityLevelStudio.start(prompt, { target, plan: empty });
  let shown = 0;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const j = UnityLevelStudio.getJob(job.id)!;
      for (; shown < j.steps.length; shown++) console.log("  " + j.steps[shown]);
      if (j.status === "done" || j.status === "failed") {
        clearInterval(timer);
        resolve();
      }
    }, 2000);
  });
  const done = UnityLevelStudio.getJob(job.id)!;
  if (done.status !== "done") throw new Error(done.error);
  const scene = path.join(done.project, done.scene!);
  if (!fs.existsSync(scene)) throw new Error(`scene missing: ${scene}`);
  for (const p of done.previews) if (!fs.existsSync(p)) throw new Error(`preview missing: ${p}`);
  console.log(`[PASS] Unity level built: ${scene}\n  previews: ${done.previews.join(", ")}${done.player ? `\n  player: ${done.player}` : ""}`);
};

main().catch((error) => {
  console.error("Unity level smoketest failed:", error?.message ?? error);
  process.exit(1);
});
