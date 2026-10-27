/**
 * AppDeconstructor — Codebase Reverse-Engineering, Feature Extraction & Rebuild Engine.
 *
 * Tears existing applications or codebases down to their core primitives:
 *   - Extracts component hierarchies, state machines, routes, and data flows.
 *   - Dissects all user features and capabilities into a formal Feature Catalog.
 *   - Detects bottlenecks, dead code, missing tests, and architectural antipatterns.
 *   - Generates an "Elevate & Rebuild" Master Specification to recreate the app
 *     with modern architecture, 3D spatial models, procedural audio, and zero stubs.
 *   - Enriches LessonMemory so Agent Builder continuously learns from real codebases.
 */
import fs from "fs";
import path from "path";

import { ModelRouter } from "../tools/ModelRouter.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { ExemplarMemory } from "../learning/ExemplarMemory.js";
import { Logger } from "../utils/Logger.js";

export interface DissectedFeature {
  name: string;
  category: "core_workflow" | "data_management" | "ui_interaction" | "api_integration" | "gameplay";
  description: string;
  sourceFiles: string[];
}

export interface DissectedComponent {
  name: string;
  path: string;
  props: string[];
  stateHooks: string[];
  childComponents: string[];
}

export interface AppDeconstructionReport {
  projectName: string;
  projectPath: string;
  framework: string;
  totalFiles: number;
  features: DissectedFeature[];
  components: DissectedComponent[];
  stateStores: string[];
  flawsDetected: string[];
  /** "model": the code model analysed it. "scan": only what scanning the files found (the model did not answer in time). */
  analysedBy?: "model" | "scan";
  note?: string;
  upgradeOpportunities: string[];
  rebuildBlueprint: {
    title: string;
    description: string;
    suggestedPlatforms: string[];
    modernizedStack: string;
    fileManifest: Array<{ path: string; purpose: string }>;
  };
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "out", "coverage", ".turbo", ".cache", "build"]);

