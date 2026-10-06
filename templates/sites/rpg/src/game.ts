/**
 * The role-playing game itself, with no drawing and no browser: a hero
 * exploring floors of a dungeon, turn-based battles with the monsters on
 * them, experience and levels, potions and gold, and a boss at the bottom.
 * Every rule (moving, fighting, levelling, winning, losing) is a plain
 * function on the state, tested without a screen.
 *
 * Randomness (how hard a blow lands, whether fleeing works) comes from a seed
 * in the state, so the same game plays the same way in a test.
 */

export interface MonsterSpec {
  name: string;
  hp: number;
  attack: number;
  defence: number;
  xp: number;
  gold: number;
  /** A boss cannot be fled from, and beating the last floor's boss wins the game. */
  boss?: boolean;
  color: string;
}

export interface FloorSpec {
  name: string;
  /**
   * One string per row: # wall, . floor, @ where the hero starts, > stairs
   * down, p potion, $ gold, and a monster's letter (see monsters) where it waits.
   */
  rows: string[];
}

export interface GameSettings {
  hero: { name: string; hp: number; attack: number; defence: number; potions: number };
  /** Experience needed for the next level is this times the current level. */
  xpPerLevel: number;
  /** How much a potion heals. */
  potionHeal: number;
  /** Gold in a chest. */
  chestGold: number;
  monsters: Record<string, MonsterSpec>;
  floors: FloorSpec[];
  colors: { wall: string; floor: string; hero: string; stairs: string; item: string };
}

export type Status = "exploring" | "battle" | "won" | "lost";

export interface Hero {
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  attack: number;
  defence: number;
  level: number;
  xp: number;
  gold: number;
  potions: number;
}

export interface Battle {
  /** The monster's letter on the map, and where it stands. */
  key: string;
  x: number;
  y: number;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  defence: number;
  /** What beating it earns. */
  xp: number;
  gold: number;
  boss: boolean;
}

export interface GameState {
  settings: GameSettings;
  floor: number;
  /** The current floor, as a grid that changes: monsters beaten and items taken become floor. */
  map: string[][];
  hero: Hero;
  status: Status;
  battle: Battle | null;
  /** What just happened, newest last, for the screen to show. */
  log: string[];
  score: number;
  /** Monsters beaten, for the score. */
  defeated: number;
  seed: number;
}

export type GameEvent =
  | "moved"
  | "blocked"
  | "battle"
  | "potion-found"
  | "gold-found"
  | "stairs"
  | "hit"
  | "enemy-down"
  | "hero-hit"
  | "level-up"
  | "healed"
  | "fled"
  | "flee-failed"
  | "won"
  | "lost";

/**
 * Settings that play well as they are: three floors, getting harder, a
 * dragon at the bottom. A game built on this engine can start with
 * newGame(DEFAULT_SETTINGS) and tune from there (GameSettings is a type: it
 * cannot be created with `new`).
 */
export const DEFAULT_SETTINGS: GameSettings = {
  hero: { name: "Hero", hp: 40, attack: 8, defence: 3, potions: 2 },
  xpPerLevel: 30,
  potionHeal: 25,
  chestGold: 25,
  monsters: {
    s: { name: "Slime", hp: 14, attack: 5, defence: 1, xp: 8, gold: 4, color: "#4ade80" },
    g: { name: "Goblin", hp: 22, attack: 8, defence: 2, xp: 14, gold: 8, color: "#a3e635" },
    k: { name: "Skeleton", hp: 30, attack: 11, defence: 4, xp: 22, gold: 12, color: "#e5e7eb" },
    o: { name: "Orc", hp: 44, attack: 14, defence: 6, xp: 34, gold: 18, color: "#f97316" },
    D: { name: "Dragon", hp: 120, attack: 20, defence: 9, xp: 150, gold: 200, boss: true, color: "#ef4444" }
  },
  floors: [
    {
      name: "The Cellar",
      rows: [
        "###############",
        "#@..s...#....p#",
        "#.###.#.#.##..#",
        "#.#...#...#.g.#",
        "#.#.#####.#...#",
        "#...#$..s.#.###",
        "###.#.###.#...#",
        "#p..#...#...g.#",
        "#.s...#.#.#..>#",
        "###############"
      ]
    },
    {
      name: "The Crypt",
      rows: [
        "###############",
        "#@...#....k..$#",
        "#.##.#.##.###.#",
        "#.g..#..#.....#",
        "#.####..#.#####",
        "#....k..#....p#",
        "####.####.###.#",
        "#$...#..g.#...#",
        "#.k....p..#.o>#",
        "###############"
      ]
    },
    {
      name: "The Dragon's Lair",
      rows: [
        "###############",
        "#@..o....#...p#",
        "#.##.###.#.#..#",
        "#.#...k..#.#..#",
        "#.#.####...#.k#",
        "#p..#..o.###..#",
        "###.#.##......#",
        "#$..#..k..##..#",
        "#...o.....#.D.#",
        "###############"
      ]
    }
  ],
  colors: { wall: "#292524", floor: "#57534e", hero: "#38bdf8", stairs: "#fde047", item: "#facc15" }
};

