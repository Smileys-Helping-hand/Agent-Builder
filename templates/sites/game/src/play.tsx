/**
 * The playable board: canvas drawing, the frame loop, and touch, mouse and
 * keyboard controls around the engine in ./game. It needs nothing but React
 * and the engine, so an app built on the engine gets a game that actually
 * plays by rendering one component: <GameBoard settings={DEFAULT_SETTINGS} />.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type GameSettings, type GameState, launch, movePaddle, newGame, startLevel, step } from "./game";

/** The board, drawn from the game state every frame. */
function draw(ctx: CanvasRenderingContext2D, state: GameState, accent: string) {
  const { width, height, colors } = state.settings;
  ctx.clearRect(0, 0, width, height);

  for (const brick of state.bricks) {
    ctx.fillStyle = colors[brick.hits - 1];
    ctx.shadowColor = colors[brick.hits - 1];
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.roundRect(brick.x, brick.y, brick.w, brick.h, 5);
    ctx.fill();
  }

  ctx.shadowColor = accent;
  ctx.shadowBlur = 18;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(state.paddle.x, state.paddle.y, state.paddle.w, state.paddle.h, 7);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ffffff";
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, state.ball.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

const MESSAGES: Partial<Record<GameState["status"], string>> = {
  ready: "Tap or press Space to launch",
  paused: "Paused — tap or press P to carry on",
  "level-cleared": "Level cleared! Tap for the next one",
  won: "You cleared every level!",
  lost: "Game over"
};

export interface GameBoardProps {
  /** The game's rules and levels, e.g. DEFAULT_SETTINGS from ./game. */
  settings: GameSettings;
  /** Paddle colour. */
  accent?: string;
  /** Called with the final score when a game is won or lost. */
  onScore?: (score: number) => void;
  /** Called whenever the score, lives, level or status change. */
  onChange?: (state: GameState) => void;
}

export function GameBoard({ settings, accent = "#f59e0b", onScore, onChange }: GameBoardProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<GameState | null>(null);
  const [hud, setHud] = useState({ score: 0, lives: settings.lives, level: 0, status: "ready" as GameState["status"] });

  const sync = useCallback(() => {
    const state = game.current;
    if (!state) return;
    setHud({ score: state.score, lives: state.lives, level: state.level, status: state.status });
    onChange?.(state);
  }, [onChange]);

  // One action for tap, click and Space: whatever moves the game on from here.
  const advance = useCallback(() => {
    const state = game.current;
    if (!state) return;
    if (state.status === "ready") launch(state);
    else if (state.status === "playing") state.status = "paused";
    else if (state.status === "paused") state.status = "playing";
    else if (state.status === "level-cleared") startLevel(state, state.level + 1);
    else if (state.status === "won" || state.status === "lost") game.current = newGame(settings);
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
      const events = step(state, (now - last) / 1000);
      last = now;
      draw(ctx, state, accent);
      if (events.length) {
        sync();
        if (events.includes("won") || events.includes("lost")) onScore?.(state.score);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const keys = (event: KeyboardEvent) => {
      const state = game.current;
      if (!state) return;
      if (event.key === " " || event.key.toLowerCase() === "p") {
        event.preventDefault();
        advance();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const shift = event.key === "ArrowLeft" ? -42 : 42;
        movePaddle(state, state.paddle.x + state.paddle.w / 2 + shift);
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keys);
    };
  }, [accent, advance, onScore, settings, sync]);

  /** Pointer position on the board, in the board's own pixels whatever size it is shown at. */
  const follow = (clientX: number) => {
    const el = canvas.current;
    const state = game.current;
    if (!el || !state) return;
    const box = el.getBoundingClientRect();
    movePaddle(state, ((clientX - box.left) / box.width) * state.settings.width);
  };

  const message = MESSAGES[hud.status];
  // Inline layout, so the board works in any app, styled or not.
  return (
    <div className="arcade" style={{ display: "grid", gap: 12, width: "100%", maxWidth: settings.width, margin: "0 auto" }}>
      <div className="hud" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>
          Score <b>{hud.score.toLocaleString()}</b>
        </span>
        <span>
          Level <b>{hud.level + 1}</b> · {settings.levels[hud.level]?.name}
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
          }}
          aria-label="Game board"
          role="img"
          style={{ width: "100%", height: "auto", display: "block", touchAction: "none", background: "#0b1020", borderRadius: 12 }}
        />
        {message ? (
          <button
            className="board-message"
            onClick={advance}
            style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 6, background: "rgba(0,0,0,0.35)", color: "#fff", border: 0, borderRadius: 12, cursor: "pointer", font: "inherit" }}
          >
            <strong>{message}</strong>
            {hud.status === "won" || hud.status === "lost" ? <span>Final score {hud.score.toLocaleString()} · tap to play again</span> : null}
          </button>
        ) : null}
      </div>
      <div className="btn-row game-controls">
        <button className="btn btn-ghost" onClick={advance}>
          {hud.status === "playing" ? "Pause" : hud.status === "paused" ? "Resume" : hud.status === "won" || hud.status === "lost" ? "Play again" : "Launch"}
        </button>
      </div>
    </div>
  );
}
