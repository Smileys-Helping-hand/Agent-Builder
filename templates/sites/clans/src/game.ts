/**
 * The base-building game itself, with no drawing and no browser: a village on
 * a grid, gold and elixir flowing from mines and collectors, buildings bought
 * and upgraded against timers by a limited crew of builders, troops trained in
 * barracks, and raids on enemy villages that pay out loot and stars. All of
 * it moves forward by step(), so every rule is tested without a screen.
 *
 * Time is in game seconds (step(state, dt)); a raid is simulated on the same
 * clock. Randomness (enemy villages) comes from a seed in the state, so the
 * same game plays the same way in a test.
 *
 * Troops are data: every troop is an entry in settings.troops (in this app,
 * `game.troops` in src/content.ts). To add one (a dragon, a wizard), add its
 * entry there; training, the army, raids and the board all follow. This file
 * does not need to change for it.
 */

export type BuildingKind = "townhall" | "goldmine" | "collector" | "barracks" | "camp" | "cannon" | "wall";
export type Resource = "gold" | "elixir";
/** A troop's key in settings.troops: "barbarian", "archer", "giant", or any troop the app adds. */
export type TroopKind = string;

export interface LevelSpec {
  /** What it costs to reach this level (level 1: to build it). */
  cost: number;
  /** Seconds the builder needs for it. 0: done at once. */
  seconds: number;
  hp: number;
  /** Mines and collectors: made per second. */
  rate?: number;
  /** Mines and collectors: kept until collected. Town hall: each resource's storage. */
  capacity?: number;
  /** Cannon: damage per shot, one shot a second, at this reach in cells. */
  damage?: number;
  range?: number;
  /** Army camp: troops it houses. */
  housing?: number;
}

export interface BuildingSpec {
  name: string;
  /** What building and upgrading it is paid in. */
  pays: Resource;
  levels: LevelSpec[];
  /** How many the village may have at each town hall level (index 0 = TH1). */
  allowed: number[];
  color: string;
}

export interface TroopSpec {
  name: string;
  /** Elixir to train one. */
  cost: number;
  /** Seconds to train one. */
  seconds: number;
  hp: number;
  /** Damage per second. */
  dps: number;
  /** Reach in cells (melee is about 1). */
  range: number;
  /** Cells per second. */
  speed: number;
  /** Space it takes in the army camps. */
  space: number;
  /** Giants go for the defences first. */
  prefers?: "defences";
  /** The barracks level it needs to be trained (1 when not given). */
  barracksLevel?: number;
  /** Drawn bigger on the board (giants, dragons). */
  big?: boolean;
  /** A picture-free stand-in on the board: an emoji. */
  icon?: string;
  color: string;
}

export interface GameSettings {
  /** The village is a square of this many cells. */
  size: number;
  start: { gold: number; elixir: number };
  /** Builders working at once. */
  builders: number;
  buildings: Record<BuildingKind, BuildingSpec>;
  troops: Record<TroopKind, TroopSpec>;
  /** Seconds a raid lasts. */
  raidSeconds: number;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  level: number;
  x: number;
  y: number;
  /** Seconds left on its upgrade (or its first build); null when idle. */
  upgrading: number | null;
  /** Mines and collectors: made and waiting to be collected. */
  stored: number;
}

export interface EnemyBuilding {
  id: number;
  kind: BuildingKind;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Its share of the loot. */
  loot: { gold: number; elixir: number };
  /** Cannon: seconds until it may shoot again. */
  cooldown: number;
}

export interface RaidTroop {
  id: number;
  kind: TroopKind;
  x: number;
  y: number;
  hp: number;
  /** The building it is going for, by id. */
  target: number | null;
}

export interface Raid {
  name: string;
  buildings: EnemyBuilding[];
  troops: RaidTroop[];
  /** Troops still waiting to be placed, by kind. */
  reserve: Record<TroopKind, number>;
  /** Seconds left. */
  timeLeft: number;
  loot: { gold: number; elixir: number };
  /** Share of the village destroyed, 0 to 1. */
  destroyed: number;
  stars: number;
  over: boolean;
  nextId: number;
}

