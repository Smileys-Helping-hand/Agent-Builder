import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  build,
  canPlace,
  collect,
  collectAll,
  counts,
  enemyVillage,
  freeBuilders,
  housing,
  newGame,
  placeTroop,
  returnHome,
  startRaid,
  step,
  storage,
  townHallLevel,
  train,
  upgrade,
  whyNotBuild,
  whyNotTrain,
  whyNotUpgrade,
  type GameState
} from "./game";

const fresh = (): GameState => newGame(DEFAULT_SETTINGS);
const run = (state: GameState, seconds: number) => {
  const events = [];
  for (let t = 0; t < seconds; t += 0.25) events.push(...step(state, 0.25));
  return events;
};

describe("the village", () => {
  it("starts with a town hall, a mine, a collector, barracks and a camp", () => {
    const state = fresh();
    expect(state.buildings.map((b) => b.kind).sort()).toEqual(["barracks", "camp", "collector", "goldmine", "townhall"]);
    expect(state.gold).toBe(1000);
    expect(state.elixir).toBe(1000);
    expect(townHallLevel(state)).toBe(1);
    expect(storage(state)).toBe(5000);
    expect(freeBuilders(state)).toBe(2);
  });

  it("only lets a building go on an empty cell inside the village", () => {
    const state = fresh();
    const hall = state.buildings.find((b) => b.kind === "townhall")!;
    expect(canPlace(state, hall.x, hall.y)).toBe(false);
    expect(canPlace(state, 0, 0)).toBe(true);
    expect(canPlace(state, -1, 0)).toBe(false);
    expect(canPlace(state, DEFAULT_SETTINGS.size, 0)).toBe(false);
  });

  it("builds a cannon: pays gold, uses a builder, and it is ready when the timer runs out", () => {
    const state = fresh();
    expect(build(state, "cannon", 0, 0)).toEqual(["built"]);
    expect(state.gold).toBe(1000 - DEFAULT_SETTINGS.buildings.cannon.levels[0].cost);
    const cannon = state.buildings.find((b) => b.kind === "cannon")!;
    expect(cannon.level).toBe(0);
    expect(freeBuilders(state)).toBe(1);
    expect(run(state, DEFAULT_SETTINGS.buildings.cannon.levels[0].seconds)).toContain("upgrade-finished");
    expect(cannon.level).toBe(1);
    expect(cannon.upgrading).toBeNull();
    expect(freeBuilders(state)).toBe(2);
  });

  it("says why it cannot build", () => {
    const state = fresh();
    expect(whyNotBuild(state, "townhall", 0, 0)).toMatch(/only one town hall/);
    expect(whyNotBuild(state, "wall", 0, 0)).toMatch(/town hall/);
    expect(whyNotBuild({ ...state, gold: 0 }, "cannon", 0, 0)).toMatch(/Not enough gold/);
    build(state, "cannon", 0, 0);
    build(state, "cannon", 1, 0);
    expect(whyNotBuild(state, "goldmine", 2, 0)).toMatch(/builders are busy/);
    expect(build(state, "goldmine", 2, 0)).toEqual([]);
  });

  it("limits each kind by town hall level", () => {
    const state = fresh();
    expect(counts(state, "goldmine")).toEqual({ have: 1, allowed: 2 });
    expect(counts(state, "barracks")).toEqual({ have: 1, allowed: 1 });
    expect(whyNotBuild(state, "barracks", 0, 0)).toMatch(/Upgrade the town hall/);
  });

  it("upgrades the town hall, which raises storage and what may be built", () => {
    const state = fresh();
    const hall = state.buildings.find((b) => b.kind === "townhall")!;
    expect(upgrade(state, hall.id)).toEqual(["upgrade-started"]);
    expect(state.gold).toBe(0);
    expect(whyNotUpgrade(state, hall.id)).toMatch(/already/);
    run(state, 30);
    expect(hall.level).toBe(2);
    expect(storage(state)).toBe(15000);
    expect(counts(state, "wall").allowed).toBe(25);
  });

  it("keeps other buildings within one level of the town hall", () => {
    const state = { ...fresh(), gold: 100000, elixir: 100000 };
    const mine = state.buildings.find((b) => b.kind === "goldmine")!;
    upgrade(state, mine.id);
    run(state, 15);
    expect(mine.level).toBe(2);
    expect(whyNotUpgrade(state, mine.id)).toMatch(/town hall first/);
  });

  it("walls are built and upgraded at once, without a builder", () => {
    const state = { ...fresh(), gold: 100000 };
    const hall = state.buildings.find((b) => b.kind === "townhall")!;
    upgrade(state, hall.id);
    run(state, 30);
    build(state, "cannon", 0, 1);
    build(state, "cannon", 1, 1);
    expect(freeBuilders(state)).toBe(0);
    expect(build(state, "wall", 0, 0)).toEqual(["built"]);
    const wall = state.buildings.find((b) => b.kind === "wall")!;
    expect(wall.level).toBe(1);
    expect(upgrade(state, wall.id)).toEqual(["upgrade-finished"]);
    expect(wall.level).toBe(2);
  });
});