/** A number in [0, 1) from the state's seed, moving the seed on. */
export function random(state: GameState): number {
  state.seed = (state.seed * 1664525 + 1013904223) % 4294967296;
  return state.seed / 4294967296;
}

/** Experience needed to reach the next level from here. */
export function xpToNext(state: GameState): number {
  return state.settings.xpPerLevel * state.hero.level;
}

function note(state: GameState, line: string): void {
  state.log = [...state.log, line].slice(-6);
}

function rescore(state: GameState): void {
  state.score = state.hero.gold + state.defeated * 25 + (state.hero.level - 1) * 100 + state.floor * 250 + (state.status === "won" ? 1000 : 0);
}

/** Put the hero at the top of a floor. */
export function enterFloor(state: GameState, floor: number): GameState {
  const spec = state.settings.floors[floor];
  state.floor = floor;
  state.map = spec.rows.map((row) => [...row]);
  for (let y = 0; y < state.map.length; y++) {
    for (let x = 0; x < state.map[y].length; x++) {
      if (state.map[y][x] === "@") {
        state.hero.x = x;
        state.hero.y = y;
        state.map[y][x] = ".";
      }
    }
  }
  state.battle = null;
  state.status = "exploring";
  note(state, `You enter ${spec.name}.`);
  rescore(state);
  return state;
}

export function newGame(settings: GameSettings, seed = 11): GameState {
  const { hero } = settings;
  const state: GameState = {
    settings,
    floor: 0,
    map: [],
    hero: { name: hero.name, x: 0, y: 0, hp: hero.hp, maxHp: hero.hp, attack: hero.attack, defence: hero.defence, level: 1, xp: 0, gold: 0, potions: hero.potions },
    status: "exploring",
    battle: null,
    log: [],
    score: 0,
    defeated: 0,
    seed
  };
  return enterFloor(state, 0);
}

/** Damage from one blow: attack minus defence, at least 1, give or take a little. */
function blow(state: GameState, attack: number, defence: number): number {
  return Math.max(1, Math.round(attack - defence + (random(state) * 4 - 1)));
}

/** Take a step. Walking into a monster starts a battle; into a wall does nothing. */
export function move(state: GameState, dx: number, dy: number): GameEvent[] {
  if (state.status !== "exploring") return [];
  const x = state.hero.x + dx;
  const y = state.hero.y + dy;
  const tile = state.map[y]?.[x];
  if (tile === undefined || tile === "#") return ["blocked"];
  const monster = state.settings.monsters[tile];
  if (monster) {
    state.battle = { key: tile, x, y, name: monster.name, hp: monster.hp, maxHp: monster.hp, attack: monster.attack, defence: monster.defence, xp: monster.xp, gold: monster.gold, boss: Boolean(monster.boss) };
    state.status = "battle";
    note(state, `A ${monster.name} blocks the way!`);
    return ["battle"];
  }
  state.hero.x = x;
  state.hero.y = y;
  const events: GameEvent[] = ["moved"];
  if (tile === "p") {
    state.hero.potions += 1;
    state.map[y][x] = ".";
    note(state, "You find a potion.");
    events.push("potion-found");
  } else if (tile === "$") {
    state.hero.gold += state.settings.chestGold;
    state.map[y][x] = ".";
    note(state, `You open a chest: ${state.settings.chestGold} gold.`);
    events.push("gold-found");
  } else if (tile === ">") {
    if (state.floor + 1 < state.settings.floors.length) {
      enterFloor(state, state.floor + 1);
      events.push("stairs");
    }
  }
  rescore(state);
  return events;
}

