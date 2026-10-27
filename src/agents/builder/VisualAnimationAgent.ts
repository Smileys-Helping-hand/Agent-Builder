/**
 * VisualAnimationAgent — Specialist for High-Fidelity UI/UX, Animations & Canvas VFX.
 *
 * Powered by the best visual and multimodal animation model (e.g. Gemini 1.5 Pro / Flash, GPT-4o).
 * Focuses on:
 *   - Sleek responsive layouts, Glassmorphism, Neon Cyberpunk, or Clean SaaS aesthetics
 *   - 60fps Canvas 2D / WebGL rendering with double buffering
 *   - Particle explosion systems, exhaust trails, screen shake, and floating text
 *   - Seamless integration with Three.js 3D assets and SoundCraft procedural audio
 */
import { ModelRouter } from "../../tools/ModelRouter.js";
import { Logger } from "../../utils/Logger.js";
import type { SuperPromptBlueprint } from "../../media/SuperPrompter.js";

export class VisualAnimationAgent {
  /**
   * Generates the frontend UI, canvas rendering loops, and CSS animations.
   */
  static async generateVisualModules(
    blueprint: SuperPromptBlueprint,
    codeModules: Record<string, string>,
    /** Throw instead of returning the canned design, so a build falls back to its prompt-driven planner. */
    strict = false
  ): Promise<Record<string, string>> {
    const isGame = blueprint.kind === "game";

    const prompt = `You are the Lead Visual Designer and Motion/UI Specialist in a multi-agent swarm.
Your job is to generate the frontend UI, Canvas rendering loop (if a game), and CSS styling.

Project: ${blueprint.title} (${blueprint.projectName})
Kind: ${blueprint.kind}
Style: ${blueprint.theme.style}
Palette:
- Primary: ${blueprint.theme.palette.primary}
- Secondary: ${blueprint.theme.palette.secondary}
- Accent: ${blueprint.theme.palette.accent}
- Background: ${blueprint.theme.palette.background}
- Surface: ${blueprint.theme.palette.surface}
- Text: ${blueprint.theme.palette.text}

Animation & VFX Rules:
- Easing: ${blueprint.animationRules.easing}
- Particle FX: ${blueprint.animationRules.particleEffects.join("; ")}

Screens to support:
${blueprint.screens.map(s => `- ${s.name} (${s.id}): ${s.purpose}`).join("\n")}

Available imported modules:
- Audio: import { sounds } from "./lib/sound" (methods: laser, explosion, coin, hit, click, toggleMute, isMuted)
- 3D Assets: import { drawProcedural3DObject, ASSETS_3D_MANIFEST } from "./lib/three3d"
${isGame ? '- Game Engine: import { GameState, createInitialState, updateGameState } from "./engine/game"' : '- State Store: import { AppState, createInitialAppState, filterItems, calculateSummaryMetrics } from "./store/state"'}

Files you must generate:
- FILE: src/App.tsx
- FILE: src/styles.css

Requirements:
- Production-ready React 18+ TypeScript code.
- Must export default App component.
- Zero placeholder buttons; wire every control to real actions.
- If game: implement responsive <canvas>, 60fps requestAnimationFrame loop, particle effects, HUD overlay, keyboard/touch input handlers, and audio integration.
- If app: implement modern tabbed layout, interactive search/filter inputs, modal dialogs, and SVG/canvas metrics visualization.

Output format:
FILE: path/to/file.ext
\`\`\`language
code here
\`\`\`

Return only the visual files in the structured format above:`;

    try {
      const response = await ModelRouter.generateForRole("visual", prompt);
      const parsed = VisualAnimationAgent.parseCodeBlocks(response);
      if (parsed["src/App.tsx"] && parsed["src/styles.css"]) {
        return parsed;
      }
    } catch (err: any) {
      if (strict) throw new Error(`VisualAnimationAgent: the visual model did not answer usably (${err?.message ?? err})`);
      Logger.warn("VisualAnimationAgent model generation failed, using polished visual design template", { error: err?.message });
      return VisualAnimationAgent.getReliableVisualModules(blueprint);
    }
    if (strict) throw new Error("VisualAnimationAgent: the visual model's answer lacked src/App.tsx and src/styles.css");

    return VisualAnimationAgent.getReliableVisualModules(blueprint);
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

  static getReliableVisualModules(blueprint: SuperPromptBlueprint): Record<string, string> {
    const isGame = blueprint.kind === "game";

    if (isGame) {
      return {
        "src/App.tsx": `import React, { useEffect, useRef, useState } from "react";
import { GameState, createInitialState, updateGameState, Entity, Particle } from "./engine/game";
import { sounds } from "./lib/sound";
import { drawProcedural3DObject } from "./lib/three3d";
import "./styles.css";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [gameState, setGameState] = useState<GameState>(() => createInitialState(800, 600));
  const [isMuted, setIsMuted] = useState(false);
  const [activeTab, setActiveTab] = useState<"play" | "hangar" | "scores">("play");
  const keysRef = useRef<Record<string, boolean>>({});
  const stateRef = useRef<GameState>(gameState);
  stateRef.current = gameState;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = true;
      if (e.key === " " || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
      }
      if (e.key === " ") {
        // Fire bullet
        const s = stateRef.current;
        if (!s.gameOver && !s.paused && activeTab === "play") {
          sounds.laser();
          s.bullets.push({
            id: \`bullet_\${Date.now()}\`,
            x: s.player.x,
            y: s.player.y - s.player.radius - 4,
            vx: 0,
            vy: -10,
            radius: 4,
            active: true,
            color: "#00E5FF",
            type: "bullet"
          });
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key.toLowerCase()] = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [activeTab]);

  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      const deltaSec = Math.min((currentTime - lastTime) / 1000, 0.1);
      lastTime = currentTime;

      const canvas = canvasRef.current;
      if (canvas && activeTab === "play") {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const keys = keysRef.current;
          const s = stateRef.current;

          // Input handling
          let vx = 0;
          let vy = 0;
          if (keys["arrowleft"] || keys["a"]) vx -= 6;
          if (keys["arrowright"] || keys["d"]) vx += 6;
          if (keys["arrowup"] || keys["w"]) vy -= 6;
          if (keys["arrowdown"] || keys["s"]) vy += 6;

          s.player.vx += vx * 0.4;
          s.player.vy += vy * 0.4;

          const updated = updateGameState(s, deltaSec, { width: canvas.width, height: canvas.height });
          setGameState({ ...updated });

          // Render
          ctx.fillStyle = "#090D16";
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Starfield background
          ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
          for (let i = 0; i < 40; i++) {
            const sx = ((i * 137) + currentTime * 0.05) % canvas.width;
            const sy = (i * 97) % canvas.height;
            ctx.fillRect(sx, sy, 2, 2);
          }

          // Draw 3D Player Ship via procedural Three/Canvas pipeline
          drawProcedural3DObject(ctx, "player_avatar", updated.player.x, updated.player.y, 44, currentTime / 1000);

          // Draw Enemies
          for (const enemy of updated.enemies) {
            drawProcedural3DObject(ctx, "obstacle_drone", enemy.x, enemy.y, 36, currentTime / 1000);
          }

          // Draw Bullets
          for (const b of updated.bullets) {
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
            ctx.fillStyle = b.color;
            ctx.shadowColor = b.color;
            ctx.shadowBlur = 8;
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [activeTab]);

  const toggleSound = () => {
    const muted = sounds.toggleMute();
    setIsMuted(muted);
    if (!muted) sounds.coin();
  };

  const restartGame = () => {
    sounds.click();
    setGameState(createInitialState(800, 600));
  };

  return (
    <div className="game-container">
      <header className="game-header">
        <div className="brand">
          <div className="brand-logo">⚡</div>
          <div>
            <h1>${blueprint.title}</h1>
            <p className="tagline">${blueprint.tagline}</p>
          </div>
        </div>
        <div className="header-controls">
          <button className="icon-btn" onClick={toggleSound} title="Toggle Sound">
            {isMuted ? "🔇" : "🔊"}
          </button>
          <div className="tabs">
            <button className={activeTab === "play" ? "tab active" : "tab"} onClick={() => { sounds.click(); setActiveTab("play"); }}>Arena</button>
            <button className={activeTab === "hangar" ? "tab active" : "tab"} onClick={() => { sounds.click(); setActiveTab("hangar"); }}>Hangar</button>
            <button className={activeTab === "scores" ? "tab active" : "tab"} onClick={() => { sounds.click(); setActiveTab("scores"); }}>Scores</button>
          </div>
        </div>
      </header>

      <main className="game-main">
        {activeTab === "play" && (
          <div className="canvas-wrapper">
            <div className="hud-overlay">
              <div className="hud-metric">
                <span className="label">SCORE</span>
                <span className="value score-val">{gameState.score}</span>
              </div>
              <div className="hud-metric">
                <span className="label">WAVE</span>
                <span className="value">{gameState.wave}</span>
              </div>
              <div className="hud-metric">
                <span className="label">HULL INTEGRITY</span>
                <div className="health-bar-container">
                  <div className="health-bar-fill" style={{ width: \`\${gameState.health}%\` }} />
                </div>
              </div>
            </div>

            <canvas ref={canvasRef} width={800} height={600} className="game-canvas" />

            <div className="control-hints">
              <span>⌨️ [WASD / Arrows] Move</span>
              <span>🚀 [Space] Fire Blaster</span>
              <span>🎯 Destroy target drones to score points</span>
            </div>
          </div>
        )}

        {activeTab === "hangar" && (
          <div className="panel-card">
            <h2>Hangar & Ship Customization</h2>
            <p>Procedural 3D assets compiled for Blender and WebGL engine.</p>
            <div className="asset-grid">
              <div className="asset-card">
                <h3>Vanguard Interceptor</h3>
                <p>Equipped with dual plasma blasters and kinetic shields.</p>
                <button className="primary-btn" onClick={() => { sounds.coin(); alert("Ship tuned for max performance!"); }}>Tune Thrusters</button>
              </div>
              <div className="asset-card">
                <h3>Blender 3D Scene Assets</h3>
                <p>Executable scripts available in <code>blender/generate_assets.py</code>.</p>
                <button className="secondary-btn" onClick={() => { sounds.click(); alert("Run blender/build-in-blender.cmd to compile models!"); }}>View Blender Specs</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "scores" && (
          <div className="panel-card">
            <h2>Hall of Fame</h2>
            <div className="score-table">
              <div className="score-row header">
                <span>Rank</span>
                <span>Pilot</span>
                <span>Score</span>
              </div>
              <div className="score-row">
                <span>#1</span>
                <span>ACE_PILOT</span>
                <span>{Math.max(gameState.highScore, 2400)}</span>
              </div>
              <div className="score-row">
                <span>#2</span>
                <span>CURRENT RUN</span>
                <span>{gameState.score}</span>
              </div>
            </div>
            <button className="primary-btn" style={{ marginTop: "1rem" }} onClick={restartGame}>Start New Run</button>
          </div>
        )}
      </main>
    </div>
  );
}
`,
        "src/styles.css": `:root {
  --bg-dark: ${blueprint.theme.palette.background};
  --surface: ${blueprint.theme.palette.surface};
  --primary: ${blueprint.theme.palette.primary};
  --secondary: ${blueprint.theme.palette.secondary};
  --accent: ${blueprint.theme.palette.accent};
  --text: ${blueprint.theme.palette.text};
  --muted: ${blueprint.theme.palette.muted};
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background-color: var(--bg-dark);
  color: var(--text);
  font-family: ${blueprint.theme.fontFamily};
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.game-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

.game-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: rgba(17, 24, 39, 0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-logo {
  font-size: 1.8rem;
  background: linear-gradient(135deg, var(--primary), var(--accent));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand h1 {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.tagline {
  font-size: 0.8rem;
  color: var(--muted);
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.icon-btn {
  background: var(--surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text);
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 1.1rem;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.tabs {
  display: flex;
  background: rgba(0, 0, 0, 0.3);
  padding: 4px;
  border-radius: 8px;
  gap: 4px;
}

.tab {
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 0.5rem 1rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.tab.active {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.4);
}

.game-main {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1.5rem;
}

.canvas-wrapper {
  position: relative;
  background: #000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.game-canvas {
  display: block;
  width: 800px;
  height: 600px;
}

.hud-overlay {
  position: absolute;
  top: 1rem;
  left: 1.5rem;
  right: 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  pointer-events: none;
}

.hud-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hud-metric .label {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: var(--muted);
  font-weight: 600;
}

.hud-metric .value {
  font-size: 1.25rem;
  font-weight: 700;
  color: #fff;
}

.score-val {
  color: var(--primary);
  text-shadow: 0 0 8px var(--primary);
}

.health-bar-container {
  width: 140px;
  height: 8px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  overflow: hidden;
}

.health-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #10B981, var(--primary));
  transition: width 0.3s ease;
}

.control-hints {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  padding: 0.75rem;
  background: rgba(17, 24, 39, 0.9);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  font-size: 0.8rem;
  color: var(--muted);
}

.panel-card {
  background: var(--surface);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 2rem;
  max-width: 700px;
  width: 100%;
}

.panel-card h2 {
  font-size: 1.5rem;
  margin-bottom: 0.5rem;
}

.panel-card p {
  color: var(--muted);
  margin-bottom: 1.5rem;
}

.asset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.asset-card {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.primary-btn {
  background: var(--primary);
  color: #fff;
  border: none;
  padding: 0.6rem 1.25rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.primary-btn:hover {
  filter: brightness(1.15);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.4);
}

.secondary-btn {
  background: transparent;
  color: var(--text);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 0.6rem 1.25rem;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.secondary-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.score-table {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.score-row {
  display: flex;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.score-row.header {
  font-weight: 600;
  color: var(--muted);
  background: transparent;
}
`
      };
    }

    // Default Full Application Visual Modules
    return {
      "src/App.tsx": `import React, { useState } from "react";
import { AppState, createInitialAppState, filterItems, calculateSummaryMetrics, ItemRecord } from "./store/state";
import { sounds } from "./lib/sound";
import "./styles.css";

export default function App() {
  const [state, setState] = useState<AppState>(() => createInitialAppState());
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [newItemTitle, setNewItemTitle] = useState("");

  const filteredItems = filterItems(state.items, searchQuery, activeCategory);
  const metrics = calculateSummaryMetrics(state.items);

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemTitle.trim()) return;
    sounds.coin();
    const newItem: ItemRecord = {
      id: String(Date.now()),
      title: newItemTitle.trim(),
      category: activeCategory === "All" ? "Core" : activeCategory,
      status: "active",
      value: Math.floor(Math.random() * 8000) + 2000,
      updatedAt: new Date().toISOString().split("T")[0]
    };
    setState(prev => ({ ...prev, items: [newItem, ...prev.items] }));
    setNewItemTitle("");
  };

  const handleDelete = (id: string) => {
    sounds.hit();
    setState(prev => ({ ...prev, items: prev.items.filter(i => i.id !== id) }));
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">
          <span className="brand-icon">❖</span>
          <h2>${blueprint.title}</h2>
        </div>
        <nav className="nav-menu">
          <button className={state.activeScreen === "overview" ? "nav-item active" : "nav-item"} onClick={() => { sounds.click(); setState(p => ({ ...p, activeScreen: "overview" })); }}>
            📊 Overview
          </button>
          <button className={state.activeScreen === "items" ? "nav-item active" : "nav-item"} onClick={() => { sounds.click(); setState(p => ({ ...p, activeScreen: "items" })); }}>
            📦 Records
          </button>
          <button className={state.activeScreen === "3d" ? "nav-item active" : "nav-item"} onClick={() => { sounds.click(); setState(p => ({ ...p, activeScreen: "3d" })); }}>
            🧊 3D Visualizer
          </button>
        </nav>
      </aside>

      <main className="app-content">
        <header className="content-header">
          <div>
            <h1>Dashboard</h1>
            <p className="subtitle">${blueprint.tagline}</p>
          </div>
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search records..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </header>

        {state.activeScreen === "overview" && (
          <div className="dashboard-grid">
            <div className="kpi-card">
              <span className="kpi-label">TOTAL RECORDS</span>
              <span className="kpi-val">{metrics.totalCount}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">ACTIVE MODULES</span>
              <span className="kpi-val text-green">{metrics.activeCount}</span>
            </div>
            <div className="kpi-card">
              <span className="kpi-label">AGGREGATE VALUE</span>
              <span className="kpi-val text-primary">\${metrics.totalValue.toLocaleString()}</span>
            </div>
          </div>
        )}

        <div className="table-card">
          <div className="table-actions">
            <form onSubmit={handleAddItem} className="add-form">
              <input
                type="text"
                placeholder="New record name..."
                value={newItemTitle}
                onChange={e => setNewItemTitle(e.target.value)}
              />
              <button type="submit" className="primary-btn">Add Record</button>
            </form>
            <div className="filter-chips">
              {["All", "Core", "Graphics", "Networking", "Audio"].map(cat => (
                <button
                  key={cat}
                  className={activeCategory === cat ? "chip active" : "chip"}
                  onClick={() => { sounds.click(); setActiveCategory(cat); }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Status</th>
                <th>Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => (
                <tr key={item.id}>
                  <td><strong>{item.title}</strong></td>
                  <td><span className="badge">{item.category}</span></td>
                  <td><span className={\`status-dot \${item.status}\`} /> {item.status}</td>
                  <td>\${item.value.toLocaleString()}</td>
                  <td>
                    <button className="delete-btn" onClick={() => handleDelete(item.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
`,
        "src/styles.css": `:root {
  --bg-dark: #0B0F19;
  --surface: #1E293B;
  --surface-alt: #111827;
  --primary: #6366F1;
  --primary-glow: rgba(99, 102, 241, 0.4);
  --text: #F8FAFC;
  --muted: #94A3B8;
  --border: rgba(255, 255, 255, 0.08);
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg-dark);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  height: 100vh;
}

.app-shell {
  display: flex;
  height: 100vh;
}

.app-sidebar {
  width: 260px;
  background: var(--surface-alt);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 2rem;
}

.brand-icon {
  font-size: 1.5rem;
  color: var(--primary);
}

.brand h2 {
  font-size: 1.1rem;
  font-weight: 700;
}

.nav-menu {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 0.75rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  text-align: left;
  transition: all 0.2s;
}

.nav-item:hover, .nav-item.active {
  background: rgba(99, 102, 241, 0.15);
  color: var(--text);
}

.nav-item.active {
  border-left: 3px solid var(--primary);
}

.app-content {
  flex: 1;
  padding: 2rem;
  overflow-y: auto;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.subtitle {
  color: var(--muted);
  font-size: 0.9rem;
  margin-top: 4px;
}

.search-bar input {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 0.6rem 1.25rem;
  border-radius: 8px;
  width: 280px;
  outline: none;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1.25rem;
  margin-bottom: 2rem;
}

.kpi-card {
  background: var(--surface);
  border: 1px solid var(--border);
  padding: 1.5rem;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.kpi-label {
  font-size: 0.75rem;
  color: var(--muted);
  letter-spacing: 0.05em;
  font-weight: 600;
}

.kpi-val {
  font-size: 1.8rem;
  font-weight: 700;
}

.text-green { color: #10B981; }
.text-primary { color: var(--primary); }

.table-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.5rem;
}

.table-actions {
  display: flex;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
  gap: 1rem;
}

.add-form {
  display: flex;
  gap: 0.75rem;
}

.add-form input {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 0.5rem 1rem;
  border-radius: 6px;
  outline: none;
}

.primary-btn {
  background: var(--primary);
  color: #fff;
  border: none;
  padding: 0.5rem 1.25rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.filter-chips {
  display: flex;
  gap: 0.5rem;
}

.chip {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}

.chip.active {
  background: rgba(99, 102, 241, 0.2);
  color: var(--primary);
  border-color: var(--primary);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th, .data-table td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid var(--border);
}

.data-table th {
  color: var(--muted);
  font-size: 0.8rem;
  text-transform: uppercase;
}

.badge {
  background: rgba(255, 255, 255, 0.08);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}

.status-dot.active { background: #10B981; }
.status-dot.pending { background: #F59E0B; }
.status-dot.completed { background: #6366F1; }

.delete-btn {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #EF4444;
  padding: 0.3rem 0.7rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.8rem;
}
`
    };
  }
}
