/**
 * The tower-defence game itself, with no drawing and no browser: a path
 * across a grid, waves of creeps walking it, towers the player places and
 * upgrades with gold, all moved forward by step(). Kept apart from the page
 * so every rule (building, targeting, damage, gold, lives, waves) is tested
 * without a screen.
 */

export type TowerKind = "archer" | "cannon" | "frost";

export interface TowerSpec {
  name: string;
  cost: number;
  /** Reach in cells. */
  range: number;
  damage: number;
  /** Shots per second. */
  rate: number;
  /** Cannon: damage also hits creeps within this many cells of the target. */
  splash?: number;
  /** Frost: hit creeps move at this share of their speed for a while. */
  slow?: number;
  color: string;
}

export interface WaveSpec {
  name: string;
  count: number;
  hp: number;
  /** Cells per second. */
  speed: number;
  /** Gold for each creep stopped. */
  reward: number;
  /** Seconds between creeps. */
  gap: number;
}

export interface GameSettings {
  columns: number;
  rows: number;
  /** Size of a cell in pixels, for drawing. */
  cell: number;
  /** The road, as corners in [column, row]: creeps walk from the first to the last. */
  path: [number, number][];
  startGold: number;
  lives: number;
  /** Gold for clearing a wave. */
  waveBonus: number;
  towers: Record<TowerKind, TowerSpec>;
  waves: WaveSpec[];
  colors: { grass: string; road: string; creep: string };
}

export type Status = "building" | "playing" | "paused" | "wave-cleared" | "won" | "lost";

export interface Tower {
  id: number;
  kind: TowerKind;
  column: number;
  row: number;
  level: number;
  cooldown: number;
}

export interface Creep {
  id: number;
  hp: number;
  maxHp: number;
  speed: number;
  /** How far along the road, in cells. */
  distance: number;
  /** Seconds of frost left. */
  slowed: number;
  slow: number;
  reward: number;
}

/** A shot drawn for a moment: from a tower to where it hit. */
export interface Shot {
  from: [number, number];
  to: [number, number];
  kind: TowerKind;
  life: number;
}

export interface GameState {
  settings: GameSettings;
  wave: number;
  gold: number;
  lives: number;
  score: number;
  status: Status;
  towers: Tower[];
  creeps: Creep[];
  shots: Shot[];
  /** Creeps of this wave not yet on the road. */
  toSpawn: number;
  spawnTimer: number;
  nextId: number;
}

export type GameEvent = "built" | "upgraded" | "sold" | "shot" | "creep-down" | "leak" | "wave-cleared" | "won" | "lost";

/**
 * Settings that play well as they are: a winding road, three towers, five
 * waves. A game built on this engine can start with newGame(DEFAULT_SETTINGS)
 * and tune from there (GameSettings is a type: it cannot be created with `new`).
 */
export const DEFAULT_SETTINGS: GameSettings = {
  columns: 16,
  rows: 10,
  cell: 40,
  path: [
    [0, 2],
    [5, 2],
    [5, 7],
    [10, 7],
    [10, 3],
    [15, 3]
  ],
  startGold: 120,
  lives: 15,
  waveBonus: 40,
  towers: {
    archer: { name: "Archer", cost: 50, range: 2.6, damage: 12, rate: 2, color: "#facc15" },
    cannon: { name: "Cannon", cost: 90, range: 2.2, damage: 30, rate: 0.7, splash: 1, color: "#f97316" },
    frost: { name: "Frost", cost: 70, range: 2.4, damage: 4, rate: 1.5, slow: 0.45, color: "#38bdf8" }
  },
  waves: [
    { name: "Scouts", count: 8, hp: 40, speed: 1.4, reward: 6, gap: 0.9 },
    { name: "Raiders", count: 12, hp: 70, speed: 1.6, reward: 7, gap: 0.75 },
    { name: "Brutes", count: 10, hp: 160, speed: 1.1, reward: 12, gap: 1 },
    { name: "Swarm", count: 22, hp: 70, speed: 2.1, reward: 6, gap: 0.4 },
    { name: "Warlord's host", count: 18, hp: 220, speed: 1.4, reward: 14, gap: 0.6 }
  ],
  colors: { grass: "#14532d", road: "#a16207", creep: "#ef4444" }
};