export type Status = "village" | "raiding" | "raid-over";

export interface GameState {
  settings: GameSettings;
  status: Status;
  gold: number;
  elixir: number;
  buildings: Building[];
  /** Troops trained and ready, by kind. */
  army: Record<TroopKind, number>;
  /** Troops in training, in order: the first finishes first. */
  training: { kind: TroopKind; left: number }[];
  raid: Raid | null;
  /** Stars from every raid, the measure of progress. */
  trophies: number;
  score: number;
  raidsWon: number;
  seed: number;
  nextId: number;
  /** What just happened, newest last. */
  log: string[];
}

export type GameEvent =
  | "built"
  | "upgrade-started"
  | "upgrade-finished"
  | "collected"
  | "trained"
  | "raid-started"
  | "troop-placed"
  | "building-destroyed"
  | "troop-fell"
  | "raid-won"
  | "raid-lost";

export const DEFAULT_SETTINGS: GameSettings = {
  size: 14,
  start: { gold: 1000, elixir: 1000 },
  builders: 2,
  raidSeconds: 90,
  buildings: {
    townhall: {
      name: "Town Hall",
      pays: "gold",
      allowed: [1, 1, 1, 1, 1],
      color: "#f59e0b",
      levels: [
        { cost: 0, seconds: 0, hp: 1500, capacity: 5000 },
        { cost: 1000, seconds: 30, hp: 2200, capacity: 15000 },
        { cost: 4000, seconds: 90, hp: 3000, capacity: 40000 },
        { cost: 12000, seconds: 180, hp: 4000, capacity: 100000 },
        { cost: 30000, seconds: 300, hp: 5200, capacity: 200000 }
      ]
    },
    goldmine: {
      name: "Gold Mine",
      pays: "elixir",
      allowed: [2, 3, 4, 5, 6],
      color: "#eab308",
      levels: [
        { cost: 150, seconds: 5, hp: 400, rate: 2, capacity: 500 },
        { cost: 300, seconds: 15, hp: 450, rate: 4, capacity: 1000 },
        { cost: 700, seconds: 40, hp: 500, rate: 7, capacity: 2000 },
        { cost: 1500, seconds: 90, hp: 560, rate: 11, capacity: 4000 }
      ]
    },
    collector: {
      name: "Elixir Collector",
      pays: "gold",
      allowed: [2, 3, 4, 5, 6],
      color: "#d946ef",
      levels: [
        { cost: 150, seconds: 5, hp: 400, rate: 2, capacity: 500 },
        { cost: 300, seconds: 15, hp: 450, rate: 4, capacity: 1000 },
        { cost: 700, seconds: 40, hp: 500, rate: 7, capacity: 2000 },
        { cost: 1500, seconds: 90, hp: 560, rate: 11, capacity: 4000 }
      ]
    },
    barracks: {
      name: "Barracks",
      pays: "elixir",
      allowed: [1, 1, 2, 2, 3],
      color: "#ef4444",
      levels: [
        { cost: 200, seconds: 10, hp: 500 },
        { cost: 1000, seconds: 45, hp: 600 },
        { cost: 3000, seconds: 120, hp: 700 }
      ]
    },
    camp: {
      name: "Army Camp",
      pays: "elixir",
      allowed: [1, 1, 2, 2, 3],
      color: "#a16207",
      levels: [
        { cost: 250, seconds: 10, hp: 300, housing: 20 },
        { cost: 1200, seconds: 60, hp: 350, housing: 30 },
        { cost: 4000, seconds: 150, hp: 400, housing: 40 }
      ]
    },
    cannon: {
      name: "Cannon",
      pays: "gold",
      allowed: [2, 2, 3, 4, 5],
      color: "#475569",
      levels: [
        { cost: 250, seconds: 10, hp: 420, damage: 9, range: 4.5 },
        { cost: 1000, seconds: 40, hp: 470, damage: 12, range: 4.5 },
        { cost: 4000, seconds: 120, hp: 520, damage: 16, range: 5 }
      ]
    },
    wall: {
      name: "Wall",
      pays: "gold",
      allowed: [0, 25, 50, 75, 100],
      color: "#9ca3af",
      levels: [
        { cost: 50, seconds: 0, hp: 300 },
        { cost: 1000, seconds: 0, hp: 500 },
        { cost: 5000, seconds: 0, hp: 800 }
      ]
    }
  },
  troops: {
    barbarian: { name: "Barbarian", cost: 25, seconds: 3, hp: 45, dps: 8, range: 1, speed: 1.6, space: 1, color: "#f59e0b" },
    archer: { name: "Archer", cost: 50, seconds: 4, hp: 20, dps: 7, range: 3.5, speed: 1.6, space: 1, color: "#ec4899" },
    giant: { name: "Giant", cost: 250, seconds: 10, hp: 300, dps: 11, range: 1, speed: 1, space: 5, prefers: "defences", barracksLevel: 2, big: true, color: "#22c55e" }
  }
};

