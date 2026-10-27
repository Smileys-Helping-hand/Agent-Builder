/**
 * SuperPrompter — Deep single-prompt architectural synthesis for complete apps & games.
 *
 * Turns any single user sentence into a production-grade 10-part specification:
 *   1. Core Concept & USP
 *   2. State Machine & Gameplay/Workflow Loop
 *   3. Screen & Navigation Blueprint
 *   4. Visual Aesthetics & Design System
 *   5. Motion Choreography & Particle FX
 *   6. 3D Asset & Blender Blueprint
 *   7. Procedural Web Audio Sound FX Specs
 *   8. Modular File Manifest & Component Hierarchy
 *   9. Vitest Unit Test Scenarios
 *  10. Zero-Stub Production Assurance
 *
 * Drives the multi-agent swarm so that a single prompt builds a complete, working game or app.
 */
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";

export type ProjectKind = "game" | "app" | "dashboard" | "tool" | "3d_experience";

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  glow?: string;
}

export interface SoundFxDef {
  name: string;
  type: "laser" | "explosion" | "coin" | "jump" | "hit" | "powerup" | "click" | "ambient";
  description: string;
  frequency: number;
  durationMs: number;
}

export interface SuperPromptBlueprint {
  projectName: string;
  title: string;
  tagline: string;
  kind: ProjectKind;
  is3D: boolean;
  theme: {
    style: string;
    palette: ColorPalette;
    fontFamily: string;
  };
  gameplayOrWorkflow: {
    coreLoop: string[];
    mechanics: string[];
    winCondition?: string;
    lossCondition?: string;
  };
  screens: Array<{
    id: string;
    name: string;
    purpose: string;
    keyControls: string[];
  }>;
  animationRules: {
    easing: string;
    particleEffects: string[];
    screenTransitions: string;
  };
  blender3DAssets?: Array<{
    name: string;
    category: string;
    description: string;
    color: string;
    animation: string;
  }>;
  soundEffects: SoundFxDef[];
  filesToGenerate: Array<{
    path: string;
    purpose: string;
    keyExports: string[];
  }>;
  testsToGenerate: Array<{
    path: string;
    testingModule: string;
    cases: string[];
  }>;
  expandedBriefText: string;
}

export class SuperPrompter {
  /**
   * Detects whether the user prompt requests a game or an application.
   */
  static detectKind(prompt: string): ProjectKind {
    const text = prompt.toLowerCase();
    if (/\b(game|arcade|shooter|rpg|platformer|roguelike|racing|puzzle|runner|tower defense|flappy|asteroid|invader)\b/.test(text)) {
      return "game";
    }
    if (/\b(dashboard|analytics|metrics|admin panel|kpi|monitoring)\b/.test(text)) {
      return "dashboard";
    }
    if (/\b(calculator|converter|editor|generator|scanner|extractor|tool|utility)\b/.test(text)) {
      return "tool";
    }
    if (/\b(3d|threejs|three\.js|webgl|blender|virtual tour|visualizer|viewer)\b/.test(text)) {
      return "3d_experience";
    }
    return "app";
  }

  /**
   * Detects whether 3D rendering or Blender assets are required.
   */
  static is3DRequested(prompt: string): boolean {
    const text = prompt.toLowerCase();
    return /\b(3d|threejs|three\.js|webgl|blender|mesh|isometric|spatial|orbit|turntable|poly)\b/.test(text);
  }