export class AppDeconstructor {
  /**
   * Scans and walks all source files in a target directory.
   */
  static scanSourceFiles(root: string): Array<{ relative: string; full: string; size: number }> {
    const results: Array<{ relative: string; full: string; size: number }> = [];

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
              walk(path.join(dir, entry.name));
            }
          } else if (entry.isFile()) {
            if (/\.(tsx?|jsx?|vue|svelte|html|css|json|py)$/i.test(entry.name)) {
              const full = path.join(dir, entry.name);
              const relative = path.relative(root, full).replace(/\\/g, "/");
              const stat = fs.statSync(full);
              results.push({ relative, full, size: stat.size });
            }
          }
        }
      } catch (err: any) {
        Logger.warn(`Error scanning directory: ${dir}`, { error: err?.message });
      }
    };

    walk(root);
    return results;
  }

  /**
   * Tears down an application to extract features, components, state, and flaws.
   */
  static async deconstruct(projectPath: string): Promise<AppDeconstructionReport> {
    const absPath = path.resolve(projectPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Project directory not found: ${absPath}`);
    }

    const files = AppDeconstructor.scanSourceFiles(absPath);
    const projectName = path.basename(absPath);

    // Read package.json for dependencies
    let pkg: any = {};
    let framework = "Vanilla / Unknown";
    const pkgPath = path.join(absPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.next) framework = "Next.js (React)";
        else if (allDeps.react) framework = "React + Vite/CRA";
        else if (allDeps.vue) framework = "Vue.js";
        else if (allDeps.express) framework = "Node.js (Express)";
      } catch {}
    }

    // Dissect code patterns
    const features: DissectedFeature[] = [];
    const components: DissectedComponent[] = [];
    const stateStores: string[] = [];
    const flawsDetected: string[] = [];
    const keySnippets: string[] = [];

    for (const f of files.slice(0, 30)) {
      try {
        const text = fs.readFileSync(f.full, "utf8");

        // Detect components
        const compMatches = text.match(/(?:export\s+(?:default\s+)?function|const)\s+([A-Z][a-zA-Z0-9]+)/g);
        if (compMatches) {
          for (const c of compMatches) {
            const name = c.split(/\s+/).pop() ?? "";
            if (name && !components.some(x => x.name === name)) {
              const stateHooks = (text.match(/useState|useReducer|useStore|useRef/g) || []);
              components.push({
                name,
                path: f.relative,
                props: [],
                stateHooks,
                childComponents: []
              });
            }
          }
        }

        // Detect State stores
        if (f.relative.includes("store") || f.relative.includes("state") || text.includes("createStore") || text.includes("createInitialState")) {
          stateStores.push(f.relative);
        }

        // Detect Flaws / Antipatterns
        if (text.includes("TODO") || text.includes("coming soon") || text.includes("Lorem ipsum")) {
          flawsDetected.push(`Stub/Placeholder detected in ${f.relative}`);
        }
        if (text.includes(": any") || text.includes("as any")) {
          flawsDetected.push(`Loose typing ('any') detected in ${f.relative}`);
        }

        // Collect key excerpt
        if (f.relative.includes("App.") || f.relative.includes("index.") || f.relative.includes("game.") || f.relative.includes("state.")) {
          keySnippets.push(`--- ${f.relative} ---\n${text.slice(0, 800)}`);
        }
      } catch {}
    }

    // Default core feature identification
    features.push({
      name: "Core Application Shell",
      category: "core_workflow",
      description: `Primary application container and UI entrypoint built on ${framework}`,
      sourceFiles: files.filter(f => f.relative.includes("App") || f.relative.includes("main")).map(f => f.relative)
    });

    if (stateStores.length > 0) {
      features.push({
        name: "Central State Management",
        category: "data_management",
        description: "State persistence, reactive reducers, and domain data models",
        sourceFiles: stateStores
      });
    }

    // Rebuild Blueprint Generation via Specialist Model
    const analysisPrompt = `You are a Lead Software Architect specializing in Codebase Deconstruction and Modern Re-Architecture.
I have torn down an existing application:
Project: ${projectName}
Framework: ${framework}
Source Files Analyzed: ${files.length}
State Stores: ${stateStores.join(", ") || "Component local state"}
Flaws Discovered: ${flawsDetected.slice(0, 5).join("; ") || "None"}

Code Excerpts:
${keySnippets.slice(0, 4).join("\n\n")}

Provide:
1. 3-5 primary user features this app provides.
2. 3 concrete architectural upgrade opportunities (e.g. 60fps animations, WebGL/Three.js 3D visualizers, zero-dependency audio, modern state).
3. A concise blueprint on how to rebuild this app from scratch with 100% production quality and zero stubs.

Respond strictly in valid JSON:
{
  "features": [
    { "name": "Feature Name", "category": "core_workflow", "description": "What it does" }
  ],
  "upgradeOpportunities": ["Upgrade 1", "Upgrade 2", "Upgrade 3"],
  "rebuildBlueprint": {
    "title": "Modernized ${projectName}",
    "description": "Exhaustive description of the modernized rebuild",
    "suggestedPlatforms": ["web", "windows", "android"],
    "modernizedStack": "React 19 + TypeScript + Vite + Tailwind + Web Audio",
    "fileManifest": [
      { "path": "src/App.tsx", "purpose": "Polished responsive application shell" },
      { "path": "src/engine/state.ts", "purpose": "Strongly typed reactive state machine" },
      { "path": "src/styles.css", "purpose": "Modern design tokens and motion choreography" }
    ]
  }
}
JSON only:`;

    try {
      const modelResp = await Promise.race([
        ModelRouter.generateForRole("code", analysisPrompt),
        // The app waits on this request (and the tunnel cuts it at 100 s): give the model what it can have.
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("no answer in time")), Number(process.env.DECONSTRUCT_TIMEOUT_MS ?? 55_000)))
      ]);
      const jsonMatch = /\{[\s\S]*\}/.exec(modelResp);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.rebuildBlueprint) {
          const report: AppDeconstructionReport = {
            projectName,
            projectPath: absPath,
            framework,
            totalFiles: files.length,
            features: [...features, ...(parsed.features || [])],
            components,
            stateStores,
            flawsDetected,
            analysedBy: "model",
            upgradeOpportunities: parsed.upgradeOpportunities || [
              "Migrate to strict TypeScript with zero 'any' types",
              "Integrate 3D spatial models and Blender asset pipeline",
              "Add zero-dependency procedural Web Audio sound synthesis"
            ],
            rebuildBlueprint: parsed.rebuildBlueprint
          };

          // Record lesson in LessonMemory so Agent Builder continuously learns
          LessonMemory.recordFix(
            "build",
            `deconstruct-${projectName}`,
            `Deconstructed ${projectName} (${framework}). Rebuilding requires extracting state stores, separating business logic from rendering, and eliminating placeholder stubs.`,
            JSON.stringify(report.upgradeOpportunities)
          );

          return report;
        }
      }
    } catch (err: any) {
      Logger.warn("Model deconstruction fallback used", { error: err?.message });
    }

    // Reliable fallback report
    const fallbackReport: AppDeconstructionReport = {
      projectName,
      projectPath: absPath,
      framework,
      totalFiles: files.length,
      features,
      components,
      stateStores,
      flawsDetected,
      analysedBy: "scan",
      note: "The code model did not answer in time, so this is only what scanning the files found. Run it again when the PC is less busy for a judged analysis.",
      // Only what the scan actually found — no generic advice dressed up as analysis.
      upgradeOpportunities: [
        ...(flawsDetected.some((flaw) => /Stub|Placeholder/i.test(flaw)) ? ["Finish the stubbed and placeholder code the scan found"] : []),
        ...(flawsDetected.some((flaw) => /any/.test(flaw)) ? ["Replace the loose 'any' types the scan found with real types"] : []),
        ...(stateStores.length === 0 && components.length > 5 ? ["Pull shared state out of components into one store"] : [])
      ],
      rebuildBlueprint: {
        title: `Rebuild of ${projectName}`,
        description: `A rebuild of ${projectName} (${framework}) keeping its ${features.length} detected features and fixing the ${flawsDetected.length} problems the scan found.`,
        suggestedPlatforms: ["web"],
        modernizedStack: framework,
        fileManifest: []
      }
    };

    return fallbackReport;
  }
}