/** A small, seeded random generator: the same seed gives the same numbers. */
export function random(state: { seed: number }): number {
  state.seed = (state.seed * 1664525 + 1013904223) % 4294967296;
  return state.seed / 4294967296;
}

function note(state: GameState, line: string): void {
  state.log.push(line);
  if (state.log.length > 30) state.log.splice(0, state.log.length - 30);
}

const levelOf = (settings: GameSettings, kind: BuildingKind, level: number): LevelSpec => settings.buildings[kind].levels[Math.max(0, level - 1)];

export const townHallLevel = (state: GameState): number => state.buildings.find((b) => b.kind === "townhall")?.level ?? 1;

/** How much of each resource the village can hold. */
export const storage = (state: GameState): number => levelOf(state.settings, "townhall", townHallLevel(state)).capacity ?? 5000;

/** Builders free to start something. */
export const freeBuilders = (state: GameState): number => state.settings.builders - state.buildings.filter((b) => b.upgrading !== null).length;

/** Troop space in the army camps, and how much of it is taken (ready and training). */
export const housing = (state: GameState): { total: number; used: number } => {
  const total = state.buildings
    .filter((b) => b.kind === "camp" && b.upgrading === null)
    .reduce((sum, b) => sum + (levelOf(state.settings, "camp", b.level).housing ?? 0), 0);
  const ready = (Object.keys(state.army) as TroopKind[]).reduce((sum, kind) => sum + (state.army[kind] ?? 0) * (state.settings.troops[kind]?.space ?? 1), 0);
  const queued = state.training.reduce((sum, t) => sum + state.settings.troops[t.kind].space, 0);
  return { total, used: ready + queued };
};

const pay = (state: GameState, resource: Resource, amount: number): boolean => {
  if (state[resource] < amount) return false;
  state[resource] -= amount;
  return true;
};

const recalcScore = (state: GameState): void => {
  const levels = state.buildings.reduce((sum, b) => sum + b.level, 0);
  state.score = state.trophies * 100 + levels * 20 + state.raidsWon * 150;
};

/** No troops of any kind the settings list. */
export const emptyArmy = (settings: GameSettings): Record<TroopKind, number> =>
  Object.fromEntries(Object.keys(settings.troops).map((kind) => [kind, 0]));

/**
 * A saved village made to fit today's troops: one the app has since added
 * starts at 0, one it has since taken out leaves the army and the training queue.
 */
export function fitToSettings(state: GameState): GameState {
  const known = (kind: string) => Object.prototype.hasOwnProperty.call(state.settings.troops, kind);
  const kept = Object.entries(state.army ?? {}).filter(([kind, count]) => known(kind) && Number.isFinite(count));
  state.army = { ...emptyArmy(state.settings), ...Object.fromEntries(kept) };
  state.training = (state.training ?? []).filter((item) => known(item.kind));
  return state;
}