/** The monster's turn: it strikes back, and the hero may fall. */
function monsterTurn(state: GameState, events: GameEvent[]): void {
  const battle = state.battle!;
  const damage = blow(state, battle.attack, state.hero.defence);
  state.hero.hp = Math.max(0, state.hero.hp - damage);
  note(state, `The ${battle.name} hits you for ${damage}.`);
  events.push("hero-hit");
  if (state.hero.hp === 0) {
    state.status = "lost";
    note(state, "You fall. The dungeon claims another hero.");
    events.push("lost");
  }
}

/** Strike the monster; if it survives, it strikes back. */
export function attack(state: GameState): GameEvent[] {
  if (state.status !== "battle" || !state.battle) return [];
  const events: GameEvent[] = [];
  const battle = state.battle;
  const damage = blow(state, state.hero.attack, battle.defence);
  battle.hp = Math.max(0, battle.hp - damage);
  note(state, `You hit the ${battle.name} for ${damage}.`);
  events.push("hit");
  if (battle.hp > 0) {
    monsterTurn(state, events);
    rescore(state);
    return events;
  }

  // Victory: experience, gold, maybe a level, and the way is clear.
  const spec = state.settings.monsters[battle.key];
  state.map[battle.y][battle.x] = ".";
  state.hero.xp += spec.xp;
  state.hero.gold += spec.gold;
  state.defeated += 1;
  state.battle = null;
  state.status = "exploring";
  note(state, `The ${battle.name} is defeated: +${spec.xp} XP, +${spec.gold} gold.`);
  events.push("enemy-down");
  while (state.hero.xp >= xpToNext(state)) {
    state.hero.xp -= xpToNext(state);
    state.hero.level += 1;
    state.hero.maxHp += 8;
    state.hero.attack += 2;
    state.hero.defence += 1;
    state.hero.hp = state.hero.maxHp;
    note(state, `Level ${state.hero.level}! You feel stronger.`);
    events.push("level-up");
  }
  if (spec.boss && state.floor === state.settings.floors.length - 1) {
    state.status = "won";
    note(state, "The dragon falls. The dungeon is yours!");
    events.push("won");
  }
  rescore(state);
  return events;
}

/** Drink a potion, in a battle or out of one. In a battle the monster gets its turn. */
export function usePotion(state: GameState): GameEvent[] {
  if ((state.status !== "battle" && state.status !== "exploring") || state.hero.potions === 0) return [];
  const events: GameEvent[] = [];
  state.hero.potions -= 1;
  const healed = Math.min(state.settings.potionHeal, state.hero.maxHp - state.hero.hp);
  state.hero.hp += healed;
  note(state, `You drink a potion: +${healed} HP.`);
  events.push("healed");
  if (state.status === "battle") monsterTurn(state, events);
  rescore(state);
  return events;
}

/** Try to run. Never from a boss; otherwise it works about half the time, and failing costs a hit. */
export function flee(state: GameState): GameEvent[] {
  if (state.status !== "battle" || !state.battle) return [];
  const events: GameEvent[] = [];
  if (!state.battle.boss && random(state) < 0.55) {
    note(state, `You escape the ${state.battle.name}.`);
    state.battle = null;
    state.status = "exploring";
    events.push("fled");
    return events;
  }
  note(state, state.battle.boss ? "There is no escaping the dragon!" : "You fail to get away!");
  events.push("flee-failed");
  monsterTurn(state, events);
  rescore(state);
  return events;
}
