/**
 * The shooter itself, with no drawing and no browser: a ship at the bottom,
 * waves of enemies marching in formation, bullets both ways and power-ups,
 * all moved forward by step(). Kept apart from the page so every rule
 * (movement, hits, scoring, lives, waves) is tested without a screen.
 *
 * Randomness (who fires, what drops) comes from a seed in the state, so the
 * same game plays the same way in a test.
 */

export type EnemyKind = "grunt" | "tank" | "ace";

export interface WaveSpec {
  name: string;
  /** One string per row of the formation: "." is a gap, g grunt, t tank (two hits), a ace (fast shooter). */
  rows: string[];
  /** How fast the formation marches sideways, pixels per second. */
  speed: number;
  /** Shots the whole formation fires per second, shared between its members. */
  fireRate: number;
}

export interface GameSettings {
  width: number;
  height: number;
  lives: number;
  /** Ship speed in pixels per second. */
  shipSpeed: number;
  /** Seconds between the ship's shots (halved while rapid fire is on). */
  fireCooldown: number;
  bulletSpeed: number;
  enemyBulletSpeed: number;
  /** Chance (0–1) that a destroyed enemy drops a power-up. */
  dropChance: number;
  waves: WaveSpec[];
  colors: { ship: string; grunt: string; tank: string; ace: string; bullet: string; enemyBullet: string; power: string };
}

export type Status = "ready" | "playing" | "paused" | "wave-cleared" | "won" | "lost";

export interface Ship {
  x: number;
  y: number;
  w: number;
  h: number;
  cooldown: number;
  /** Seconds of rapid fire left. */
  rapid: number;
  /** Seconds of shield left: hits do nothing while it lasts. */
  shield: number;
  /** Seconds of blinking after a hit, when it cannot be hit again. */
  invulnerable: number;
}

export interface Enemy {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: EnemyKind;
  hp: number;
}

export interface Bullet {
  x: number;
  y: number;
  vy: number;
  from: "ship" | "enemy";
}

export type PowerKind = "rapid" | "shield" | "life";

export interface PowerUp {
  x: number;
  y: number;
  kind: PowerKind;
}

export interface Input {
  left: boolean;
  right: boolean;
  fire: boolean;
}

export interface GameState {
  settings: GameSettings;
  wave: number;
  score: number;
  lives: number;
  status: Status;
  ship: Ship;
  enemies: Enemy[];
  /** The formation's sideways direction: 1 right, -1 left. */
  march: number;
  bullets: Bullet[];
  powerUps: PowerUp[];
  input: Input;
  /** Seed for the game's own random numbers. */
  seed: number;
}

export type GameEvent = "shot" | "hit" | "enemy-down" | "ship-hit" | "power-up" | "wave-cleared" | "won" | "lost";

/** Points for destroying an enemy, by kind. */
export const POINTS: Record<EnemyKind, number> = { grunt: 100, tank: 250, ace: 400 };
const HP: Record<EnemyKind, number> = { grunt: 1, tank: 2, ace: 1 };
const ENEMY_W = 36;
const ENEMY_H = 24;
const GAP = 14;
const TOP = 60;
/** How far the formation drops each time it reaches a side. */
const DROP = 18;

/**
 * Settings that play well as they are: three waves, getting harder. A game
 * built on this engine can start with newGame(DEFAULT_SETTINGS) and tune from
 * there (GameSettings is a type: it cannot be created with `new`).
 */
export const DEFAULT_SETTINGS: GameSettings = {
  width: 640,
  height: 520,
  lives: 3,
  shipSpeed: 360,
  fireCooldown: 0.28,
  bulletSpeed: 620,
  enemyBulletSpeed: 260,
  dropChance: 0.12,
  waves: [
    { name: "Scouts", rows: ["gggggg", "gggggg"], speed: 50, fireRate: 0.6 },
    { name: "Armour", rows: ["tttttt", "gggggg", "gggggg"], speed: 65, fireRate: 0.9 },
    { name: "Aces high", rows: ["a.aa.a", "tttttt", "gggggg", "gggggg"], speed: 80, fireRate: 1.3 }
  ],
  colors: { ship: "#22d3ee", grunt: "#a3e635", tank: "#f59e0b", ace: "#f43f5e", bullet: "#e0f2fe", enemyBullet: "#fb7185", power: "#c084fc" }
};