export function newGame(settings: GameSettings, seed = 23): GameState {
  const middle = Math.floor(settings.size / 2) - 1;
  const state: GameState = {
    settings,
    status: "village",
    gold: settings.start.gold,
    elixir: settings.start.elixir,
    buildings: [],
    army: emptyArmy(settings),
    training: [],
    raid: null,
    trophies: 0,
    score: 0,
    raidsWon: 0,
    seed,
    nextId: 1,
    log: []
  };
  // A town hall, a mine, a collector, barracks and a camp to start with.
  const starter: [BuildingKind, number, number][] = [
    ["townhall", middle, middle],
    ["goldmine", middle - 3, middle],
    ["collector", middle + 3, middle],
    ["barracks", middle, middle - 3],
    ["camp", middle, middle + 3]
  ];
  for (const [kind, x, y] of starter) state.buildings.push({ id: state.nextId++, kind, level: 1, x, y, upgrading: null, stored: 0 });
  recalcScore(state);
  note(state, "Your village is ready. Build, upgrade and raid.");
  return state;
}

/** How many of a kind the village has, and how many the town hall allows. */
export const counts = (state: GameState, kind: BuildingKind): { have: number; allowed: number } => ({
  have: state.buildings.filter((b) => b.kind === kind).length,
  allowed: state.settings.buildings[kind].allowed[Math.min(townHallLevel(state) - 1, state.settings.buildings[kind].allowed.length - 1)] ?? 0
});

/** Whether a cell is inside the village and empty. */
export function canPlace(state: GameState, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= state.settings.size || y >= state.settings.size) return false;
  return !state.buildings.some((b) => b.x === x && b.y === y);
}

/** Why a building cannot be placed here now, or null when it can. */
export function whyNotBuild(state: GameState, kind: BuildingKind, x: number, y: number): string | null {
  if (state.status !== "village") return "Finish the raid first.";
  if (kind === "townhall") return "There is only one town hall.";
  const { have, allowed } = counts(state, kind);
  if (have >= allowed) return `Upgrade the town hall to build more ${state.settings.buildings[kind].name}s.`;
  if (!canPlace(state, x, y)) return "That spot is taken.";
  const spec = state.settings.buildings[kind];
  const level = spec.levels[0];
  if (state[spec.pays] < level.cost) return `Not enough ${spec.pays}.`;
  if (level.seconds > 0 && freeBuilders(state) === 0) return "All builders are busy.";
  return null;
}

/** Build something new. Returns what happened; nothing changes when it cannot. */
export function build(state: GameState, kind: BuildingKind, x: number, y: number): GameEvent[] {
  if (whyNotBuild(state, kind, x, y)) return [];
  const spec = state.settings.buildings[kind];
  const level = spec.levels[0];
  pay(state, spec.pays, level.cost);
  // Under construction it is level 0; finishing its timer makes it level 1, like any upgrade.
  state.buildings.push({ id: state.nextId++, kind, level: level.seconds > 0 ? 0 : 1, x, y, upgrading: level.seconds > 0 ? level.seconds : null, stored: 0 });
  note(state, level.seconds > 0 ? `Building a ${spec.name}…` : `${spec.name} placed.`);
  recalcScore(state);
  return ["built"];
}

/** Why a building cannot be upgraded now, or null when it can. */
export function whyNotUpgrade(state: GameState, id: number): string | null {
  if (state.status !== "village") return "Finish the raid first.";
  const building = state.buildings.find((b) => b.id === id);
  if (!building) return "No such building.";
  if (building.upgrading !== null) return "It is already being worked on.";
  const spec = state.settings.buildings[building.kind];
  if (building.level >= spec.levels.length) return "It is at its highest level.";
  if (building.kind !== "townhall" && building.level >= townHallLevel(state) + 1) return "Upgrade the town hall first.";
  const next = spec.levels[building.level];
  if (state[spec.pays] < next.cost) return `Not enough ${spec.pays}.`;
  if (next.seconds > 0 && freeBuilders(state) === 0) return "All builders are busy.";
  return null;
}

