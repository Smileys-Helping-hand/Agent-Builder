/**
 * The playable board: the dungeon drawn on a canvas, the hero's stats, a
 * battle panel, and touch, mouse and keyboard controls around the engine in
 * ./game. It needs nothing but React and the engine, so an app built on the
 * engine gets an RPG that actually plays by rendering one component:
 * <GameBoard settings={DEFAULT_SETTINGS} />.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type GameEvent, type GameSettings, type GameState, attack, flee, move, newGame, usePotion, xpToNext } from "./game";

const TILE = 40;

/** The floor, drawn from the game state. */
function draw(ctx: CanvasRenderingContext2D, state: GameState) {
  const { colors, monsters } = state.settings;
  const rows = state.map.length;
  const columns = state.map[0]?.length ?? 0;
  ctx.clearRect(0, 0, columns * TILE, rows * TILE);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const tile = state.map[y][x];
      ctx.fillStyle = tile === "#" ? colors.wall : colors.floor;
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (tile === "#") {
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, TILE - 1, TILE - 1);
        continue;
      }
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      const monster = monsters[tile];
      if (monster) {
        ctx.fillStyle = monster.color;
        ctx.beginPath();
        ctx.arc(cx, cy, monster.boss ? TILE * 0.46 : TILE * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#111";
        ctx.font = `bold ${monster.boss ? 18 : 15}px system-ui`;
        ctx.fillText(monster.name[0], cx, cy + 1);
      } else if (tile === ">") {
        ctx.fillStyle = colors.stairs;
        for (let i = 0; i < 3; i++) ctx.fillRect(x * TILE + 8 + i * 8, y * TILE + 26 - i * 8, 24 - i * 8, 6);
      } else if (tile === "p") {
        ctx.fillStyle = "#f472b6";
        ctx.beginPath();
        ctx.arc(cx, cy + 3, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx - 3, cy - 10, 6, 7);
      } else if (tile === "$") {
        ctx.fillStyle = colors.item;
        ctx.fillRect(cx - 11, cy - 7, 22, 15);
        ctx.fillStyle = "#78350f";
        ctx.fillRect(cx - 11, cy - 2, 22, 3);
      }
    }
  }
  const { hero } = state;
  ctx.fillStyle = colors.hero;
  ctx.shadowColor = colors.hero;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(hero.x * TILE + TILE / 2, hero.y * TILE + TILE / 2, TILE * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#082f49";
  ctx.font = "bold 15px system-ui";
  ctx.fillText(hero.name[0] ?? "H", hero.x * TILE + TILE / 2, hero.y * TILE + TILE / 2 + 1);
}

export interface GameBoardProps {
  /** The hero, monsters and floors, e.g. DEFAULT_SETTINGS from ./game. */
  settings: GameSettings;
  /** Colour of the buttons and bars. */
  accent?: string;
  /** Called with the final score when the game is won or lost. */
  onScore?: (score: number) => void;
  /** Called after every action. */
  onChange?: (state: GameState) => void;
}