/** A number in [0, 1) from the state's seed, moving the seed on. */
export function random(state: GameState): number {
  state.seed = (state.seed * 1664525 + 1013904223) % 4294967296;
  return state.seed / 4294967296;
}

/** The formation for a wave, centred near the top of the board. */
export function formationFor(wave: WaveSpec, width: number): Enemy[] {
  const columns = Math.max(...wave.rows.map((row) => row.length));
  const total = columns * ENEMY_W + (columns - 1) * GAP;
  const left = Math.max(8, (width - total) / 2);
  const enemies: Enemy[] = [];
  wave.rows.forEach((row, r) => {
    [...row].forEach((cell, c) => {
      const kind: EnemyKind | null = cell === "g" ? "grunt" : cell === "t" ? "tank" : cell === "a" ? "ace" : null;
      if (!kind) return;
      enemies.push({ x: left + c * (ENEMY_W + GAP), y: TOP + r * (ENEMY_H + GAP), w: ENEMY_W, h: ENEMY_H, kind, hp: HP[kind] });
    });
  });
  return enemies;
}

/** Put a wave on the board: the ship back in the middle, the formation at the top, nothing in flight. */
export function startWave(state: GameState, wave: number): GameState {
  const spec = state.settings.waves[wave];
  state.wave = wave;
  state.enemies = spec ? formationFor(spec, state.settings.width) : [];
  state.bullets = [];
  state.powerUps = [];
  state.march = 1;
  state.ship.x = (state.settings.width - state.ship.w) / 2;
  state.ship.invulnerable = 0;
  state.status = "ready";
  return state;
}

export function newGame(settings: GameSettings, seed = 7): GameState {
  const ship: Ship = { x: (settings.width - 44) / 2, y: settings.height - 46, w: 44, h: 26, cooldown: 0, rapid: 0, shield: 0, invulnerable: 0 };
  const state: GameState = {
    settings,
    wave: 0,
    score: 0,
    lives: settings.lives,
    status: "ready",
    ship,
    enemies: [],
    march: 1,
    bullets: [],
    powerUps: [],
    input: { left: false, right: false, fire: false },
    seed
  };
  return startWave(state, 0);
}

/** Start or carry on: from "ready" or "paused" to "playing". */
export function launch(state: GameState): void {
  if (state.status === "ready" || state.status === "paused") state.status = "playing";
}

/** Hold or release a control (keyboard, touch buttons). */
export function setInput(state: GameState, input: Partial<Input>): void {
  state.input = { ...state.input, ...input };
}