/** Start upgrading a building: pays now, finishes when its timer runs out. */
export function upgrade(state: GameState, id: number): GameEvent[] {
  if (whyNotUpgrade(state, id)) return [];
  const building = state.buildings.find((b) => b.id === id)!;
  const spec = state.settings.buildings[building.kind];
  const next = spec.levels[building.level];
  pay(state, spec.pays, next.cost);
  if (next.seconds === 0) {
    building.level += 1;
    note(state, `${spec.name} is now level ${building.level}.`);
    recalcScore(state);
    return ["upgrade-finished"];
  }
  building.upgrading = next.seconds;
  note(state, `Upgrading the ${spec.name} to level ${building.level + 1}…`);
  return ["upgrade-started"];
}

/** Collect what a mine or collector has made (as much as storage allows). */
export function collect(state: GameState, id: number): GameEvent[] {
  const building = state.buildings.find((b) => b.id === id);
  if (!building || (building.kind !== "goldmine" && building.kind !== "collector") || building.stored < 1) return [];
  const resource: Resource = building.kind === "goldmine" ? "gold" : "elixir";
  const room = storage(state) - state[resource];
  const taken = Math.floor(Math.min(room, building.stored));
  if (taken <= 0) return [];
  state[resource] += taken;
  building.stored -= taken;
  note(state, `Collected ${taken} ${resource}.`);
  return ["collected"];
}

/** Collect from every mine and collector at once. */
export function collectAll(state: GameState): GameEvent[] {
  const events = state.buildings.flatMap((b) => collect(state, b.id));
  return events.length > 0 ? ["collected"] : [];
}

/** Why a troop cannot be trained now, or null when it can. */
export function whyNotTrain(state: GameState, kind: TroopKind): string | null {
  if (!state.buildings.some((b) => b.kind === "barracks" && b.upgrading === null)) return "You need a working barracks.";
  const spec = state.settings.troops[kind];
  if (!spec) return "There is no such troop.";
  const level = spec.barracksLevel ?? 1;
  if (level > 1 && !state.buildings.some((b) => b.kind === "barracks" && b.level >= level && b.upgrading === null)) return `${spec.name}s need level ${level} barracks.`;
  const { total, used } = housing(state);
  if (used + spec.space > total) return "The army camps are full.";
  if (state.elixir < spec.cost) return "Not enough elixir.";
  return null;
}

/** Queue a troop for training: pays elixir now. */
export function train(state: GameState, kind: TroopKind): GameEvent[] {
  if (whyNotTrain(state, kind)) return [];
  pay(state, "elixir", state.settings.troops[kind].cost);
  state.training.push({ kind, left: state.settings.troops[kind].seconds });
  return [];
}

const ENEMY_NAMES = ["Goblin Hollow", "Rocky Ridge", "Misty Fort", "Thornwood", "Ironvale", "Sunken Keep", "Ember Camp"];

/** An enemy village to raid, a little tougher the more trophies you have. */
export function enemyVillage(state: GameState): Raid {
  const tier = Math.min(3, 1 + Math.floor(state.trophies / 6));
  const size = state.settings.size;
  const c = Math.floor(size / 2) - 1;
  const raid: Raid = {
    name: ENEMY_NAMES[Math.floor(random(state) * ENEMY_NAMES.length)],
    buildings: [],
    troops: [],
    reserve: { ...state.army },
    timeLeft: state.settings.raidSeconds,
    loot: { gold: 0, elixir: 0 },
    destroyed: 0,
    stars: 0,
    over: false,
    nextId: 1
  };
  const add = (kind: BuildingKind, level: number, x: number, y: number, gold: number, elixir: number) => {
    const hp = levelOf(state.settings, kind, level).hp;
    raid.buildings.push({ id: raid.nextId++, kind, level, x, y, hp, maxHp: hp, loot: { gold, elixir }, cooldown: 0 });
  };
  add("townhall", tier, c, c, 300 * tier, 300 * tier);
  const ring: [number, number][] = [
    [c - 3, c - 2], [c + 3, c - 2], [c - 3, c + 2], [c + 3, c + 2], [c, c - 4], [c, c + 4]
  ];
  ring.forEach(([x, y], i) => {
    const kind: BuildingKind = i % 3 === 0 ? "goldmine" : i % 3 === 1 ? "collector" : "barracks";
    add(kind, Math.min(tier, 3), x, y, kind === "goldmine" ? 180 * tier : 40 * tier, kind === "collector" ? 180 * tier : 40 * tier);
  });
  const cannons = 1 + tier;
  for (let i = 0; i < cannons; i++) {
    const angle = (i / cannons) * Math.PI * 2 + random(state);
    add("cannon", Math.min(tier, 3), Math.round(c + Math.cos(angle) * 2), Math.round(c + Math.sin(angle) * 2), 20, 20);
  }
  return raid;
}

