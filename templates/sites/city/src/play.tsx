/**
 * The playable board: the city drawn from above with a camera that follows
 * the player, the frame loop, and touch, mouse and keyboard controls around
 * the engine in ./game. It needs nothing but React and the engine, so an app
 * built on the engine gets an open-world game that actually plays by
 * rendering one component: <GameBoard settings={DEFAULT_SETTINGS} />.
 *
 * Pictures: when public/assets/manifest.json names "car", "police", "player"
 * or "person", those are drawn; otherwise shapes.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { type GameSettings, type GameState, type Input, action, newGame, playerAt, setInput, step, togglePause } from "./game";

type Pictures = Record<string, HTMLImageElement>;

/** The pictures the game's art manifest names, once each has loaded. */
function usePictures(): Pictures {
  const [pictures, setPictures] = useState<Pictures>({});
  useEffect(() => {
    let alive = true;
    fetch("assets/manifest.json")
      .then((res) => (res.ok ? res.json() : null))
      .then((manifest: { assets?: Record<string, { file: string }> } | null) => {
        for (const [name, entry] of Object.entries(manifest?.assets ?? {})) {
          const image = new Image();
          image.onload = () => alive && setPictures((all) => ({ ...all, [name]: image }));
          image.src = entry.file;
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return pictures;
}

const TILE = 28;
const VIEW_W = 22;
const VIEW_H = 15;

function sprite(ctx: CanvasRenderingContext2D, picture: HTMLImageElement | undefined, x: number, y: number, angle: number, w: number, h: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  if (picture) ctx.drawImage(picture, -w / 2, -h / 2, w, h);
  else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(w / 2 - 7, -h / 2 + 3, 4, h - 6);
  }
  ctx.restore();
}

/** The city around the player, drawn every frame. */
function draw(ctx: CanvasRenderingContext2D, state: GameState, pictures: Pictures, now: number) {
  const me = playerAt(state);
  const camX = me.x - VIEW_W / 2;
  const camY = me.y - VIEW_H / 2;
  const { colors } = state.settings;
  const sx = (x: number) => (x - camX) * TILE;
  const sy = (y: number) => (y - camY) * TILE;
  ctx.fillStyle = colors.water;
  ctx.fillRect(0, 0, VIEW_W * TILE, VIEW_H * TILE);
  for (let ty = Math.floor(camY); ty < camY + VIEW_H + 1; ty++) {
    for (let tx = Math.floor(camX); tx < camX + VIEW_W + 1; tx++) {
      const tile = state.map[ty]?.[tx];
      if (!tile) continue;
      ctx.fillStyle = colors[tile];
      ctx.fillRect(sx(tx), sy(ty), TILE + 1, TILE + 1);
      if (tile === "building") {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(sx(tx) + 3, sy(ty) + 3, TILE - 6, TILE - 6);
      }
    }
  }

  // The job: a pulsing marker where to go next.
  const mission = state.mission;
  if (mission) {
    const [mx, my] = mission.carrying ? mission.dropoff : mission.pickup;
    const pulse = 0.7 + 0.3 * Math.sin(now / 200);
    ctx.fillStyle = mission.carrying ? `rgba(250,204,21,${pulse})` : `rgba(74,222,128,${pulse})`;
    ctx.beginPath();
    ctx.arc(sx(mx), sy(my), TILE * 0.7, 0, Math.PI * 2);
    ctx.fill();
    // Off screen: an arrow at the edge pointing to it.
    const dx = mx - me.x;
    const dy = my - me.y;
    if (Math.abs(dx) > VIEW_W / 2 - 1 || Math.abs(dy) > VIEW_H / 2 - 1) {
      const angle = Math.atan2(dy, dx);
      const ax = VIEW_W * TILE / 2 + Math.cos(angle) * (VIEW_W * TILE / 2 - 24);
      const ay = VIEW_H * TILE / 2 + Math.sin(angle) * (VIEW_H * TILE / 2 - 24);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      ctx.fillStyle = mission.carrying ? "#facc15" : "#4ade80";
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(-8, -9);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  for (const person of state.people) {
    if (Math.abs(person.x - me.x) > VIEW_W || Math.abs(person.y - me.y) > VIEW_H) continue;
    if (pictures.person) ctx.drawImage(pictures.person, sx(person.x) - 8, sy(person.y) - 8, 16, 16);
    else {
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.arc(sx(person.x), sy(person.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const car of state.cars) {
    if (Math.abs(car.x - me.x) > VIEW_W || Math.abs(car.y - me.y) > VIEW_H) continue;
    const picture = car.kind === "police" ? pictures.police : car.id === state.player.inCar ? pictures.player ?? pictures.car : pictures.car;
    sprite(ctx, picture, sx(car.x), sy(car.y), car.angle, TILE * 1.3, TILE * 0.7, car.damage >= 100 ? "#3f3f46" : car.color);
    if (car.kind === "police" && car.damage < 100) {
      ctx.fillStyle = Math.floor(now / 250) % 2 ? "#ef4444" : "#3b82f6";
      ctx.fillRect(sx(car.x) - 3, sy(car.y) - 3, 6, 6);
    }
  }

  if (state.player.inCar === null) {
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(sx(state.player.x), sy(state.player.y), 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(sx(state.player.x), sy(state.player.y));
    ctx.lineTo(sx(state.player.x) + Math.cos(state.player.angle) * 10, sy(state.player.y) + Math.sin(state.player.angle) * 10);
    ctx.stroke();
  }

  // A small map in the corner: the whole city, the player and the job.
  const mini = 90;
  const scale = mini / state.settings.size;
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(VIEW_W * TILE - mini - 8, 8, mini, mini);
  for (let ty = 0; ty < state.settings.size; ty += 1) {
    for (let tx = 0; tx < state.settings.size; tx += 1) {
      if (state.map[ty][tx] !== "road") continue;
      ctx.fillStyle = "#4b5563";
      ctx.fillRect(VIEW_W * TILE - mini - 8 + tx * scale, 8 + ty * scale, Math.max(1, scale), Math.max(1, scale));
    }
  }
  if (mission) {
    const [mx, my] = mission.carrying ? mission.dropoff : mission.pickup;
    ctx.fillStyle = mission.carrying ? "#facc15" : "#4ade80";
    ctx.fillRect(VIEW_W * TILE - mini - 8 + mx * scale - 2, 8 + my * scale - 2, 4, 4);
  }
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(VIEW_W * TILE - mini - 8 + me.x * scale - 2, 8 + me.y * scale - 2, 4, 4);
  ctx.globalAlpha = 1;
}

const MESSAGES: Partial<Record<GameState["status"], string>> = {
  paused: "Paused — tap or press P to carry on",
  busted: "BUSTED",
  wasted: "WASTED"
};

const KEYS: Record<string, keyof Input> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right"
};

export interface GameBoardProps {
  /** The city, cars and missions, e.g. DEFAULT_SETTINGS from ./game. */
  settings: GameSettings;
  /** Colour of buttons and highlights. */
  accent?: string;
  /** Called with the score after each delivery, and when busted or wasted. */
  onScore?: (score: number) => void;
  /** Called whenever cash, the wanted level, the job or the status change. */
  onChange?: (state: GameState) => void;
}

export function GameBoard({ settings, accent = "#38bdf8", onScore, onChange }: GameBoardProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [initial] = useState(() => newGame(settings));
  const game = useRef<GameState>(initial);
  const pictures = usePictures();
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;
  const [, setTick] = useState(0);

  const sync = useCallback(() => {
    setTick((t) => t + 1);
    onChange?.(game.current);
  }, [onChange]);

  useEffect(() => {
    if (game.current.settings !== settings) game.current = newGame(settings);
    let frame = 0;
    let last = performance.now();
    let sinceHud = 0;
    const loop = (now: number) => {
      const state = game.current;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const events = step(state, dt);
      const ctx = canvas.current?.getContext("2d");
      if (ctx) draw(ctx, state, picturesRef.current, now);
      sinceHud += dt;
      if (events.length > 0 || sinceHud > 0.25) {
        sinceHud = 0;
        sync();
      }
      if (events.some((e) => e === "delivered" || e === "busted" || e === "wasted")) onScore?.(state.score);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [onScore, settings, sync]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = KEYS[event.key] ?? KEYS[event.key.toLowerCase()];
      if (key) {
        event.preventDefault();
        setInput(game.current, { [key]: true });
      } else if (event.key.toLowerCase() === "e" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action(game.current);
        sync();
      } else if (event.key.toLowerCase() === "p") {
        togglePause(game.current);
        sync();
      }
    };
    const up = (event: KeyboardEvent) => {
      const key = KEYS[event.key] ?? KEYS[event.key.toLowerCase()];
      if (key) setInput(game.current, { [key]: false });
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [sync]);

  const state = game.current;
  const mission = state.mission;
  const message = MESSAGES[state.status];
  const hold = (key: keyof Input) => ({
    onPointerDown: (event: React.PointerEvent) => {
      event.preventDefault();
      setInput(game.current, { [key]: true });
    },
    onPointerUp: () => setInput(game.current, { [key]: false }),
    onPointerLeave: () => setInput(game.current, { [key]: false })
  });
  return (
    <section className="arcade" aria-label="Game Board" data-testid="game-board" style={{ display: "grid", gap: 12, width: "100%", maxWidth: VIEW_W * TILE, margin: "0 auto" }}>
      <div className="hud" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span>
          💵 <b>{state.cash.toLocaleString()}</b>
        </span>
        <span aria-label={`Wanted level ${state.wanted}`} style={{ color: "#facc15" }}>
          {"★".repeat(state.wanted)}
          <span style={{ opacity: 0.3 }}>{"★".repeat(5 - state.wanted)}</span>
        </span>
        <span>❤️ {Math.max(0, Math.round(state.player.hp))}</span>
        <span>
          {mission ? (mission.carrying ? `📦 Deliver: ${Math.ceil(mission.timeLeft)}s · ${mission.pay}` : "📦 Collect the package (green)") : ""}
        </span>
      </div>
      <div className="board" style={{ position: "relative" }}>
        <canvas ref={canvas} width={VIEW_W * TILE} height={VIEW_H * TILE} aria-label="Game board" role="img" style={{ width: "100%", height: "auto", display: "block", touchAction: "none", borderRadius: 12 }} />
        {message ? (
          <button
            className="board-message"
            onClick={() => {
              togglePause(game.current);
              sync();
            }}
            style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 6, background: "rgba(0,0,0,0.5)", color: state.status === "paused" ? "#fff" : "#ef4444", border: 0, borderRadius: 12, cursor: "pointer", font: "inherit", fontSize: state.status === "paused" ? "1rem" : "2.4rem", fontWeight: 800 }}
          >
            {message}
          </button>
        ) : null}
      </div>
      <div className="btn-row game-controls" style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 52px)", gap: 6 }}>
          <span />
          <button className="btn btn-ghost" aria-label="Up / accelerate" {...hold("up")}>▲</button>
          <span />
          <button className="btn btn-ghost" aria-label="Left / steer left" {...hold("left")}>◀</button>
          <button className="btn btn-ghost" aria-label="Down / brake" {...hold("down")}>▼</button>
          <button className="btn btn-ghost" aria-label="Right / steer right" {...hold("right")}>▶</button>
        </div>
        <button
          className="btn btn-primary"
          style={{ minWidth: 120, minHeight: 52, background: accent }}
          onClick={() => {
            action(game.current);
            sync();
          }}
        >
          {state.player.inCar === null ? "🚗 Enter car (E)" : "🚶 Get out (E)"}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            togglePause(game.current);
            sync();
          }}
        >
          {state.status === "paused" ? "Resume" : "Pause"}
        </button>
      </div>
      <p className="muted small" style={{ textAlign: "center", margin: 0 }}>
        Arrows or WASD to walk and drive · E to get in or out of a car · follow the arrow to the job · don't get caught
      </p>
    </section>
  );
}
