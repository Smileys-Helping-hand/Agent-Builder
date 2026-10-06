/**
 * The playable board: canvas drawing, the frame loop, and touch, mouse and
 * keyboard controls around the engine in ./game. It needs nothing but React
 * and the engine, so an app built on the engine gets a shooter that actually
 * plays by rendering one component: <GameBoard settings={DEFAULT_SETTINGS} />.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type GameSettings, type GameState, launch, moveShip, newGame, setInput, startWave, step } from "./game";

/** The board, drawn from the game state every frame. */
function draw(ctx: CanvasRenderingContext2D, state: GameState, accent: string, time: number) {
  const { width, height, colors } = state.settings;
  ctx.clearRect(0, 0, width, height);

  // Stars drifting down, for a sense of speed.
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (let i = 0; i < 60; i++) {
    const x = (i * 97) % width;
    const y = (i * 53 + time * (20 + (i % 5) * 12)) % height;
    ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }

  for (const enemy of state.enemies) {
    const color = colors[enemy.kind];
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(enemy.x, enemy.y, enemy.w, enemy.h, enemy.kind === "tank" ? 4 : 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#05030d";
    ctx.fillRect(enemy.x + 9, enemy.y + 8, 5, 5);
    ctx.fillRect(enemy.x + enemy.w - 14, enemy.y + 8, 5, 5);
    if (enemy.kind === "tank" && enemy.hp > 1) {
      ctx.strokeStyle = "#fff7";
      ctx.strokeRect(enemy.x + 2, enemy.y + 2, enemy.w - 4, enemy.h - 4);
    }
  }

  for (const bullet of state.bullets) {
    ctx.fillStyle = bullet.from === "ship" ? colors.bullet : colors.enemyBullet;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 8;
    ctx.fillRect(bullet.x - 2, bullet.y - 6, 4, 12);
  }
  ctx.shadowBlur = 0;

  for (const power of state.powerUps) {
    ctx.fillStyle = colors.power;
    ctx.beginPath();
    ctx.arc(power.x, power.y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#05030d";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(power.kind === "rapid" ? "R" : power.kind === "shield" ? "S" : "+", power.x, power.y + 4);
  }

  const { ship } = state;
  const blink = ship.invulnerable > 0 && Math.floor(time * 10) % 2 === 0;
  if (!blink) {
    ctx.fillStyle = colors.ship;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(ship.x + ship.w / 2, ship.y);
    ctx.lineTo(ship.x + ship.w, ship.y + ship.h);
    ctx.lineTo(ship.x, ship.y + ship.h);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  if (ship.shield > 0) {
    ctx.strokeStyle = colors.power;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ship.x + ship.w / 2, ship.y + ship.h / 2, ship.w * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const MESSAGES: Partial<Record<GameState["status"], string>> = {
  ready: "Tap or press Space to start",
  paused: "Paused — tap or press P to carry on",
  "wave-cleared": "Wave cleared! Tap for the next one",
  won: "Every wave beaten!",
  lost: "Game over"
};

export interface GameBoardProps {
  /** The game's rules and waves, e.g. DEFAULT_SETTINGS from ./game. */
  settings: GameSettings;
  /** Glow around the ship. */
  accent?: string;
  /** Called with the final score when a game is won or lost. */
  onScore?: (score: number) => void;
  /** Called whenever the score, lives, wave or status change. */
  onChange?: (state: GameState) => void;
}

export function GameBoard({ settings, accent = "#22d3ee", onScore, onChange }: GameBoardProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState | null>(null);
  const [hud, setHud] = useState({ score: 0, lives: settings.lives, wave: 0, status: "ready" as GameState["status"] });

  const sync = useCallback(() => {
    const state = game.current;
    if (!state) return;
    setHud({ score: state.score, lives: state.lives, wave: state.wave, status: state.status });
    onChange?.(state);
  }, [onChange]);

  // One action for tap, click and Space: whatever moves the game on from here.
  const advance = useCallback(() => {
    const state = game.current;
    if (!state) return;
    if (state.status === "ready" || state.status === "paused") launch(state);
    else if (state.status === "playing") state.status = "paused";
    else if (state.status === "wave-cleared") {
      startWave(state, state.wave + 1);
      launch(state);
    } else if (state.status === "won" || state.status === "lost") game.current = newGame(settings);
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
      draw(ctx, state, accent, now / 1000);
      if (events.some((event) => event !== "shot")) {
        sync();
        if (events.includes("won") || events.includes("lost")) onScore?.(state.score);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const key = (down: boolean) => (event: KeyboardEvent) => {
      const state = game.current;
      if (!state) return;
      const k = event.key.toLowerCase();
      if (k === "arrowleft" || k === "a") setInput(state, { left: down });
      else if (k === "arrowright" || k === "d") setInput(state, { right: down });
      else if (k === " ") {
        event.preventDefault();
        if (down && state.status !== "playing") advance();
        else setInput(state, { fire: down });
        return;
      } else if (k === "p" && down) advance();
      else return;
      event.preventDefault();
    };
    const keyDown = key(true);
    const keyUp = key(false);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [accent, advance, onScore, settings, sync]);

  /** Pointer position on the board, in the board's own pixels whatever size it is shown at. */
  const follow = (clientX: number) => {
    const el = canvas.current;
    const state = game.current;
    if (!el || !state) return;
    const box = el.getBoundingClientRect();
    moveShip(state, ((clientX - box.left) / box.width) * state.settings.width);
  };

  const message = MESSAGES[hud.status];
  // Inline layout, so the board works in any app, styled or not.
  return (
    <section className="arcade" aria-label="Game Board" data-testid="game-board" style={{ display: "grid", gap: 12, width: "100%", maxWidth: settings.width, margin: "0 auto" }}>
      <div className="hud" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          Score <b>{hud.score.toLocaleString()}</b>
        </span>
        <span>
          Wave <b>{hud.wave + 1}</b> · {settings.waves[hud.wave]?.name}
        </span>
        <span aria-label={`${hud.lives} lives left`}>{"♥".repeat(Math.max(hud.lives, 0)) || "—"}</span>
      </div>
      <div className="board" style={{ position: "relative" }}>
        <canvas
          ref={canvas}
          width={settings.width}
          height={settings.height}
          onPointerMove={(event) => follow(event.clientX)}
          onPointerDown={(event) => {
            follow(event.clientX);
            if (hud.status !== "playing") advance();
            else if (game.current) setInput(game.current, { fire: true });
          }}
          onPointerUp={() => game.current && setInput(game.current, { fire: false })}
          onPointerLeave={() => game.current && setInput(game.current, { fire: false })}
          aria-label="Game board"
          role="img"
          style={{ width: "100%", height: "auto", display: "block", touchAction: "none", background: "#05030d", borderRadius: 12 }}
        />
        {message ? (
          <button
            className="board-message"
            onClick={advance}
            style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 6, background: "rgba(0,0,0,0.4)", color: "#fff", border: 0, borderRadius: 12, cursor: "pointer", font: "inherit" }}
          >
            <strong>{message}</strong>
            {hud.status === "won" || hud.status === "lost" ? <span>Final score {hud.score.toLocaleString()} · tap to play again</span> : <span>← → or drag to move · hold Space or touch to fire</span>}
          </button>
        ) : null}
      </div>
      <div className="btn-row game-controls">
        <button className="btn btn-ghost" onClick={advance}>
          {hud.status === "playing" ? "Pause" : hud.status === "paused" ? "Resume" : hud.status === "won" || hud.status === "lost" ? "Play again" : "Start"}
        </button>
      </div>
    </section>
  );
}
