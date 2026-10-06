import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import {
  DEFAULT_SETTINGS,
  canBuild,
  newGame,
  placeTower,
  positionAt,
  roadCells,
  roadLength,
  sellTower,
  startWave,
  step,
  upgradeCost,
  upgradeTower,
  type GameState
} from "./game";
import { esc, renderAt } from "./lib/testing";

describe("the page", () => {
  const html = renderAt(<App />);

  it("shows the game, its maker and how to play", () => {
    expect(html).toContain(esc(site.hero.title));
    expect(html).toContain(esc(site.business.name));
    for (const tip of site.howTo) expect(html).toContain(esc(tip.title));
    expect(html).toContain('aria-label="Game board"');
  });

  it("keeps the prize locked until the score is reached", () => {
    expect(html).toContain("Locked until you score");
    const unlocked = renderAt(<App />, "#/", { "best-score": site.prize.threshold });
    expect(unlocked).toContain(esc(site.prize.submitLabel));
  });

  it("labels itself a preview only while demo is on", () => {
    expect(html.includes("Template preview")).toBe(site.demo);
  });
});

/** Run the game for a while in small steps, as the board does. */
const run = (state: GameState, seconds: number) => {
  const events = [];
  for (let t = 0; t < seconds; t += 0.05) events.push(...step(state, 0.05));
  return events;
};

describe("the tower defence", () => {
  it("walks the road cell by cell, corner to corner", () => {
    const cells = roadCells([
      [0, 0],
      [2, 0],
      [2, 2]
    ]);
    expect(cells).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
      [2, 2]
    ]);
    expect(positionAt([[0, 0], [2, 0]], 1.5)).toEqual([2, 0.5]);
  });

  it("builds only on free ground off the road, and only with the gold for it", () => {
    const state = newGame(DEFAULT_SETTINGS);
    const [roadX, roadY] = roadCells(DEFAULT_SETTINGS.path)[3];
    expect(canBuild(state, roadX, roadY)).toBe(false);
    expect(placeTower(state, "archer", 2, 4)).not.toBeNull();
    expect(state.gold).toBe(DEFAULT_SETTINGS.startGold - DEFAULT_SETTINGS.towers.archer.cost);
    expect(placeTower(state, "archer", 2, 4)).toBeNull();
    state.gold = 10;
    expect(placeTower(state, "cannon", 3, 4)).toBeNull();
  });

  it("upgrades a tower up to three stars and sells it for half", () => {
    const state = newGame(DEFAULT_SETTINGS);
    state.gold = 1000;
    const tower = placeTower(state, "archer", 2, 4)!;
    const cost = upgradeCost(state, tower);
    expect(upgradeTower(state, tower.id)).toBe(true);
    expect(state.gold).toBe(1000 - DEFAULT_SETTINGS.towers.archer.cost - cost);
    expect(upgradeTower(state, tower.id)).toBe(true);
    expect(upgradeTower(state, tower.id)).toBe(false);
    const before = state.gold;
    expect(sellTower(state, tower.id)).toBe(true);
    expect(state.gold).toBe(before + DEFAULT_SETTINGS.towers.archer.cost / 2);
  });

  it("waits until a wave is sent, then creeps walk the road", () => {
    const state = newGame(DEFAULT_SETTINGS);
    expect(run(state, 1)).toEqual([]);
    startWave(state);
    run(state, 1.5);
    expect(state.creeps.length).toBeGreaterThan(0);
    expect(state.creeps[0].distance).toBeGreaterThan(0);
  });

  it("costs lives for every creep that gets through, and loses when they run out", () => {
    const state = newGame({ ...DEFAULT_SETTINGS, lives: 3 });
    startWave(state);
    const events = run(state, 40);
    expect(events).toContain("leak");
    expect(events).toContain("lost");
    expect(state.status).toBe("lost");
    expect(state.lives).toBe(0);
  });

  it("towers stop creeps for gold and points, and a defended wave is cleared", () => {
    const settings = { ...DEFAULT_SETTINGS, waves: [{ name: "t", count: 3, hp: 20, speed: 1, reward: 5, gap: 1 }, ...DEFAULT_SETTINGS.waves] };
    const state = newGame(settings);
    state.gold = 1000;
    for (const [x, y] of [[1, 3], [2, 3], [3, 3], [4, 1]]) placeTower(state, "archer", x, y);
    const gold = state.gold;
    startWave(state);
    const events = run(state, 30);
    expect(events).toContain("creep-down");
    expect(events).toContain("wave-cleared");
    expect(state.lives).toBe(DEFAULT_SETTINGS.lives);
    expect(state.gold).toBe(gold + 3 * 5 + settings.waveBonus);
    expect(state.wave).toBe(1);
    expect(state.score).toBeGreaterThan(0);
  });

  it("frost slows what it hits", () => {
    const state = newGame({ ...DEFAULT_SETTINGS, waves: [{ name: "t", count: 1, hp: 1000, speed: 1, reward: 1, gap: 1 }] });
    state.gold = 1000;
    placeTower(state, "frost", 1, 3);
    startWave(state);
    run(state, 2);
    expect(state.creeps[0].slowed).toBeGreaterThan(0);
    expect(state.creeps[0].distance).toBeLessThan(2);
  });

  it("wins after the last wave", () => {
    const state = newGame({ ...DEFAULT_SETTINGS, waves: [{ name: "t", count: 1, hp: 1, speed: 1, reward: 1, gap: 1 }] });
    state.gold = 1000;
    placeTower(state, "archer", 1, 3);
    startWave(state);
    expect(run(state, 10)).toContain("won");
    expect(roadLength(DEFAULT_SETTINGS.path)).toBeGreaterThan(10);
  });
});