  /**
   * Expands a single user prompt into a complete architectural blueprint.
   */
  static async expand(rawPrompt: string, projectNameHint?: string): Promise<SuperPromptBlueprint> {
    const cleaned = rawPrompt.trim();
    const kind = SuperPrompter.detectKind(cleaned);
    const is3D = SuperPrompter.is3DRequested(cleaned) || kind === "game"; // Default modern games to rich 3D/canvas

    const promptForModel = `You are a Principal Software Architect and Game/App Director.
Expand this single user prompt into an exhaustive production blueprint for a complete, fully functional software product.

User Single Prompt: "${cleaned}"
Category: ${kind}
3D Support: ${is3D ? "YES (Include 3D Blender/WebGL assets)" : "NO"}

Return strictly valid JSON conforming to this schema (no markdown formatting outside the JSON):
{
  "projectName": "slug-name",
  "title": "Full Display Title",
  "tagline": "Engaging single-sentence summary",
  "kind": "${kind}",
  "is3D": ${is3D},
  "theme": {
    "style": "Cyberpunk Neon / Modern Minimalist / Retro Arcade / Clean SaaS",
    "palette": {
      "primary": "#4F46E5",
      "secondary": "#06B6D4",
      "accent": "#EC4899",
      "background": "#0F172A",
      "surface": "#1E293B",
      "text": "#F8FAFC",
      "muted": "#94A3B8",
      "glow": "#00E5FF"
    },
    "fontFamily": "system-ui, sans-serif"
  },
  "gameplayOrWorkflow": {
    "coreLoop": ["Step 1", "Step 2", "Step 3", "Step 4"],
    "mechanics": ["Feature 1 with real logic", "Feature 2 with real state"],
    "winCondition": "Clear all waves / complete goals",
    "lossCondition": "Health drops to 0"
  },
  "screens": [
    { "id": "main", "name": "Main Dashboard/Playfield", "purpose": "Active screen", "keyControls": ["Action 1", "Action 2"] }
  ],
  "animationRules": {
    "easing": "cubic-bezier(0.16, 1, 0.3, 1)",
    "particleEffects": ["Particle burst on explosion", "Hover engine trail"],
    "screenTransitions": "smooth opacity & scale spring"
  },
  "blender3DAssets": [
    { "name": "Hero Craft", "category": "vehicle", "description": "Sleek low-poly spacecraft", "color": "#00E5FF", "animation": "hover" }
  ],
  "soundEffects": [
    { "name": "laser_shot", "type": "laser", "description": "Crisp high synth blip", "frequency": 880, "durationMs": 120 }
  ],
  "filesToGenerate": [
    { "path": "src/App.tsx", "purpose": "Root UI and view router", "keyExports": ["default"] },
    { "path": "src/engine/state.ts", "purpose": "State management store", "keyExports": ["useStore", "initialState"] },
    { "path": "src/engine/logic.ts", "purpose": "Pure deterministic calculation functions", "keyExports": ["calculateScore", "updatePhysics"] },
    { "path": "src/styles.css", "purpose": "Modern styling tokens and layout", "keyExports": [] }
  ],
  "testsToGenerate": [
    { "path": "src/engine/logic.test.ts", "testingModule": "src/engine/logic.ts", "cases": ["calculates score correctly", "handles collision boundary"] }
  ]
}
JSON only:`;

    try {
      const response = await ModelRouter.generateForRole("prompter", promptForModel);
      const jsonMatch = /\{[\s\S]*\}/.exec(response);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as SuperPromptBlueprint;
        if (parsed.projectName && parsed.filesToGenerate) {
          parsed.expandedBriefText = SuperPrompter.renderExpandedBrief(parsed, cleaned);
          return parsed;
        }
      }
    } catch (err: any) {
      Logger.warn("SuperPrompter model expansion failed, using instant algorithmic blueprint", { error: err?.message });
    }