/** Every cell the road passes through, in walking order. */
export function roadCells(path: [number, number][]): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i];
    const [x2, y2] = path[i + 1];
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      cells.push([x1 + Math.sign(x2 - x1) * s, y1 + Math.sign(y2 - y1) * s]);
    }
  }
  return cells;
}

/** Length of the road in cells. */
export function roadLength(path: [number, number][]): number {
  return roadCells(path).length - 1;
}

/** Where a creep that has walked `distance` cells is, in cell coordinates (centre of a cell = whole number + 0.5). */
export function positionAt(path: [number, number][], distance: number): [number, number] {
  const cells = roadCells(path);
  const i = Math.min(Math.max(Math.floor(distance), 0), cells.length - 1);
  const next = cells[Math.min(i + 1, cells.length - 1)];
  const t = Math.min(Math.max(distance - i, 0), 1);
  return [cells[i][0] + (next[0] - cells[i][0]) * t + 0.5, cells[i][1] + (next[1] - cells[i][1]) * t + 0.5];
}

export function newGame(settings: GameSettings): GameState {
  return {
    settings,
    wave: 0,
    gold: settings.startGold,
    lives: settings.lives,
    score: 0,
    status: "building",
    towers: [],
    creeps: [],
    shots: [],
    toSpawn: 0,
    spawnTimer: 0,
    nextId: 1
  };
}

/** Whether a tower can go on this cell: on the map, off the road, and free. */
export function canBuild(state: GameState, column: number, row: number): boolean {
  const { columns, rows, path } = state.settings;
  if (column < 0 || row < 0 || column >= columns || row >= rows) return false;
  if (roadCells(path).some(([x, y]) => x === column && y === row)) return false;
  return !state.towers.some((tower) => tower.column === column && tower.row === row);
}

/** What an upgrade to the next level costs. */
export function upgradeCost(state: GameState, tower: Tower): number {
  return Math.round(state.settings.towers[tower.kind].cost * 0.75 * tower.level);
}

/** Place a tower if the cell is free and the gold is there. Returns the tower, or null. */
export function placeTower(state: GameState, kind: TowerKind, column: number, row: number): Tower | null {
  const spec = state.settings.towers[kind];
  if (!canBuild(state, column, row) || state.gold < spec.cost || state.status === "won" || state.status === "lost") return null;
  state.gold -= spec.cost;
  const tower: Tower = { id: state.nextId++, kind, column, row, level: 1, cooldown: 0 };
  state.towers.push(tower);
  return tower;
}

/** Raise a tower a level (up to 3): more damage and reach. Returns false when it cannot. */
export function upgradeTower(state: GameState, id: number): boolean {
  const tower = state.towers.find((t) => t.id === id);
  if (!tower || tower.level >= 3) return false;
  const cost = upgradeCost(state, tower);
  if (state.gold < cost) return false;
  state.gold -= cost;
  tower.level += 1;
  return true;
}

/** Take a tower down for half of what it cost. */
export function sellTower(state: GameState, id: number): boolean {
  const tower = state.towers.find((t) => t.id === id);
  if (!tower) return false;
  state.gold += Math.floor(state.settings.towers[tower.kind].cost / 2);
  state.towers = state.towers.filter((t) => t !== tower);
  return true;
}

/** Send the next wave down the road. */
export function startWave(state: GameState): void {
  if (state.status !== "building" && state.status !== "wave-cleared") return;
  const spec = state.settings.waves[state.wave];
  if (!spec) return;
  state.toSpawn = spec.count;
  state.spawnTimer = 0;
  state.status = "playing";
}