const bar = (value: number, max: number, color: string) => (
  <span style={{ display: "inline-block", width: 90, height: 8, background: "#0006", borderRadius: 4, overflow: "hidden", verticalAlign: "middle", marginLeft: 6 }}>
    <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(1, value / max)) * 100}%`, background: color }} />
  </span>
);

export function GameBoard({ settings, accent = "#f59e0b", onScore, onChange }: GameBoardProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [first] = useState(() => newGame(settings));
  const game = useRef<GameState>(first);
  // Every action makes a new view of the state: React redraws from it.
  const [, setTurn] = useState(0);

  const act = useCallback(
    (action: (state: GameState) => GameEvent[]) => {
      const state = game.current;
      const events = action(state);
      setTurn((turn) => turn + 1);
      onChange?.(state);
      if (events.includes("won") || events.includes("lost")) onScore?.(state.score);
    },
    [onChange, onScore]
  );

  const restart = useCallback(() => {
    game.current = newGame(settings);
    setTurn((turn) => turn + 1);
  }, [settings]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const k = event.key.toLowerCase();
      const state = game.current;
      const moves: Record<string, [number, number]> = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
      if (state.status === "exploring" && moves[k]) act((s) => move(s, ...moves[k]));
      else if (state.status === "battle" && (k === "1" || k === "enter")) act(attack);
      else if (k === "2" || k === "h") act(usePotion);
      else if (state.status === "battle" && k === "3") act(flee);
      else if ((state.status === "won" || state.status === "lost") && k === " ") restart();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [act, restart]);

  const state = game.current;
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) draw(ctx, state);
  });

  const { hero, battle } = state;
  const columns = state.map[0]?.length ?? 15;
  const rows = state.map.length;
  const pad = (label: string, dx: number, dy: number) => (
    <button className="btn btn-ghost" aria-label={label} onClick={() => act((s) => move(s, dx, dy))} disabled={state.status !== "exploring"} style={{ minWidth: 48 }}>
      {label}
    </button>
  );
  return (
    <div className="arcade" style={{ display: "grid", gap: 12, width: "100%", maxWidth: columns * TILE, margin: "0 auto" }}>
      <div className="hud" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          {hero.name} · Lv <b>{hero.level}</b>
        </span>
        <span>
          HP <b>{hero.hp}</b>/{hero.maxHp}
          {bar(hero.hp, hero.maxHp, "#4ade80")}
        </span>
        <span>
          XP {hero.xp}/{xpToNext(state)}
        </span>
        <span>
          Potions <b>{hero.potions}</b> · Gold <b>{hero.gold}</b>
        </span>
        <span>{settings.floors[state.floor]?.name}</span>
      </div>
      <div className="board" style={{ position: "relative" }}>
        <canvas ref={canvas} width={columns * TILE} height={rows * TILE} aria-label="Game board" role="img" style={{ width: "100%", height: "auto", display: "block", borderRadius: 12 }} />
        {battle ? (
          <div
            role="dialog"
            aria-label={`Battle with ${battle.name}`}
            style={{ position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", width: "min(92%, 420px)", display: "grid", gap: 8, padding: 14, background: "rgba(12,10,9,0.92)", color: "#fafaf9", borderRadius: 12, border: `1px solid ${accent}` }}
          >
            <strong>
              ⚔️ {battle.name}
              {bar(battle.hp, battle.maxHp, "#ef4444")} {battle.hp}/{battle.maxHp}
            </strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => act(attack)}>
                1. Attack
              </button>
              <button className="btn btn-ghost" onClick={() => act(usePotion)} disabled={hero.potions === 0}>
                2. Potion ({hero.potions})
              </button>
              <button className="btn btn-ghost" onClick={() => act(flee)}>
                3. Flee
              </button>
            </div>
          </div>
        ) : null}
        {state.status === "won" || state.status === "lost" ? (
          <button
            className="board-message"
            onClick={restart}
            style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 6, background: "rgba(0,0,0,0.55)", color: "#fff", border: 0, borderRadius: 12, cursor: "pointer", font: "inherit" }}
          >
            <strong>{state.status === "won" ? "Victory! The dragon is slain." : "You have fallen."}</strong>
            <span>Final score {state.score.toLocaleString()} · tap to play again</span>
          </button>
        ) : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 6, justifyContent: "center" }}>
        <span />
        {pad("↑", 0, -1)}
        <span />
        {pad("←", -1, 0)}
        <button className="btn btn-ghost" onClick={() => act(usePotion)} disabled={hero.potions === 0 || state.status !== "exploring" || hero.hp === hero.maxHp} aria-label="Drink a potion">
          🧪
        </button>
        {pad("→", 1, 0)}
        <span />
        {pad("↓", 0, 1)}
        <span />
      </div>
      <ol className="muted small" aria-label="Adventure log" style={{ margin: 0, paddingLeft: 18, minHeight: 90 }}>
        {state.log.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ol>
    </div>
  );
}