    // Instant algorithmic fallback with high quality preset
    const fallback = SuperPrompter.createInstantBlueprint(cleaned, kind, is3D, projectNameHint);
    fallback.expandedBriefText = SuperPrompter.renderExpandedBrief(fallback, cleaned);
    return fallback;
  }

  /**
   * Algorithmic blueprint generator for ultra-fast, zero-token instant response.
   */
  static createInstantBlueprint(
    prompt: string,
    kind: ProjectKind,
    is3D: boolean,
    nameHint?: string
  ): SuperPromptBlueprint {
    const slug = (nameHint || prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30)) || "stellar-craft";
    const title = nameHint ? nameHint : prompt.slice(0, 40).replace(/^(build|create|make)\s+/i, "");
    const formattedTitle = title.charAt(0).toUpperCase() + title.slice(1);

    if (kind === "game") {
      return {
        projectName: slug,
        title: formattedTitle || "Cosmic Odyssey",
        tagline: "High-octane arcade action with dynamic procedural physics, particle VFX and spatial audio",
        kind: "game",
        is3D,
        theme: {
          style: "Futuristic Cyberpunk Neon",
          palette: {
            primary: "#00E5FF",
            secondary: "#7C3AED",
            accent: "#F43F5E",
            background: "#090D16",
            surface: "#111827",
            text: "#F8FAFC",
            muted: "#64748B",
            glow: "#00E5FF"
          },
          fontFamily: "'Inter', system-ui, sans-serif"
        },
        gameplayOrWorkflow: {
          coreLoop: [
            "Player spawns into dynamic playfield with full keyboard/touch controls",
            "Waves of obstacles and target entities advance with progressive difficulty curves",
            "Player shoots/interacts to collect power-ups, multiplier combos, and upgrade tokens",
            "Survive through boss phases and record high scores to persistent local storage"
          ],
          mechanics: [
            "Smooth velocity-based movement with inertia and screen wrap",
            "Projectile weapon system with multi-shot and laser beam modes",
            "Particle explosion system with glowing debris and camera shake",
            "Persistent upgrade shop for ship speed, weapon rate, and energy shields"
          ],
          winCondition: "Defeat the Sector Boss or achieve target combo score",
          lossCondition: "Hull integrity reaches zero"
        },
        screens: [
          { id: "play", name: "Playfield Arena", purpose: "Main gameplay canvas with HUD overlay", keyControls: ["Move: Arrows/WASD", "Fire: Spacebar", "Special: Shift", "Pause: ESC"] },
          { id: "shop", name: "Hangar Upgrades", purpose: "Equip upgrades purchased with accumulated credits", keyControls: ["Buy Upgrade", "Reset Upgrades"] },
          { id: "leaderboard", name: "Hall of Fame", purpose: "Display local high scores with timestamps", keyControls: ["Clear Scores", "Play Again"] }
        ],
        animationRules: {
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          particleEffects: [
            "Radial debris explosion on enemy destruction (40 particles, randomized velocity)",
            "Engine thrust exhaust trail with fading alpha",
            "Floating score popups (+100) drifting upward and fading",
            "Screen shake (amplitude 8px decaying over 250ms) on heavy impacts"
          ],
          screenTransitions: "instant zero-latency tab switching with gentle HUD fade"
        },
        blender3DAssets: [
          { name: "Hero Ship", category: "vehicle", description: "Cyan dual-wing interceptor with glowing thrusters", color: "#00E5FF", animation: "hover" },
          { name: "Enemy Scout", category: "vehicle", description: "Crimson stealth drone with angular wings", color: "#F43F5E", animation: "hover" },
          { name: "Power Crystal", category: "item", description: "Golden spinning energy core", color: "#FBBF24", animation: "spin" }
        ],
        soundEffects: [
          { name: "laser_blast", type: "laser", description: "Pitch-descending dual frequency blast", frequency: 880, durationMs: 120 },
          { name: "explosion_rumble", type: "explosion", description: "Filtered white noise burst with sub-bass drop", frequency: 120, durationMs: 400 },
          { name: "gem_pickup", type: "coin", description: "Ascending arpeggio chime", frequency: 1200, durationMs: 180 },
          { name: "player_hit", type: "hit", description: "Harsh square wave distortion impact", frequency: 160, durationMs: 220 }
        ],
        filesToGenerate: [
          { path: "src/App.tsx", purpose: "Master application container, HUD overlay, and modal views", keyExports: ["default"] },
          { path: "src/engine/game.ts", purpose: "Deterministic 60fps game loop, physics integration, and collision detection", keyExports: ["GameEngine", "createInitialState"] },
          { path: "src/engine/types.ts", purpose: "Strict TypeScript interfaces for entities, weapons, and game events", keyExports: ["GameState", "Entity", "Particle"] },
          { path: "src/engine/game.test.ts", purpose: "Comprehensive Vitest unit tests verifying state transitions and score calculations", keyExports: [] },
          { path: "src/lib/sound.ts", purpose: "Zero-dependency procedural Web Audio API synthesizer for all sound effects", keyExports: ["playSound", "soundManager"] },
          { path: "src/styles.css", purpose: "Polished dark theme styles, animations, and canvas responsive framing", keyExports: [] }
        ],
        testsToGenerate: [
          { path: "src/engine/game.test.ts", testingModule: "src/engine/game.ts", cases: ["initializes player at center", "increments score on entity elimination", "resets state on restart", "prevents negative health"] }
        ],
        expandedBriefText: ""
      };
    }

    // Default Full Application Blueprint
    return {
      projectName: slug,
      title: formattedTitle || "Omni Workspace",
      tagline: "Comprehensive modern application with real-time analytics, modular workflows, and responsive UI",
      kind,
      is3D,
      theme: {
        style: "Modern Clean Glassmorphism",
        palette: {
          primary: "#6366F1",
          secondary: "#10B981",
          accent: "#F59E0B",
          background: "#0B0F19",
          surface: "#1E293B",
          text: "#F8FAFC",
          muted: "#94A3B8"
        },
        fontFamily: "'Inter', system-ui, sans-serif"
      },
      gameplayOrWorkflow: {
        coreLoop: [
          "User navigates dashboard overview with KPI cards and interactive charts",
          "Create, edit, filter, and search primary items with instant validation",
          "Inspect item details with 3D spatial view / interactive visualizer",
          "Export reports and persist data reliably to browser local storage"
        ],
        mechanics: [
          "Full reactive CRUD state machine with undo/redo capability",
          "Advanced multi-column filtering, sorting, and full-text keyword search",
          "Interactive metrics visualization with responsive SVG/Canvas charting",
          "Data export to JSON/CSV and persistent storage sync"
        ]
      },
      screens: [
        { id: "overview", name: "Dashboard Overview", purpose: "Top-level KPI summary, activity timeline, and quick actions", keyControls: ["Quick Create", "Filter Date Range", "Export Data"] },
        { id: "items", name: "Item Manager", purpose: "Full table and card view of records with search and batch actions", keyControls: ["New Item", "Edit Item", "Delete Item", "Search Filter"] },
        { id: "visualizer", name: "3D Spatial Analytics", purpose: "Interactive spatial representation of datasets and models", keyControls: ["Rotate Camera", "Reset View", "Toggle Wireframe"] },
        { id: "settings", name: "Workspace Settings", purpose: "Configure themes, notification thresholds, and clear data", keyControls: ["Toggle Dark Mode", "Reset Database", "Save Preferences"] }
      ],
      animationRules: {
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        particleEffects: ["Subtle ambient particle background mesh", "Badge pulse on status update"],
        screenTransitions: "fade-slide with 150ms duration"
      },
      blender3DAssets: is3D ? [
        { name: "Analytics Cube", category: "item", description: "Modular glass data cube with glowing core", color: "#6366F1", animation: "spin" },
        { name: "Server Node", category: "prop", description: "Rack mount node with LED indicators", color: "#10B981", animation: "pulse" }
      ] : undefined,
      soundEffects: [
        { name: "click_soft", type: "click", description: "Short soft tactile UI tick", frequency: 600, durationMs: 40 },
        { name: "action_success", type: "coin", description: "Subtle positive completion chime", frequency: 950, durationMs: 140 }
      ],
      filesToGenerate: [
        { path: "src/App.tsx", purpose: "Root application layout, navigation sidebar, and active screen router", keyExports: ["default"] },
        { path: "src/store/state.ts", purpose: "Central state management, local storage persistence, and action reducers", keyExports: ["useAppStore", "createStore"] },
        { path: "src/store/types.ts", purpose: "TypeScript domain models and entity definitions", keyExports: ["ItemRecord", "FilterOptions", "AppMetrics"] },
        { path: "src/store/state.test.ts", purpose: "Unit tests verifying CRUD operations, filtering, and calculation logic", keyExports: [] },
        { path: "src/components/Dashboard.tsx", purpose: "KPI summary metrics and interactive visual charts", keyExports: ["Dashboard"] },
        { path: "src/components/ItemManager.tsx", purpose: "Searchable, filterable item table with add/edit modals", keyExports: ["ItemManager"] },
        { path: "src/styles.css", purpose: "Comprehensive design system: CSS variables, glassmorphic cards, typography", keyExports: [] }
      ],
      testsToGenerate: [
        { path: "src/store/state.test.ts", testingModule: "src/store/state.ts", cases: ["adds new items correctly", "filters items by keyword", "updates existing records", "calculates summary metrics accurately"] }
      ],
      expandedBriefText: ""
    };
  }

  /**
   * Renders the expanded specification into a rich, structured description that
   * can be passed directly to the Multi-Agent Builder and AutonomousOrchestrator.
   */
  static renderExpandedBrief(bp: SuperPromptBlueprint, originalPrompt: string): string {
    const isGame = bp.kind === "game";

    return `### Project: ${bp.title} (${bp.projectName})
Original Request: "${originalPrompt}"
Category: ${bp.kind.toUpperCase()} | 3D Graphics: ${bp.is3D ? "ENABLED" : "2D High Polish"}
Style & Aesthetic: ${bp.theme.style} (Primary: ${bp.theme.palette.primary}, Background: ${bp.theme.palette.background})

#### 1. Core Mechanics & State Architecture
- Core Loop:
${bp.gameplayOrWorkflow.coreLoop.map(s => `  * ${s}`).join("\n")}
- Key Interactive Mechanics:
${bp.gameplayOrWorkflow.mechanics.map(m => `  * ${m}`).join("\n")}
${bp.gameplayOrWorkflow.winCondition ? `- Win Condition: ${bp.gameplayOrWorkflow.winCondition}` : ""}
${bp.gameplayOrWorkflow.lossCondition ? `- Loss Condition: ${bp.gameplayOrWorkflow.lossCondition}` : ""}

#### 2. Screen Hierarchy & Navigation
${bp.screens.map(s => `- **${s.name}** [id: "${s.id}"]: ${s.purpose}\n  Controls: ${s.keyControls.join(", ")}`).join("\n")}

#### 3. Visual & Motion Choreography
- Color Palette: Primary ${bp.theme.palette.primary}, Secondary ${bp.theme.palette.secondary}, Accent ${bp.theme.palette.accent}, Background ${bp.theme.palette.background}
- Motion Easing: ${bp.animationRules.easing}
- Visual VFX & Particles:
${bp.animationRules.particleEffects.map(p => `  * ${p}`).join("\n")}

${bp.blender3DAssets && bp.blender3DAssets.length > 0 ? `#### 4. 3D Asset & Blender Scene Plan
${bp.blender3DAssets.map(a => `- **${a.name}** (${a.category}): ${a.description} [Color: ${a.color}, Animation: ${a.animation}]`).join("\n")}
(Blender Python automation scripts and Three.js procedural renderers are generated in blender/ and src/lib/three3d.ts)` : ""}

#### 5. Procedural Web Audio Sound FX (Zero-Dependency Audio)
${bp.soundEffects.map(s => `- ${s.name} (${s.type}): ${s.description} at ${s.frequency}Hz (${s.durationMs}ms)`).join("\n")}

#### 6. Production Quality Mandate
- NO placeholder text ("Lorem Ipsum", "Coming Soon", "Under Construction").
- Every button, input, toggle, and link MUST be wired to real state and real interactions.
- Zero external runtime asset dependencies: 3D models and sound effects are fully procedural and executable.
- All core calculations and business logic MUST be covered by passing Vitest unit tests.`;
  }
}
