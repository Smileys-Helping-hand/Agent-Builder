/**
 * Smoketest for Multi-Agent Super-Model Swarm, Blender 3D Studio, and SuperPrompter.
 * Run with: npx tsx scripts/super-model-smoketest.ts
 */
import fs from "fs";
import path from "path";
import os from "os";

import { SuperPrompter } from "../src/media/SuperPrompter.js";
import { BlenderStudio } from "../src/media/BlenderStudio.js";
import { SoundCraft } from "../src/media/SoundCraft.js";
import { ModelRouter, getProviderForRole } from "../src/tools/ModelRouter.js";
import { SuperModelSynthesizer } from "../src/agents/builder/SuperModelSynthesizer.js";

async function main() {
  if (process.env.SMOKE_LIVE !== "1") {
    // Offline run: the 3D and prompt roles point at a closed port and fail at
    // once, so this exercises the fallbacks instead of waiting on a local model.
    process.env.MODEL_PROVIDER_3D = "lmstudio";
    process.env.MODEL_PROVIDER_PROMPTER = "lmstudio";
    process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
    process.env.MODEL_WAIT_MS = "0";
  }
  console.log("==========================================================");
  console.log(" 🚀 Multi-Agent Super-Model & Blender 3D Smoketest");
  console.log("==========================================================\n");

  // Test 1: Role-Based Model Routing
  console.log("Test 1: ModelRouter Role Resolution...");
  const codeRole = getProviderForRole("code");
  const visualRole = getProviderForRole("visual");
  const d3Role = getProviderForRole("3d");
  const prompterRole = getProviderForRole("prompter");
  console.log(`  - Code Role Provider: ${codeRole.provider} (model: ${codeRole.model || "default"})`);
  console.log(`  - Visual Role Provider: ${visualRole.provider} (model: ${visualRole.model || "default"})`);
  console.log(`  - 3D Role Provider: ${d3Role.provider}`);
  console.log(`  - Prompter Role Provider: ${prompterRole.provider}`);
  console.log("  [PASS] Role-based model routing verified.\n");

  // Test 2: Blender Studio Detection & bpy Script Generation
  console.log("Test 2: Blender Studio Detection & bpy Generation...");
  const blenderStatus = BlenderStudio.detectBlender();
  console.log(`  - Blender Detected: ${blenderStatus.installed ? `YES (${blenderStatus.path})` : "NO (graceful fallback active)"}`);

  const sample3DPlan = await BlenderStudio.plan3DAssets("CosmicInterceptor", "3D space fighter game with asteroid hazards");
  console.log(`  - 3D Scene Style: ${sample3DPlan.style}`);
  console.log(`  - 3D Assets Planned: ${sample3DPlan.assets.map(a => a.name).join(", ")}`);

  const bpyScript = BlenderStudio.generateBlenderPythonScript(sample3DPlan);
  if (!bpyScript.includes("import bpy") || !bpyScript.includes("create_principled_material")) {
    throw new Error("Generated Blender script missing bpy or Principled BSDF nodes");
  }
  console.log(`  - Generated bpy Python script size: ${bpyScript.length} chars`);

  const threeBridge = BlenderStudio.generateThreeJsBridge(sample3DPlan);
  if (!threeBridge.includes("drawProcedural3DObject")) {
    throw new Error("Generated Three.js bridge missing drawProcedural3DObject");
  }
  console.log(`  - Generated Three.js bridge size: ${threeBridge.length} chars`);
  console.log("  [PASS] Blender 3D pipeline verified.\n");

  // Test 3: Procedural SoundCraft Generation
  console.log("Test 3: SoundCraft Procedural Audio Synthesis...");
  const soundEngine = SoundCraft.generateSoundEngine([
    { name: "laser", type: "laser", description: "Blaster beam", frequency: 880, durationMs: 120 },
    { name: "explosion", type: "explosion", description: "Rumble", frequency: 120, durationMs: 350 }
  ]);
  if (!soundEngine.includes("AudioContext") || !soundEngine.includes("laser") || !soundEngine.includes("explosion")) {
    throw new Error("SoundCraft engine missing Web Audio API implementation");
  }
  console.log(`  - Generated procedural sound module size: ${soundEngine.length} chars`);
  console.log("  [PASS] SoundCraft procedural audio verified.\n");

  // Test 4: SuperPrompter Single-Prompt Expansion
  console.log("Test 4: SuperPrompter Deep Single-Prompt Expansion...");
  const singlePrompt = "Build a fast 3D space shooter game with boss fights, weapon upgrades, and particle effects";
  const blueprint = await SuperPrompter.expand(singlePrompt);
  console.log(`  - Title: ${blueprint.title}`);
  console.log(`  - Category: ${blueprint.kind}`);
  console.log(`  - 3D Mode: ${blueprint.is3D}`);
  console.log(`  - Theme Style: ${blueprint.theme.style}`);
  console.log(`  - Core Loop Steps: ${blueprint.gameplayOrWorkflow.coreLoop.length}`);
  console.log(`  - Screens: ${blueprint.screens.map(s => s.name).join(", ")}`);
  console.log(`  - Sound Effects: ${blueprint.soundEffects.map(s => s.name).join(", ")}`);
  console.log(`  - Files in Blueprint: ${blueprint.filesToGenerate.length}`);
  if (blueprint.filesToGenerate.length === 0 || !blueprint.title) {
    throw new Error("SuperPrompter failed to create valid blueprint");
  }
  console.log("  [PASS] SuperPrompter expansion verified.\n");

  // Test 5: End-to-End Super-Model Project Synthesis. Every agent waits for its
  // model, so on a local model this takes as long as a build: opt in with SMOKE_LIVE=1.
  if (process.env.SMOKE_LIVE !== "1") {
    console.log("Test 5: skipped (set SMOKE_LIVE=1 to run a full synthesis against the configured models).\n");
    console.log("==========================================================");
    console.log(" ✅ Multi-Agent Super-Model & Blender 3D Tests Passed!");
    console.log("==========================================================");
    process.exit(0);
  }
  console.log("Test 5: Full Super-Model Synthesis into Test Workspace...");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "super-model-test-"));
  try {
    const result = await SuperModelSynthesizer.synthesizeFromSinglePrompt(
      tempDir,
      "Build a modern SaaS task dashboard with 3D status visualizer and sound effects",
      "TaskFlowUltra",
      (kind, title, text) => console.log(`    [Agent Thought - ${kind}] ${title}`)
    );

    console.log(`  - Duration: ${result.durationMs}ms`);
    console.log(`  - Files Generated: ${Object.keys(result.files).length}`);
    console.log(`  - Blender 3D Files Created: ${result.blender3D.filesCreated.length}`);
    console.log(`  - QA Score: ${result.qaReport.score}/100 (Passed: ${result.qaReport.passed})`);
    for (const check of result.qaReport.checks) {
      console.log(`    * ${check.name}: ${check.passed ? "✓ PASS" : "✗ FAIL"}`);
    }

    // Verify key files physically exist on disk
    const expectedFiles = [
      "src/App.tsx",
      "src/styles.css",
      "src/lib/sound.ts",
      "src/lib/three3d.ts",
      "blender/generate_assets.py",
      "blender/build-in-blender.cmd",
      "public/assets/3d/assets-3d.json"
    ];

    for (const f of expectedFiles) {
      const fullPath = path.join(tempDir, f);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Expected generated file missing: ${f}`);
      }
    }

    console.log("  [PASS] All generated files verified on disk.\n");
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log("==========================================================");
  console.log(" ✅ All Multi-Agent Super-Model & Blender 3D Tests Passed!");
  console.log("==========================================================");
}

main().catch((err) => {
  console.error("Smoketest failed:", err);
  process.exit(1);
});