/** Start a raid with the army you have. */
export function startRaid(state: GameState): GameEvent[] {
  if (state.status !== "village") return [];
  const troops = (Object.keys(state.army) as TroopKind[]).reduce((sum, kind) => sum + (state.army[kind] ?? 0), 0);
  if (troops === 0) return [];
  state.raid = enemyVillage(state);
  state.army = emptyArmy(state.settings);
  state.status = "raiding";
  note(state, `Raiding ${state.raid.name}! Tap the edge of their village to send troops in.`);
  return ["raid-started"];
}

/** Send a troop into the raid at a spot outside the enemy's buildings. */
export function placeTroop(state: GameState, kind: TroopKind, x: number, y: number): GameEvent[] {
  const raid = state.raid;
  if (state.status !== "raiding" || !raid || raid.over || !((raid.reserve[kind] ?? 0) > 0)) return [];
  if (x < 0 || y < 0 || x >= state.settings.size || y >= state.settings.size) return [];
  if (raid.buildings.some((b) => b.hp > 0 && Math.abs(b.x - x) < 1 && Math.abs(b.y - y) < 1)) return [];
  raid.reserve[kind] -= 1;
  raid.troops.push({ id: raid.nextId++, kind, x, y, hp: state.settings.troops[kind].hp, target: null });
  return ["troop-placed"];
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

const finishRaid = (state: GameState, events: GameEvent[]): void => {
  const raid = state.raid!;
  if (raid.over) return;
  raid.over = true;
  state.status = "raid-over";
  const room = { gold: storage(state) - state.gold, elixir: storage(state) - state.elixir };
  state.gold += Math.max(0, Math.min(room.gold, raid.loot.gold));
  state.elixir += Math.max(0, Math.min(room.elixir, raid.loot.elixir));
  // Troops that were never sent come home.
  for (const kind of Object.keys(raid.reserve) as TroopKind[]) state.army[kind] = (state.army[kind] ?? 0) + raid.reserve[kind];
  if (raid.stars > 0) {
    state.trophies += raid.stars;
    state.raidsWon += 1;
    events.push("raid-won");
    note(state, `Victory: ${raid.stars} star${raid.stars === 1 ? "" : "s"}, ${raid.loot.gold} gold and ${raid.loot.elixir} elixir.`);
  } else {
    events.push("raid-lost");
    note(state, "Defeat: no stars this time. Train a bigger army.");
  }
  recalcScore(state);
};

/** Back to the village after a raid. */
export function returnHome(state: GameState): GameEvent[] {
  if (state.status !== "raid-over") return [];
  state.raid = null;
  state.status = "village";
  return [];
}

const stepRaid = (state: GameState, dt: number, events: GameEvent[]): void => {
  const raid = state.raid!;
  if (raid.over) return;
  raid.timeLeft = Math.max(0, raid.timeLeft - dt);
  const standing = () => raid.buildings.filter((b) => b.hp > 0);
  // Troops pick a target, walk to it, hit it.
  for (const troop of raid.troops) {
    if (troop.hp <= 0) continue;
    const spec = state.settings.troops[troop.kind];
    let target = raid.buildings.find((b) => b.id === troop.target && b.hp > 0);
    if (!target) {
      const pool = spec.prefers === "defences" && standing().some((b) => b.kind === "cannon") ? standing().filter((b) => b.kind === "cannon") : standing();
      target = pool.sort((a, b) => distance(troop, a) - distance(troop, b))[0];
      troop.target = target?.id ?? null;
    }
    if (!target) continue;
    const gap = distance(troop, target);
    if (gap > spec.range) {
      const move = Math.min(spec.speed * dt, gap - spec.range);
      troop.x += ((target.x - troop.x) / gap) * move;
      troop.y += ((target.y - troop.y) / gap) * move;
    } else {
      const before = target.hp;
      target.hp = Math.max(0, target.hp - spec.dps * dt);
      // Loot comes out as the building is damaged.
      const share = (before - target.hp) / target.maxHp;
      raid.loot.gold += Math.round(target.loot.gold * share);
      raid.loot.elixir += Math.round(target.loot.elixir * share);
      if (target.hp === 0 && before > 0) {
        events.push("building-destroyed");
        troop.target = null;
      }
    }
  }
  // Cannons shoot the nearest troop in reach.
  for (const cannon of standing().filter((b) => b.kind === "cannon")) {
    cannon.cooldown = Math.max(0, cannon.cooldown - dt);
    if (cannon.cooldown > 0) continue;
    const spec = levelOf(state.settings, "cannon", cannon.level);
    const victim = raid.troops.filter((t) => t.hp > 0 && distance(t, cannon) <= (spec.range ?? 4)).sort((a, b) => distance(a, cannon) - distance(b, cannon))[0];
    if (!victim) continue;
    victim.hp = Math.max(0, victim.hp - (spec.damage ?? 8));
    cannon.cooldown = 1;
    if (victim.hp === 0) events.push("troop-fell");
  }
  // Stars: half the village, the town hall, all of it.
  const counted = raid.buildings.filter((b) => b.kind !== "wall");
  raid.destroyed = counted.length ? counted.filter((b) => b.hp === 0).length / counted.length : 0;
  const hall = raid.buildings.find((b) => b.kind === "townhall");
  raid.stars = (raid.destroyed >= 0.5 ? 1 : 0) + (hall && hall.hp === 0 ? 1 : 0) + (raid.destroyed >= 1 ? 1 : 0);
  const fighting = raid.troops.some((t) => t.hp > 0) || (Object.keys(raid.reserve) as TroopKind[]).some((k) => raid.reserve[k] > 0);
  if (raid.timeLeft === 0 || raid.destroyed >= 1 || (!fighting && raid.troops.length > 0)) finishRaid(state, events);
};

/** Move the game forward by dt seconds: timers, production, training, and any raid. */
export function step(state: GameState, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  if (dt <= 0) return events;
  for (const building of state.buildings) {
    if (building.upgrading !== null) {
      building.upgrading = Math.max(0, building.upgrading - dt);
      if (building.upgrading === 0) {
        building.upgrading = null;
        building.level += 1;
        note(state, `${state.settings.buildings[building.kind].name} is ready (level ${building.level}).`);
        events.push("upgrade-finished");
        recalcScore(state);
      }
      continue;
    }
    const spec = levelOf(state.settings, building.kind, building.level);
    if (spec.rate && spec.capacity) building.stored = Math.min(spec.capacity, building.stored + spec.rate * dt);
  }
  // Training: one troop at a time, in order.
  let left = dt;
  while (state.training.length > 0 && left > 0) {
    const first = state.training[0];
    const spent = Math.min(first.left, left);
    first.left -= spent;
    left -= spent;
    if (first.left <= 1e-9) {
      state.training.shift();
      state.army[first.kind] = (state.army[first.kind] ?? 0) + 1;
      events.push("trained");
    }
  }
  if (state.status === "raiding" && state.raid) stepRaid(state, dt, events);
  return events;
}
