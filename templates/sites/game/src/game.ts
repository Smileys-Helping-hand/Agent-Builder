/**
 * The game itself, with no drawing and no browser: a paddle, a ball and rows
 * of bricks, moved forward by step(). Kept apart from the page so every rule
 * (bounces, scoring, lives, levels) is tested without a screen.
 */

export interface LevelSpec {
  name: string;
  /** One string per row of bricks: "." is a gap, 1–3 is how many hits a brick takes. */
  rows: string[];
}

export interface GameSettings {
  width: number;
  height: number;
  lives: number;
  /** Ball speed in pixels per second on the first level. */
  speed: number;
  /** How much faster the ball is on each later level, as a share (0.12 = 12% faster). */
  speedUpPerLevel: number;
  levels: LevelSpec[];
  /** Brick colours by how many hits are left: [1 hit, 2 hits, 3 hits]. */
  colors: [string, string, string];
}

export interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Hits left before it breaks. */
  hits: number;
  /** Hits it took to start with, which is what breaking it scores. */
  toughness: number;
}

export type Status = "ready" | "playing" | "paused" | "level-cleared" | "won" | "lost";

export interface GameState {
  settings: GameSettings;
  level: number;
  score: number;
  lives: number;
  status: Status;
  paddle: { x: number; y: number; w: number; h: number };
  ball: { x: number; y: number; vx: number; vy: number; r: number };
  bricks: Brick[];
}

const COLUMNS_GAP = 6;
const TOP = 56;
const BRICK_H = 20;
/** Points for breaking a brick, by the hits it took. */
export const POINTS = [0, 50, 120, 250];

export function bricksFor(level: LevelSpec, width: number): Brick[] {
  const columns = Math.max(...level.rows.map((row) => row.length));
  const w = (width - COLUMNS_GAP * (columns + 1)) / columns;
  const bricks: Brick[] = [];
  level.rows.forEach((row, r) => {
    [...row].forEach((cell, c) => {
      const hits = Math.min(Number(cell), 3);
      if (!Number.isInteger(hits) || hits < 1) return;
      bricks.push({ x: COLUMNS_GAP + c * (w + COLUMNS_GAP), y: TOP + r * (BRICK_H + COLUMNS_GAP), w, h: BRICK_H, hits, toughness: hits });
    });
  });
  return bricks;
}

/** The ball sitting on the paddle, waiting to be launched. */
function resetBall(state: GameState): void {
  const { paddle } = state;
  state.ball = { x: paddle.x + paddle.w / 2, y: paddle.y - 9, vx: 0, vy: 0, r: 8 };
}

export function startLevel(state: GameState, level: number): GameState {
  const { width, height } = state.settings;
  state.level = level;
  state.bricks = bricksFor(state.settings.levels[level], width);
  state.paddle = { x: width / 2 - 55, y: height - 32, w: 110, h: 14 };
  resetBall(state);
  state.status = "ready";
  return state;
}

export function newGame(settings: GameSettings): GameState {
  const state = {
    settings,
    level: 0,
    score: 0,
    lives: settings.lives,
    status: "ready"
  } as GameState;
  return startLevel(state, 0);
}

export function speedFor(state: GameState): number {
  return state.settings.speed * (1 + state.settings.speedUpPerLevel * state.level);
}

/** Send the ball off the paddle, slightly to one side so it never goes straight up and down forever. */
export function launch(state: GameState): void {
  if (state.status !== "ready") return;
  const speed = speedFor(state);
  const angle = (-Math.PI / 2) + (Math.random() < 0.5 ? -0.35 : 0.35);
  state.ball.vx = Math.cos(angle) * speed;
  state.ball.vy = Math.sin(angle) * speed;
  state.status = "playing";
}

/** Move the paddle so its middle is at x, staying on the board. A waiting ball rides along. */
export function movePaddle(state: GameState, x: number): void {
  const { paddle } = state;
  paddle.x = Math.max(0, Math.min(state.settings.width - paddle.w, x - paddle.w / 2));
  if (state.status === "ready") resetBall(state);
}

const overlaps = (ball: GameState["ball"], box: { x: number; y: number; w: number; h: number }) =>
  ball.x + ball.r > box.x && ball.x - ball.r < box.x + box.w && ball.y + ball.r > box.y && ball.y - ball.r < box.y + box.h;

/** What happened in a step, for sounds, shakes and messages on the page. */
export type GameEvent = "brick" | "paddle" | "wall" | "life-lost" | "level-cleared" | "won" | "lost";

/**
 * Move the game on by dt seconds. Long frames are cut into short steps so a
 * fast ball cannot pass through a brick between two frames.
 */
export function step(state: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (state.status !== "playing") return events;
  let remaining = Math.min(dt, 0.25);
  while (remaining > 0 && state.status === "playing") {
    const slice = Math.min(remaining, 1 / 240);
    remaining -= slice;
    advance(state, slice, events);
  }
  return events;
}

function advance(state: GameState, dt: number, events: GameEvent[]): void {
  const { ball, paddle, settings } = state;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Walls: left, right and top.
  if (ball.x - ball.r < 0 || ball.x + ball.r > settings.width) {
    ball.vx = -ball.vx;
    ball.x = Math.max(ball.r, Math.min(settings.width - ball.r, ball.x));
    events.push("wall");
  }
  if (ball.y - ball.r < 0) {
    ball.vy = Math.abs(ball.vy);
    ball.y = ball.r;
    events.push("wall");
  }

  // The paddle: where the ball lands decides the angle it leaves at.
  if (ball.vy > 0 && overlaps(ball, paddle)) {
    const offset = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
    const angle = -Math.PI / 2 + Math.max(-1, Math.min(1, offset)) * 1.05;
    const speed = speedFor(state);
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    ball.y = paddle.y - ball.r;
    events.push("paddle");
  }

  // Bricks: bounce off the side the ball came in from.
  const hit = state.bricks.find((brick) => overlaps(ball, brick));
  if (hit) {
    const fromSide = Math.min(Math.abs(ball.x - hit.x), Math.abs(ball.x - (hit.x + hit.w))) < ball.r;
    if (fromSide) ball.vx = -ball.vx;
    else ball.vy = -ball.vy;
    hit.hits -= 1;
    if (hit.hits <= 0) {
      state.bricks = state.bricks.filter((brick) => brick !== hit);
      // Tougher bricks and later levels are worth more.
      state.score += POINTS[hit.toughness] + state.level * 10;
    }
    events.push("brick");
    if (state.bricks.length === 0) {
      const last = state.level >= settings.levels.length - 1;
      state.status = last ? "won" : "level-cleared";
      events.push(last ? "won" : "level-cleared");
    }
  }

  // Missed the ball.
  if (ball.y - ball.r > settings.height) {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.status = "lost";
      events.push("lost");
    } else {
      resetBall(state);
      state.status = "ready";
      events.push("life-lost");
    }
  }
}
