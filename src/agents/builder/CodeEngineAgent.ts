/**
 * CodeEngineAgent — Specialist Software Engineer for Core Logic & Architecture.
 *
 * Powered by the best coding model (e.g. Claude 3.5 Sonnet, Qwen2.5-Coder 14B, GPT-4o).
 * Focuses strictly on:
 *   - Pure deterministic logic & calculations
 *   - Reactive state management & reducers
 *   - Data structures & TypeScript definitions
 *   - Vitest unit tests with 100% assertions
 */
import { ModelRouter } from "../../tools/ModelRouter.js";
import { Logger } from "../../utils/Logger.js";
import type { SuperPromptBlueprint } from "../../media/SuperPrompter.js";

export class CodeEngineAgent {
  /**
   * Generates core logic, stores, state, and test files using the coding model.
   */
  static async generateCoreModules(
    blueprint: SuperPromptBlueprint,
    filesNeeded: string[],
    /** Throw instead of returning the canned modules, so a build falls back to its prompt-driven planner. */
    strict = false
  ): Promise<Record<string, string>> {
    const isGame = blueprint.kind === "game";

    const prompt = `You are the Lead Code Engineer in a multi-agent swarm.
Your job is to write the core logic, state management, and unit tests for this project.

Project: ${blueprint.title} (${blueprint.projectName})
Kind: ${blueprint.kind}
Summary: ${blueprint.tagline}

Mechanics to implement:
${blueprint.gameplayOrWorkflow.mechanics.map(m => `- ${m}`).join("\n")}
Core Loop:
${blueprint.gameplayOrWorkflow.coreLoop.map(c => `- ${c}`).join("\n")}

Files assigned to you:
${filesNeeded.join(", ")}

Requirements:
- Strict TypeScript with comprehensive type safety (no 'any').
- Write complete, robust, bug-free implementations — NEVER use placeholders or "// TODO".
- Unit test files MUST test pure functions directly with real expectations that match the implementation.
- If writing a game engine: implement 60fps tick/update functions, collision detection, score calculation, entity management, and state reset.
- If writing an app store: implement reactive state store, CRUD reducers, keyword search, filtering, and metric aggregations.

Output format:
FILE: path/to/file.ext
\`\`\`language
code here
\`\`\`

Return only the assigned files in the structured format above:`;

    try {
      const response = await ModelRouter.generateForRole("code", prompt);
      const parsed = CodeEngineAgent.parseCodeBlocks(response);
      if (Object.keys(parsed).length > 0) {
        return parsed;
      }
    } catch (err: any) {
      if (strict) throw new Error(`CodeEngineAgent: the code model did not answer usably (${err?.message ?? err})`);
      Logger.warn("CodeEngineAgent generation failed, using high-reliability deterministic fallback", { error: err?.message });
      return CodeEngineAgent.getReliableModules(blueprint);
    }
    if (strict) throw new Error("CodeEngineAgent: the code model's answer had no FILE: blocks");

    return CodeEngineAgent.getReliableModules(blueprint);
  }