/** Move the ship so its middle is at x (pointer or finger), kept on the board. */
export function moveShip(state: GameState, x: number): void {
  state.ship.x = Math.min(Math.max(x - state.ship.w / 2, 0), state.settings.width - state.ship.w);
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;

/** Move everything on by dt seconds and say what happened. Only moves while playing. */
export function step(state: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.status !== "playing") return events;
  const { settings, ship } = state;

  // The ship: held keys move it, fire shoots when the gun is ready.
  const direction = (state.input.right ? 1 : 0) - (state.input.left ? 1 : 0);
  if (direction) moveShip(state, ship.x + ship.w / 2 + direction * settings.shipSpeed * dt);
  ship.cooldown = Math.max(0, ship.cooldown - dt);
  ship.rapid = Math.max(0, ship.rapid - dt);
  ship.shield = Math.max(0, ship.shield - dt);
  ship.invulnerable = Math.max(0, ship.invulnerable - dt);
  if (state.input.fire && ship.cooldown === 0) {
    state.bullets.push({ x: ship.x + ship.w / 2, y: ship.y, vy: -settings.bulletSpeed, from: "ship" });
    ship.cooldown = settings.fireCooldown * (ship.rapid > 0 ? 0.45 : 1);
    events.push("shot");
  }

  // The formation marches sideways, and drops a row when it reaches a side.
  const spec = settings.waves[state.wave];
  const speed = (spec?.speed ?? 60) * (1 + 0.5 * (1 - state.enemies.length / Math.max(1, formationFor(spec, settings.width).length)));
  const shift = state.march * speed * dt;
  const left = Math.min(...state.enemies.map((e) => e.x));
  const right = Math.max(...state.enemies.map((e) => e.x + e.w));
  if (state.enemies.length && (left + shift < 4 || right + shift > settings.width - 4)) {
    state.march = -state.march;
    for (const enemy of state.enemies) enemy.y += DROP;
  } else {
    for (const enemy of state.enemies) enemy.x += shift;
  }

  // Enemies fire: one random member at a time, aces more often.
  if (state.enemies.length && random(state) < (spec?.fireRate ?? 1) * dt) {
    const shooters = [...state.enemies, ...state.enemies.filter((e) => e.kind === "ace")];
    const shooter = shooters[Math.floor(random(state) * shooters.length)];
    state.bullets.push({ x: shooter.x + shooter.w / 2, y: shooter.y + shooter.h, vy: settings.enemyBulletSpeed * (shooter.kind === "ace" ? 1.4 : 1), from: "enemy" });
  }

  // Bullets fly; ship bullets hit enemies, enemy bullets hit the ship.
  const flying: Bullet[] = [];
  for (const bullet of state.bullets) {
    bullet.y += bullet.vy * dt;
    if (bullet.y < -10 || bullet.y > settings.height + 10) continue;
    if (bullet.from === "ship") {
      const target = state.enemies.find((enemy) => overlaps(enemy, bullet.x, bullet.y));
      if (target) {
        target.hp -= 1;
        events.push("hit");
        if (target.hp <= 0) {
          state.enemies = state.enemies.filter((enemy) => enemy !== target);
          state.score += POINTS[target.kind] * (1 + state.wave * 0.25);
          events.push("enemy-down");
          if (random(state) < settings.dropChance) {
            const roll = random(state);
            state.powerUps.push({ x: target.x + target.w / 2, y: target.y, kind: roll < 0.45 ? "rapid" : roll < 0.85 ? "shield" : "life" });
          }
        }
        continue;
      }
    } else if (overlaps(ship, bullet.x, bullet.y)) {
      if (ship.shield === 0 && ship.invulnerable === 0) hitShip(state, events);
      continue;
    }
    flying.push(bullet);
  }
  state.bullets = flying;
  if (state.status !== "playing") return events;

  // Power-ups fall; the ship picks them up.
  const falling: PowerUp[] = [];
  for (const power of state.powerUps) {
    power.y += 120 * dt;
    if (overlaps(ship, power.x, power.y)) {
      if (power.kind === "rapid") ship.rapid = 8;
      else if (power.kind === "shield") ship.shield = 6;
      else state.lives += 1;
      events.push("power-up");
    } else if (power.y < settings.height) falling.push(power);
  }
  state.powerUps = falling;

  // An enemy that reaches the ship's row has broken through.
  if (state.enemies.some((enemy) => enemy.y + enemy.h >= ship.y)) {
    hitShip(state, events);
    if (state.status === "playing") {
      state.score = Math.round(state.score);
      startWave(state, state.wave);
      state.status = "playing";
    }
    return events;
  }

  if (state.enemies.length === 0) {
    state.score = Math.round(state.score);
    if (state.wave + 1 >= settings.waves.length) {
      state.status = "won";
      events.push("won");
    } else {
      state.status = "wave-cleared";
      events.push("wave-cleared");
    }
  }
  state.score = Math.round(state.score);
  return events;
}

function hitShip(state: GameState, events: GameEvent[]): void {
  state.lives -= 1;
  events.push("ship-hit");
  if (state.lives <= 0) {
    state.lives = 0;
    state.status = "lost";
    events.push("lost");
  } else {
    state.ship.invulnerable = 1.5;
  }
}
