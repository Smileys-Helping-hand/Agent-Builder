/**
 * The playable board: canvas drawing, the frame loop, and touch, mouse and
 * keyboard controls around the engine in ./game. It needs nothing but React
 * and the engine, so an app built on the engine gets a tower-defence game
 * that actually plays by rendering one component:
 * <GameBoard settings={DEFAULT_SETTINGS} />.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type GameSettings,
  type GameState,
  type TowerKind,
  canBuild,
  newGame,
  placeTower,
  positionAt,
  roadCells,
  sellTower,
  startWave,
  step,
  towerAt,
  towerStats,
  upgradeCost,
  upgradeTower
} from "./game";

const KINDS: TowerKind[] = ["archer", "cannon", "frost"];

/** The board, drawn from the game state every frame. */
function draw(ctx: CanvasRenderingContext2D, state: GameState, hover: [number, number] | null, selected: number | null, building: TowerKind) {
  const { columns, rows, cell, path, colors, towers } = state.settings;
  ctx.fillStyle = colors.grass;
  ctx.fillRect(0, 0, columns * cell, rows * cell);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let x = 0; x <= columns; x++) ctx.strokeRect(x * cell, 0, 0, rows * cell);
  for (let y = 0; y <= rows; y++) ctx.strokeRect(0, y * cell, columns * cell, 0);

  ctx.fillStyle = colors.road;
  for (const [x, y] of roadCells(path)) ctx.fillRect(x * cell + 2, y * cell + 2, cell - 4, cell - 4);

  // Where the next tower would go, and how far it would reach.
  if (hover && !towerAt(state, hover[0], hover[1])) {
    const ok = canBuild(state, hover[0], hover[1]) && state.gold >= towers[building].cost;
    ctx.fillStyle = ok ? "rgba(255,255,255,0.18)" : "rgba(239,68,68,0.3)";
    ctx.fillRect(hover[0] * cell, hover[1] * cell, cell, cell);
    if (ok) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc((hover[0] + 0.5) * cell, (hover[1] + 0.5) * cell, towers[building].range * cell, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  for (const tower of state.towers) {
    const spec = towers[tower.kind];
    const cx = (tower.column + 0.5) * cell;
    const cy = (tower.row + 0.5) * cell;
    if (tower.id === selected) {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.arc(cx, cy, towerStats(state, tower).range * cell, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#1f2937";
    ctx.fillRect(tower.column * cell + 5, tower.row * cell + 5, cell - 10, cell - 10);
    ctx.fillStyle = spec.color;
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.22 + tower.level * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("★".repeat(tower.level), cx, tower.row * cell + cell - 4);
  }

  for (const shot of state.shots) {
    ctx.strokeStyle = towers[shot.kind].color;
    ctx.lineWidth = shot.kind === "cannon" ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(shot.from[0] * cell, shot.from[1] * cell);
    ctx.lineTo(shot.to[0] * cell, shot.to[1] * cell);
    ctx.stroke();
  }
  ctx.lineWidth = 1;

  for (const creep of state.creeps) {
    const [x, y] = positionAt(path, creep.distance);
    ctx.fillStyle = creep.slowed > 0 ? "#93c5fd" : colors.creep;
    ctx.beginPath();
    ctx.arc(x * cell, y * cell, cell * 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000a";
    ctx.fillRect(x * cell - 14, y * cell - 20, 28, 4);
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(x * cell - 14, y * cell - 20, 28 * Math.max(creep.hp / creep.maxHp, 0), 4);
  }
}

const MESSAGES: Partial<Record<GameState["status"], string>> = {
  paused: "Paused — tap or press P to carry on",
  won: "You held the line! Every wave beaten.",
  lost: "The defences fell"
};

export interface GameBoardProps {
  /** The map, towers and waves, e.g. DEFAULT_SETTINGS from ./game. */
  settings: GameSettings;
  /** Colour of the selected tower and buttons. */
  accent?: string;
  /** Called with the final score when a game is won or lost. */
  onScore?: (score: number) => void;
  /** Called whenever gold, lives, the wave or the status change. */
  onChange?: (state: GameState) => void;
}

export function GameBoard({ settings, accent = "#22c55e", onScore, onChange }: GameBoardProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState | null>(null);
  const hover = useRef<[number, number] | null>(null);
  const [building, setBuilding] = useState<TowerKind>("archer");
  const [selected, setSelected] = useState<number | null>(null);
  const [hud, setHud] = useState({ gold: settings.startGold, lives: settings.lives, wave: 0, score: 0, status: "building" as GameState["status"] });

  const sync = useCallback(() => {
    const state = game.current;
    if (!state) return;
    setHud({ gold: state.gold, lives: state.lives, wave: state.wave, score: state.score, status: state.status });
    onChange?.(state);
  }, [onChange]);

  // Space / the main button: send the next wave, pause, carry on, or start again.
  const advance = useCallback(() => {
    const state = game.current;
    if (!state) return;
    if (state.status === "building" || state.status === "wave-cleared") startWave(state);
    else if (state.status === "playing") state.status = "paused";
    else if (state.status === "paused") state.status = "playing";
    else if (state.status === "won" || state.status === "lost") {
      game.current = newGame(settings);
      setSelected(null);
    }
    sync();
  }, [settings, sync]);

  useEffect(() => {
    game.current = newGame(settings);
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const state = game.current!;
      const events = step(state, Math.min((now - last) / 1000, 0.05));
      last = now;
      draw(ctx, state, hover.current, selectedRef.current, buildingRef.current);
      if (events.some((event) => event !== "shot")) {
        sync();
        if (events.includes("won") || events.includes("lost")) onScore?.(state.score);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [onScore, settings, sync]);

  // The loop reads these without restarting.
  const selectedRef = useRef(selected);
  const buildingRef = useRef(building);
  selectedRef.current = selected;
  buildingRef.current = building;

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === " " || event.key.toLowerCase() === "p") {
        event.preventDefault();
        advance();
      } else if (["1", "2", "3"].includes(event.key)) setBuilding(KINDS[Number(event.key) - 1]);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [advance]);

  /** The cell under the pointer. */
  const cellAt = (clientX: number, clientY: number): [number, number] | null => {
    const el = canvas.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return [Math.floor(((clientX - box.left) / box.width) * settings.columns), Math.floor(((clientY - box.top) / box.height) * settings.rows)];
  };

  const tap = (clientX: number, clientY: number) => {
    const state = game.current;
    const at = cellAt(clientX, clientY);
    if (!state || !at) return;
    const existing = towerAt(state, at[0], at[1]);
    if (existing) setSelected(existing.id === selected ? null : existing.id);
    else if (placeTower(state, building, at[0], at[1])) setSelected(null);
    sync();
  };

  const chosen = game.current?.towers.find((tower) => tower.id === selected) ?? null;
  const message = MESSAGES[hud.status];
  const nextWave = settings.waves[hud.wave];
  return (
    <section className="arcade" aria-label="Game Board" data-testid="game-board" style={{ display: "grid", gap: 12, width: "100%", maxWidth: settings.columns * settings.cell, margin: "0 auto" }}>
      <div className="hud" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          Gold <b>{hud.gold}</b>
        </span>
        <span>
          Wave <b>{Math.min(hud.wave + 1, settings.waves.length)}</b> of {settings.waves.length} · {nextWave?.name}
        </span>
        <span>
          Score <b>{hud.score.toLocaleString()}</b>
        </span>
        <span aria-label={`${hud.lives} lives left`}>♥ {hud.lives}</span>
      </div>
      <div className="board" style={{ position: "relative" }}>
        <canvas
          ref={canvas}
          width={settings.columns * settings.cell}
          height={settings.rows * settings.cell}
          onPointerMove={(event) => (hover.current = cellAt(event.clientX, event.clientY))}
          onPointerLeave={() => (hover.current = null)}
          onPointerDown={(event) => tap(event.clientX, event.clientY)}
          aria-label="Game board"
          role="img"
          style={{ width: "100%", height: "auto", display: "block", touchAction: "none", borderRadius: 12, cursor: "pointer" }}
        />
        {message ? (
          <button
            className="board-message"
            onClick={advance}
            style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 6, background: "rgba(0,0,0,0.45)", color: "#fff", border: 0, borderRadius: 12, cursor: "pointer", font: "inherit" }}
          >
            <strong>{message}</strong>
            {hud.status === "won" || hud.status === "lost" ? <span>Final score {hud.score.toLocaleString()} · tap to play again</span> : null}
          </button>
        ) : null}
      </div>
      <div className="btn-row game-controls" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {KINDS.map((kind, i) => {
          const spec = settings.towers[kind];
          return (
            <button
              key={kind}
              className={kind === building ? "btn btn-primary" : "btn btn-ghost"}
              aria-pressed={kind === building}
              onClick={() => setBuilding(kind)}
              style={kind === building ? { outline: `2px solid ${accent}` } : undefined}
            >
              {i + 1}. {spec.name} · {spec.cost}g
            </button>
          );
        })}
        <button className="btn btn-primary" onClick={advance}>
          {hud.status === "building" || hud.status === "wave-cleared" ? `Send wave ${hud.wave + 1}` : hud.status === "playing" ? "Pause" : hud.status === "paused" ? "Resume" : "Play again"}
        </button>
      </div>
      {chosen && game.current ? (
        <div className="btn-row" style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
          <span>
            {settings.towers[chosen.kind].name} · level {chosen.level}
          </span>
          <button
            className="btn btn-ghost"
            disabled={chosen.level >= 3 || hud.gold < upgradeCost(game.current, chosen)}
            onClick={() => {
              upgradeTower(game.current!, chosen.id);
              sync();
            }}
          >
            {chosen.level >= 3 ? "Fully upgraded" : `Upgrade · ${upgradeCost(game.current, chosen)}g`}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              sellTower(game.current!, chosen.id);
              setSelected(null);
              sync();
            }}
          >
            Sell · {Math.floor(settings.towers[chosen.kind].cost / 2)}g
          </button>
        </div>
      ) : (
        <p className="muted small" style={{ textAlign: "center", margin: 0 }}>
          Tap open ground to build · tap a tower to upgrade or sell · Space sends the next wave
        </p>
      )}
    </section>
  );
}