  static parseCodeBlocks(text: string): Record<string, string> {
    const files: Record<string, string> = {};
    const regex = /FILE:\s*([^\r\n]+)\r?\n```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const path = match[1].trim();
      const content = match[2];
      if (path && content) {
        files[path] = content;
      }
    }
    return files;
  }

  static getReliableModules(blueprint: SuperPromptBlueprint): Record<string, string> {
    const isGame = blueprint.kind === "game";

    if (isGame) {
      return {
        "src/engine/types.ts": `export interface Entity {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  active: boolean;
  color: string;
  type: "player" | "enemy" | "bullet" | "powerup";
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface GameState {
  score: number;
  highScore: number;
  health: number;
  maxHealth: number;
  wave: number;
  gameOver: boolean;
  paused: boolean;
  player: Entity;
  enemies: Entity[];
  bullets: Entity[];
  particles: Particle[];
}
`,
        "src/engine/game.ts": `import { GameState, Entity, Particle } from "./types";

export function createInitialState(width = 800, height = 600): GameState {
  return {
    score: 0,
    highScore: 0,
    health: 100,
    maxHealth: 100,
    wave: 1,
    gameOver: false,
    paused: false,
    player: {
      id: "player",
      x: width / 2,
      y: height - 80,
      vx: 0,
      vy: 0,
      radius: 18,
      active: true,
      color: "#00E5FF",
      type: "player"
    },
    enemies: [],
    bullets: [],
    particles: []
  };
}

export function checkCollision(a: Entity, b: Entity): boolean {
  if (!a.active || !b.active) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const distSq = dx * dx + dy * dy;
  const radSum = a.radius + b.radius;
  return distSq <= radSum * radSum;
}

export function updateGameState(state: GameState, deltaSec: number, bounds: { width: number; height: number }): GameState {
  if (state.gameOver || state.paused) return state;

  const nextState = { ...state };
  
  // Update player position with velocity damping
  const p = { ...nextState.player };
  p.x += p.vx * deltaSec * 60;
  p.y += p.vy * deltaSec * 60;
  p.x = Math.max(p.radius, Math.min(bounds.width - p.radius, p.x));
  p.y = Math.max(p.radius, Math.min(bounds.height - p.radius, p.y));
  p.vx *= 0.92;
  p.vy *= 0.92;
  nextState.player = p;

  // Move bullets
  nextState.bullets = nextState.bullets
    .map(b => ({ ...b, y: b.y + b.vy * deltaSec * 60 }))
    .filter(b => b.y > -20 && b.active);

  // Move enemies & spawn if empty
  if (nextState.enemies.length === 0) {
    const waveCount = 4 + nextState.wave * 2;
    const newEnemies: Entity[] = [];
    for (let i = 0; i < waveCount; i++) {
      newEnemies.push({
        id: \`enemy_\${Date.now()}_\${i}\`,
        x: 60 + ((bounds.width - 120) / waveCount) * i,
        y: 40 + (i % 2) * 50,
        vx: 1.5,
        vy: 0,
        radius: 16,
        active: true,
        color: "#F43F5E",
        type: "enemy"
      });
    }
    nextState.enemies = newEnemies;
  }

  // Update enemies and check collisions
  const survivingEnemies: Entity[] = [];
  const bullets = [...nextState.bullets];

  for (const enemy of nextState.enemies) {
    let enemyActive = true;
    for (let i = 0; i < bullets.length; i++) {
      if (bullets[i].active && checkCollision(bullets[i], enemy)) {
        bullets[i].active = false;
        enemyActive = false;
        nextState.score += 100;
        if (nextState.score > nextState.highScore) {
          nextState.highScore = nextState.score;
        }
        break;
      }
    }
    if (enemyActive) {
      let ex = enemy.x + enemy.vx * deltaSec * 60;
      let vx = enemy.vx;
      if (ex <= enemy.radius || ex >= bounds.width - enemy.radius) {
        vx = -vx;
        ex += vx;
      }
      survivingEnemies.push({ ...enemy, x: ex, vx });
    }
  }

  nextState.enemies = survivingEnemies;
  nextState.bullets = bullets.filter(b => b.active);

  return nextState;
}
`,
        "src/engine/game.test.ts": `import { describe, it, expect } from "vitest";
import { createInitialState, checkCollision, updateGameState } from "./game";

describe("GameEngine Core Logic", () => {
  it("initializes state with player centered and full health", () => {
    const state = createInitialState(800, 600);
    expect(state.health).toBe(100);
    expect(state.score).toBe(0);
    expect(state.player.x).toBe(400);
    expect(state.player.y).toBe(520);
    expect(state.gameOver).toBe(false);
  });

  it("detects collision when entities overlap", () => {
    const a = { id: "1", x: 10, y: 10, vx: 0, vy: 0, radius: 10, active: true, color: "#fff", type: "player" as const };
    const b = { id: "2", x: 15, y: 15, vx: 0, vy: 0, radius: 10, active: true, color: "#f00", type: "enemy" as const };
    expect(checkCollision(a, b)).toBe(true);
  });

  it("does not detect collision when separated", () => {
    const a = { id: "1", x: 10, y: 10, vx: 0, vy: 0, radius: 5, active: true, color: "#fff", type: "player" as const };
    const b = { id: "2", x: 100, y: 100, vx: 0, vy: 0, radius: 5, active: true, color: "#f00", type: "enemy" as const };
    expect(checkCollision(a, b)).toBe(false);
  });

  it("updates score when bullet collides with enemy", () => {
    const state = createInitialState(800, 600);
    state.enemies = [{ id: "e1", x: 100, y: 100, vx: 0, vy: 0, radius: 15, active: true, color: "#f00", type: "enemy" }];
    state.bullets = [{ id: "b1", x: 100, y: 100, vx: 0, vy: -5, radius: 4, active: true, color: "#0ff", type: "bullet" }];
    const next = updateGameState(state, 0.016, { width: 800, height: 600 });
    expect(next.score).toBe(100);
    expect(next.enemies.length).toBe(0);
  });
});
`
      };
    }

    // Default App Modules
    return {
      "src/store/types.ts": `export interface ItemRecord {
  id: string;
  title: string;
  category: string;
  status: "active" | "pending" | "completed";
  value: number;
  updatedAt: string;
}

export interface AppState {
  items: ItemRecord[];
  filterKeyword: string;
  selectedCategory: string;
  activeScreen: string;
  darkMode: boolean;
}
`,
      "src/store/state.ts": `import { AppState, ItemRecord } from "./types";

export const initialItems: ItemRecord[] = [
  { id: "1", title: "Enterprise Core Engine", category: "Core", status: "active", value: 12500, updatedAt: "2026-10-20" },
  { id: "2", title: "Spatial 3D Model Renderer", category: "Graphics", status: "active", value: 8900, updatedAt: "2026-10-21" },
  { id: "3", title: "Multi-Agent Protocol Node", category: "Networking", status: "completed", value: 15400, updatedAt: "2026-10-22" },
  { id: "4", title: "Procedural Audio Synthesizer", category: "Audio", status: "pending", value: 6200, updatedAt: "2026-10-23" }
];

export function createInitialAppState(): AppState {
  return {
    items: initialItems,
    filterKeyword: "",
    selectedCategory: "All",
    activeScreen: "overview",
    darkMode: true
  };
}

export function filterItems(items: ItemRecord[], keyword: string, category: string): ItemRecord[] {
  return items.filter(item => {
    const matchesKeyword = !keyword || item.title.toLowerCase().includes(keyword.toLowerCase());
    const matchesCategory = category === "All" || item.category === category;
    return matchesKeyword && matchesCategory;
  });
}

export function calculateSummaryMetrics(items: ItemRecord[]): { totalCount: number; activeCount: number; totalValue: number } {
  return {
    totalCount: items.length,
    activeCount: items.filter(i => i.status === "active").length,
    totalValue: items.reduce((acc, i) => acc + i.value, 0)
  };
}
`,
      "src/store/state.test.ts": `import { describe, it, expect } from "vitest";
import { createInitialAppState, filterItems, calculateSummaryMetrics, initialItems } from "./state";

describe("AppState and Store Logic", () => {
  it("creates initial state with default items", () => {
    const state = createInitialAppState();
    expect(state.items.length).toBeGreaterThan(0);
    expect(state.activeScreen).toBe("overview");
  });

  it("filters items by keyword", () => {
    const filtered = filterItems(initialItems, "Spatial", "All");
    expect(filtered.length).toBe(1);
    expect(filtered[0].title).toContain("Spatial");
  });

  it("calculates summary metrics correctly", () => {
    const metrics = calculateSummaryMetrics(initialItems);
    expect(metrics.totalCount).toBe(4);
    expect(metrics.totalValue).toBe(12500 + 8900 + 15400 + 6200);
  });
});
`
    };
  }
}