/** The tower at a cell, if any. */
export function towerAt(state: GameState, column: number, row: number): Tower | undefined {
  return state.towers.find((tower) => tower.column === column && tower.row === row);
}

/** A tower's damage and reach at its level. */
export function towerStats(state: GameState, tower: Tower): { damage: number; range: number; rate: number } {
  const spec = state.settings.towers[tower.kind];
  return { damage: spec.damage * (1 + 0.6 * (tower.level - 1)), range: spec.range + 0.35 * (tower.level - 1), rate: spec.rate };
}

/** Move everything on by dt seconds and say what happened. Only moves while playing. */
export function step(state: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  state.shots = state.shots.map((shot) => ({ ...shot, life: shot.life - dt })).filter((shot) => shot.life > 0);
  if (state.status !== "playing") return events;
  const { settings } = state;
  const spec = settings.waves[state.wave];
  const end = roadLength(settings.path);

  // New creeps join the road one after another.
  state.spawnTimer -= dt;
  if (state.toSpawn > 0 && state.spawnTimer <= 0) {
    state.creeps.push({ id: state.nextId++, hp: spec.hp, maxHp: spec.hp, speed: spec.speed, distance: 0, slowed: 0, slow: 1, reward: spec.reward });
    state.toSpawn -= 1;
    state.spawnTimer = spec.gap;
  }

  // Creeps walk; any that reach the end cost a life.
  for (const creep of state.creeps) {
    creep.slowed = Math.max(0, creep.slowed - dt);
    creep.distance += creep.speed * (creep.slowed > 0 ? creep.slow : 1) * dt;
  }
  const leaked = state.creeps.filter((creep) => creep.distance >= end);
  if (leaked.length) {
    state.creeps = state.creeps.filter((creep) => creep.distance < end);
    state.lives -= leaked.length;
    events.push("leak");
    if (state.lives <= 0) {
      state.lives = 0;
      state.status = "lost";
      events.push("lost");
      return events;
    }
  }

  // Towers shoot the creep furthest along the road within reach.
  for (const tower of state.towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    if (tower.cooldown > 0) continue;
    const stats = towerStats(state, tower);
    const centre: [number, number] = [tower.column + 0.5, tower.row + 0.5];
    const inReach = state.creeps
      .map((creep) => ({ creep, at: positionAt(settings.path, creep.distance) }))
      .filter(({ at }) => Math.hypot(at[0] - centre[0], at[1] - centre[1]) <= stats.range)
      .sort((a, b) => b.creep.distance - a.creep.distance);
    const target = inReach[0];
    if (!target) continue;
    const towerSpec = settings.towers[tower.kind];
    const hit = towerSpec.splash
      ? inReach.filter(({ at }) => Math.hypot(at[0] - target.at[0], at[1] - target.at[1]) <= towerSpec.splash!)
      : [target];
    for (const { creep } of hit) {
      creep.hp -= stats.damage;
      if (towerSpec.slow) {
        creep.slowed = 1.5;
        creep.slow = towerSpec.slow;
      }
    }
    state.shots.push({ from: centre, to: target.at, kind: tower.kind, life: 0.12 });
    tower.cooldown = 1 / stats.rate;
    events.push("shot");
  }

  // Stopped creeps pay out.
  const down = state.creeps.filter((creep) => creep.hp <= 0);
  if (down.length) {
    for (const creep of down) {
      state.gold += creep.reward;
      state.score += creep.reward * 10;
    }
    state.creeps = state.creeps.filter((creep) => creep.hp > 0);
    events.push("creep-down");
  }

  // The wave is over when nothing is left to come or on the road.
  if (state.toSpawn === 0 && state.creeps.length === 0) {
    state.gold += settings.waveBonus;
    state.score += settings.waveBonus * 10 + state.lives * 5;
    if (state.wave + 1 >= settings.waves.length) {
      state.status = "won";
      events.push("won");
    } else {
      state.wave += 1;
      state.status = "wave-cleared";
      events.push("wave-cleared");
    }
  }
  return events;
}
