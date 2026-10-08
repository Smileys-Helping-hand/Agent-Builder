/**
 * The playable board: the village and the raids drawn on a canvas, the frame
 * loop, and touch, mouse and keyboard controls around the engine in ./game.
 * It needs nothing but React and the engine, so an app built on the engine
 * gets a base-building game that actually plays by rendering one component:
 * <GameBoard settings={DEFAULT_SETTINGS} />.
 *
 * Pictures: when public/assets/manifest.json names a picture for a building
 * or troop ("townhall", "barbarian", "ground"), it is drawn; otherwise a
 * coloured block with an emoji. The village is saved in the browser and keeps
 * producing while the player is away, as a base builder should.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type BuildingKind,
  type GameSettings,
  type GameState,
  type TroopKind,
  build,
  collect,
  collectAll,
  fitToSettings,
  freeBuilders,
  housing,
  newGame,
  placeTroop,
  returnHome,
  startRaid,
  step,
  storage,
  train,
  upgrade,
  whyNotBuild,
  whyNotTrain,
  whyNotUpgrade
} from "./game";

const BUILDABLE: BuildingKind[] = ["goldmine", "collector", "cannon", "barracks", "camp", "wall"];
const EMOJI: Record<string, string> = {
  townhall: "🏰",
  goldmine: "⛏️",
  collector: "🧪",
  barracks: "⚔️",
  camp: "⛺",
  cannon: "💣",
  wall: "🧱",
  barbarian: "🪓",
  archer: "🏹",
  giant: "👊"
};

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

const SAVE_VERSION = 1;

/** The village as saved: everything but the settings and any raid in progress. */
const save = (key: string, state: GameState) => {
  if (state.status !== "village") return;
  try {
    const { settings: _settings, raid: _raid, ...rest } = state;
    localStorage.setItem(key, JSON.stringify({ version: SAVE_VERSION, at: Date.now(), state: rest }));
  } catch {
    // Storage blocked: the village lasts this visit.
  }
};

/** The saved village, caught up on what it made while the player was away (up to 8 hours). */
const load = (key: string, settings: GameSettings): GameState => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { version: number; at: number; state: Omit<GameState, "settings" | "raid"> } | null;
    if (saved?.version === SAVE_VERSION && saved.state) {
      const state = fitToSettings({ ...saved.state, settings, raid: null, status: "village" });
      let away = Math.min((Date.now() - saved.at) / 1000, 8 * 3600);
      while (away > 0) {
        const chunk = Math.min(away, 5);
        step(state, chunk);
        away -= chunk;
      }
      return state;
    }
  } catch {
    // Nothing saved, or a save from an older version: a new village.
  }
  return newGame(settings);
};