describe("resources", () => {
  it("mines and collectors fill up over time, up to their capacity, and are collected", () => {
    const state = fresh();
    const mine = state.buildings.find((b) => b.kind === "goldmine")!;
    run(state, 10);
    expect(mine.stored).toBeCloseTo(20, 5);
    expect(collect(state, mine.id)).toEqual(["collected"]);
    expect(state.gold).toBe(1020);
    run(state, 1000);
    expect(mine.stored).toBe(DEFAULT_SETTINGS.buildings.goldmine.levels[0].capacity);
  });

  it("collecting stops at the storage limit and leaves the rest in the mine", () => {
    const state = { ...fresh(), gold: 4990 };
    const mine = state.buildings.find((b) => b.kind === "goldmine")!;
    run(state, 50);
    collect(state, mine.id);
    expect(state.gold).toBe(5000);
    expect(mine.stored).toBeCloseTo(90, 5);
  });

  it("collects everything at once", () => {
    const state = fresh();
    run(state, 5);
    expect(collectAll(state)).toEqual(["collected"]);
    expect(state.gold).toBe(1010);
    expect(state.elixir).toBe(1010);
  });
});

describe("the army", () => {
  it("trains troops one after another into the camps", () => {
    const state = fresh();
    train(state, "barbarian");
    train(state, "archer");
    expect(state.elixir).toBe(1000 - 25 - 50);
    expect(run(state, 3).filter((e) => e === "trained")).toHaveLength(1);
    expect(state.army.barbarian).toBe(1);
    run(state, 4);
    expect(state.army.archer).toBe(1);
  });

  it("stops when the camps are full, and giants need level 2 barracks", () => {
    const state = { ...fresh(), elixir: 100000 };
    for (let i = 0; i < 20; i++) train(state, "barbarian");
    expect(housing(state)).toEqual({ total: 20, used: 20 });
    expect(whyNotTrain(state, "archer")).toMatch(/full/);
    expect(whyNotTrain(state, "giant")).toMatch(/level 2 barracks/);
  });
});

describe("raids", () => {
  const armed = (barbarians: number, archers = 0, giants = 0): GameState => {
    const state = fresh();
    state.army = { barbarian: barbarians, archer: archers, giant: giants };
    return state;
  };

  it("an enemy village has a town hall, loot buildings and cannons", () => {
    const raid = enemyVillage(fresh());
    expect(raid.buildings.filter((b) => b.kind === "townhall")).toHaveLength(1);
    expect(raid.buildings.some((b) => b.kind === "cannon")).toBe(true);
    expect(raid.buildings.reduce((sum, b) => sum + b.loot.gold, 0)).toBeGreaterThan(0);
  });

  it("needs an army to start", () => {
    expect(startRaid(fresh())).toEqual([]);
    const state = armed(5);
    expect(startRaid(state)).toEqual(["raid-started"]);
    expect(state.status).toBe("raiding");
    expect(state.raid!.reserve.barbarian).toBe(5);
  });

  it("troops can only be placed outside buildings, from the reserve", () => {
    const state = armed(1);
    startRaid(state);
    const hall = state.raid!.buildings.find((b) => b.kind === "townhall")!;
    expect(placeTroop(state, "barbarian", hall.x, hall.y)).toEqual([]);
    expect(placeTroop(state, "barbarian", 0, 0)).toEqual(["troop-placed"]);
    expect(placeTroop(state, "barbarian", 0, 1)).toEqual([]);
  });

  it("a strong army destroys the village, takes the loot and three stars", () => {
    const strong = armed(40, 20, 6);
    startRaid(strong);
    for (let i = 0; i < 40; i++) placeTroop(strong, "barbarian", 0, i % DEFAULT_SETTINGS.size);
    for (let i = 0; i < 20; i++) placeTroop(strong, "archer", DEFAULT_SETTINGS.size - 1, i % DEFAULT_SETTINGS.size);
    for (let i = 0; i < 6; i++) placeTroop(strong, "giant", i, 0);
    const events = run(strong, DEFAULT_SETTINGS.raidSeconds);
    expect(strong.status).toBe("raid-over");
    expect(events).toContain("raid-won");
    expect(strong.raid!.stars).toBe(3);
    expect(strong.trophies).toBe(3);
    expect(strong.gold).toBeGreaterThan(1000);
    expect(strong.score).toBeGreaterThan(0);
  });

  it("a lone barbarian loses, and unsent troops come home", () => {
    const state = armed(2);
    startRaid(state);
    placeTroop(state, "barbarian", 0, 0);
    const events = run(state, DEFAULT_SETTINGS.raidSeconds);
    expect(events).toContain("raid-lost");
    expect(state.trophies).toBe(0);
    expect(state.army.barbarian).toBe(1);
    expect(returnHome(state)).toEqual([]);
    expect(state.status).toBe("village");
    expect(state.raid).toBeNull();
  });

  it("village timers keep running during a raid", () => {
    const state = armed(1);
    const mine = state.buildings.find((b) => b.kind === "goldmine")!;
    startRaid(state);
    step(state, 10);
    expect(mine.stored).toBeCloseTo(20, 5);
  });
});