function block(ctx: CanvasRenderingContext2D, pictures: Pictures, name: string, color: string, x: number, y: number, size: number, faded = false) {
  ctx.globalAlpha = faded ? 0.5 : 1;
  const picture = pictures[name];
  if (picture) {
    ctx.drawImage(picture, x - size * 0.1, y - size * 0.25, size * 1.2, size * 1.2);
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x + 3, y + 3, size - 6, size - 6, 8);
    ctx.fill();
    ctx.font = `${Math.round(size * 0.5)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(EMOJI[name] ?? "■", x + size / 2, y + size / 2 + 1);
  }
  ctx.globalAlpha = 1;
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, share: number, color: string) {
  ctx.fillStyle = "#000a";
  ctx.fillRect(x, y, width, 5);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * Math.max(0, Math.min(1, share)), 5);
}

/** The board, drawn from the game state every frame. */
function draw(ctx: CanvasRenderingContext2D, state: GameState, pictures: Pictures, cell: number, selected: number | null, hover: [number, number] | null) {
  const { size } = state.settings;
  const width = size * cell;
  if (pictures.ground) ctx.drawImage(pictures.ground, 0, 0, width, width);
  else {
    ctx.fillStyle = state.status === "village" ? "#3f7d32" : "#5b4a2f";
    ctx.fillRect(0, 0, width, width);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i <= size; i++) {
      ctx.strokeRect(i * cell, 0, 0, width);
      ctx.strokeRect(0, i * cell, width, 0);
    }
  }
  if (hover) {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(hover[0] * cell, hover[1] * cell, cell, cell);
  }

  if (state.status === "village") {
    const sorted = [...state.buildings].sort((a, b) => a.y - b.y);
    for (const b of sorted) {
      const spec = state.settings.buildings[b.kind];
      const x = b.x * cell;
      const y = b.y * cell;
      if (b.id === selected) {
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
        ctx.lineWidth = 1;
      }
      block(ctx, pictures, b.kind, spec.color, x, y, cell, b.level === 0);
      if (b.upgrading !== null) {
        const total = spec.levels[b.level]?.seconds || spec.levels[0].seconds || 1;
        bar(ctx, x + 4, y + cell - 8, cell - 8, 1 - b.upgrading / total, "#38bdf8");
        ctx.font = "12px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("🔨", x + cell - 8, y + 10);
      } else if ((b.kind === "goldmine" || b.kind === "collector") && b.stored >= 10) {
        ctx.font = "14px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(b.kind === "goldmine" ? "💰" : "💧", x + cell - 8, y + 10);
      }
      if (b.level > 0) {
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px system-ui";
        ctx.textAlign = "left";
        ctx.fillText(String(b.level), x + 4, y + 12);
      }
    }
    return;
  }

  const raid = state.raid!;
  for (const b of [...raid.buildings].sort((a, c) => a.y - c.y)) {
    const x = b.x * cell;
    const y = b.y * cell;
    if (b.hp <= 0) {
      ctx.fillStyle = "#1c1917aa";
      ctx.fillRect(x + 8, y + 8, cell - 16, cell - 16);
      continue;
    }
    block(ctx, pictures, b.kind, state.settings.buildings[b.kind].color, x, y, cell);
    bar(ctx, x + 4, y - 2, cell - 8, b.hp / b.maxHp, "#4ade80");
  }
  for (const troop of raid.troops) {
    if (troop.hp <= 0) continue;
    const spec = state.settings.troops[troop.kind];
    const r = cell * (spec?.big ? 0.4 : 0.28);
    const cx = (troop.x + 0.5) * cell;
    const cy = (troop.y + 0.5) * cell;
    if (pictures[troop.kind]) ctx.drawImage(pictures[troop.kind], cx - r, cy - r, r * 2, r * 2);
    else {
      ctx.fillStyle = spec.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    bar(ctx, cx - 10, cy - r - 4, 20, troop.hp / spec.hp, "#f87171");
  }
}

export interface GameBoardProps {
  /** The village, buildings, troops and raids, e.g. DEFAULT_SETTINGS from ./game. */
  settings: GameSettings;
  /** Colour of the selected items and buttons. */
  accent?: string;
  /** Called with the score after each raid. */
  onScore?: (score: number) => void;
  /** Called whenever resources, buildings, the army or the status change. */
  onChange?: (state: GameState) => void;
  /** Where the village is saved in the browser. */
  saveKey?: string;
}

export function GameBoard({ settings, accent = "#facc15", onScore, onChange, saveKey = "village-save" }: GameBoardProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // The village is there from the first render: the controls never wait on a frame.
  const [initial] = useState(() => load(saveKey, settings));
  const game = useRef<GameState>(initial);
  const hover = useRef<[number, number] | null>(null);
  const pictures = usePictures();
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;
  const [placing, setPlacing] = useState<BuildingKind | null>(null);
  // Every troop the settings list, the app's own included.
  const troops: TroopKind[] = Object.keys(settings.troops);
  const [troop, setTroop] = useState<TroopKind>(troops[0] ?? "barbarian");
  const [selected, setSelected] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const cell = 40;

  const sync = useCallback(() => {
    const state = game.current;
    if (!state) return;
    setTick((t) => t + 1);
    onChange?.(state);
  }, [onChange]);

  useEffect(() => {
    if (game.current.settings !== settings) game.current = load(saveKey, settings);
    let frame = 0;
    let last = performance.now();
    let sinceHud = 0;
    let sinceSave = 0;
    const loop = (now: number) => {
      const state = game.current;
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const events = step(state, dt);
      // The canvas of this render: the first one (before the village loaded) is replaced.
      const ctx = canvas.current?.getContext("2d");
      if (ctx) draw(ctx, state, picturesRef.current, cell, selectedRef.current, hover.current);
      sinceHud += dt;
      sinceSave += dt;
      if (events.length > 0 || sinceHud > 0.5) {
        sinceHud = 0;
        sync();
      }
      if (events.includes("raid-won") || events.includes("raid-lost")) onScore?.(state.score);
      if (sinceSave > 5) {
        sinceSave = 0;
        save(saveKey, state);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const leave = () => game.current && save(saveKey, game.current);
    window.addEventListener("beforeunload", leave);
    return () => {
      cancelAnimationFrame(frame);
      leave();
      window.removeEventListener("beforeunload", leave);
    };
  }, [onScore, saveKey, settings, sync]);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const say = (text: string | null) => {
    setNotice(text);
    if (text) setTimeout(() => setNotice((current) => (current === text ? null : current)), 2500);
  };

  const cellAt = (clientX: number, clientY: number): [number, number] | null => {
    const el = canvas.current;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return [Math.floor(((clientX - box.left) / box.width) * settings.size), Math.floor(((clientY - box.top) / box.height) * settings.size)];
  };

  const tap = (clientX: number, clientY: number) => {
    const state = game.current;
    const at = cellAt(clientX, clientY);
    if (!state || !at) return;
    if (state.status === "raiding") {
      if (placeTroop(state, troop, at[0], at[1]).length === 0) say(state.raid!.reserve[troop] > 0 ? "Send troops in from open ground." : `No ${settings.troops[troop].name}s left.`);
      sync();
      return;
    }
    if (state.status !== "village") return;
    const there = state.buildings.find((b) => b.x === at[0] && b.y === at[1]);
    if (there) {
      if (collect(state, there.id).length === 0) setSelected(there.id === selected ? null : there.id);
      setPlacing(null);
    } else if (placing) {
      const why = whyNotBuild(state, placing, at[0], at[1]);
      if (why) say(why);
      else {
        build(state, placing, at[0], at[1]);
        setPlacing(null);
      }
    } else setSelected(null);
    sync();
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const state = game.current;
      if (!state) return;
      if (event.key === "Escape") {
        setPlacing(null);
        setSelected(null);
      } else if (state.status === "raiding" && /^[1-9]$/.test(event.key) && troops[Number(event.key) - 1]) setTroop(troops[Number(event.key) - 1]);
      else if (event.key.toLowerCase() === "c") collectAll(state);
      sync();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [sync]);

  const state = game.current;
  const space = housing(state);
  const chosen = state.buildings.find((b) => b.id === selected) ?? null;
  const raid = state.raid;
  const button = (active: boolean) => (active ? "btn btn-primary" : "btn btn-ghost");
  return (
    <section className="arcade" aria-label="Game Board" data-testid="game-board" style={{ display: "grid", gap: 12, width: "100%", maxWidth: settings.size * cell, margin: "0 auto" }}>
      <div className="hud" aria-live="polite" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        {state.status === "village" ? (
          <>
            <span>💰 <b>{Math.floor(state.gold)}</b></span>
            <span>💧 <b>{Math.floor(state.elixir)}</b> / {storage(state)}</span>
            <span>🔨 {freeBuilders(state)}/{settings.builders}</span>
            <span>⚔️ {space.used}/{space.total}</span>
            <span>🏆 {state.trophies}</span>
          </>
        ) : (
          <>
            <span>⏱ <b>{Math.ceil(raid?.timeLeft ?? 0)}s</b></span>
            <span>{"★".repeat(raid?.stars ?? 0)}{"☆".repeat(3 - (raid?.stars ?? 0))}</span>
            <span>{Math.round((raid?.destroyed ?? 0) * 100)}% destroyed</span>
            <span>💰 {raid?.loot.gold ?? 0} · 💧 {raid?.loot.elixir ?? 0}</span>
          </>
        )}
      </div>
      <div className="board" style={{ position: "relative" }}>
        <canvas
          ref={canvas}
          width={settings.size * cell}
          height={settings.size * cell}
          onPointerMove={(event) => (hover.current = cellAt(event.clientX, event.clientY))}
          onPointerLeave={() => (hover.current = null)}
          onPointerDown={(event) => tap(event.clientX, event.clientY)}
          aria-label="Game board"
          role="img"
          style={{ width: "100%", height: "auto", display: "block", touchAction: "none", borderRadius: 12, cursor: "pointer" }}
        />
        {state.status === "raid-over" && raid ? (
          <button
            className="board-message"
            onClick={() => {
              returnHome(state);
              sync();
            }}
            style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", gap: 6, background: "rgba(0,0,0,0.55)", color: "#fff", border: 0, borderRadius: 12, cursor: "pointer", font: "inherit" }}
          >
            <strong>{raid.stars > 0 ? `Victory! ${"★".repeat(raid.stars)}` : "Defeat"}</strong>
            <span>
              {raid.name}: {Math.round(raid.destroyed * 100)}% destroyed · 💰 {raid.loot.gold} · 💧 {raid.loot.elixir}
            </span>
            <span>Tap to go home</span>
          </button>
        ) : null}
        {notice ? (
          <div role="status" style={{ position: "absolute", left: 8, right: 8, top: 8, padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,0.7)", color: "#fff", textAlign: "center" }}>
            {notice}
          </div>
        ) : null}
      </div>

      {state.status === "village" ? (
        <>
          <div className="btn-row game-controls" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {BUILDABLE.map((kind) => {
              const spec = settings.buildings[kind];
              return (
                <button key={kind} className={button(placing === kind)} aria-pressed={placing === kind} onClick={() => setPlacing(placing === kind ? null : kind)} style={placing === kind ? { outline: `2px solid ${accent}` } : undefined}>
                  {EMOJI[kind]} {spec.name} · {spec.levels[0].cost}
                  {spec.pays === "gold" ? "💰" : "💧"}
                </button>
              );
            })}
          </div>
          <div className="btn-row" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {troops.map((kind) => (
              <button
                key={kind}
                className="btn btn-ghost"
                disabled={Boolean(whyNotTrain(state, kind))}
                title={whyNotTrain(state, kind) ?? `Train ${/^[aeiou]/i.test(settings.troops[kind].name) ? "an" : "a"} ${settings.troops[kind].name}`}
                onClick={() => {
                  train(state, kind);
                  sync();
                }}
              >
                Train {EMOJI[kind] ?? settings.troops[kind]?.icon ?? "⚔️"} {settings.troops[kind].name} · {settings.troops[kind].cost}💧 ({state.army[kind] ?? 0})
              </button>
            ))}
            <button
              className="btn btn-ghost"
              onClick={() => {
                collectAll(state);
                sync();
              }}
            >
              Collect all
            </button>
            <button
              className="btn btn-primary"
              disabled={troops.every((kind) => (state.army[kind] ?? 0) === 0)}
              onClick={() => {
                startRaid(state);
                setSelected(null);
                setPlacing(null);
                sync();
              }}
            >
              ⚔️ Raid!
            </button>
          </div>
          {chosen ? (
            <div className="btn-row" style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <span>
                {settings.buildings[chosen.kind].name} · level {chosen.level}
                {chosen.upgrading !== null ? ` · ${Math.ceil(chosen.upgrading)}s left` : ""}
              </span>
              {chosen.level < settings.buildings[chosen.kind].levels.length ? (
                <button
                  className="btn btn-ghost"
                  disabled={Boolean(whyNotUpgrade(state, chosen.id))}
                  title={whyNotUpgrade(state, chosen.id) ?? "Upgrade"}
                  onClick={() => {
                    upgrade(state, chosen.id);
                    sync();
                  }}
                >
                  Upgrade · {settings.buildings[chosen.kind].levels[chosen.level].cost}
                  {settings.buildings[chosen.kind].pays === "gold" ? "💰" : "💧"}
                </button>
              ) : (
                <span className="muted">Highest level</span>
              )}
            </div>
          ) : (
            <p className="muted small" style={{ textAlign: "center", margin: 0 }}>
              {placing ? `Tap open ground to place the ${settings.buildings[placing].name} · Esc to cancel` : "Pick a building, then tap open ground · tap a mine to collect · tap a building to upgrade · C collects all"}
            </p>
          )}
        </>
      ) : state.status === "raiding" && raid ? (
        <div className="btn-row game-controls" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {troops.map((kind, i) => (
            <button key={kind} className={button(troop === kind)} aria-pressed={troop === kind} onClick={() => setTroop(kind)} disabled={!raid.reserve[kind]}>
              {i + 1}. {EMOJI[kind] ?? settings.troops[kind]?.icon ?? "⚔️"} {settings.troops[kind].name} × {raid.reserve[kind] ?? 0}
            </button>
          ))}
          <span className="muted small" style={{ alignSelf: "center" }}>
            Tap open ground to send troops in
          </span>
        </div>
      ) : null}
    </section>
  );
}
