import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { DEFAULT_SETTINGS, POINTS, formationFor, launch, moveShip, newGame, setInput, startWave, step, type GameState } from "./game";
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

/** A game already playing, with nothing random in the way. */
const playing = (): GameState => {
  const state = newGame({ ...DEFAULT_SETTINGS, dropChance: 0 });
  launch(state);
  state.settings = { ...state.settings, waves: state.settings.waves.map((wave) => ({ ...wave, fireRate: 0 })) };
  return state;
};

describe("the shooter", () => {
  it("lines each wave up as its rows say, inside the board", () => {
    const enemies = formationFor({ name: "t", rows: ["g.t", "a"], speed: 10, fireRate: 0 }, 640);
    expect(enemies.map((enemy) => enemy.kind)).toEqual(["grunt", "tank", "ace"]);
    expect(enemies.find((enemy) => enemy.kind === "tank")!.hp).toBe(2);
    expect(enemies.every((enemy) => enemy.x >= 0 && enemy.x + enemy.w <= 640)).toBe(true);
  });

  it("waits until started, then the ship moves with the keys and stays on the board", () => {
    const state = newGame(DEFAULT_SETTINGS);
    expect(step(state, 0.5)).toEqual([]);
    launch(state);
    const x = state.ship.x;
    setInput(state, { right: true });
    step(state, 0.1);
    expect(state.ship.x).toBeGreaterThan(x);
    moveShip(state, -500);
    expect(state.ship.x).toBe(0);
    moveShip(state, 5000);
    expect(state.ship.x + state.ship.w).toBe(DEFAULT_SETTINGS.width);
  });

  it("fires while fire is held, no faster than the gun allows", () => {
    const state = playing();
    setInput(state, { fire: true });
    expect(step(state, 0.016)).toContain("shot");
    expect(step(state, 0.016)).not.toContain("shot");
    expect(state.bullets.filter((bullet) => bullet.from === "ship")).toHaveLength(1);
  });

  it("scores an enemy by its kind when the shots bring it down", () => {
    const state = playing();
    const tank = { x: 300, y: 200, w: 36, h: 24, kind: "tank" as const, hp: 2 };
    state.enemies = [tank, { x: 20, y: 60, w: 36, h: 24, kind: "grunt", hp: 1 }];
    state.bullets = [{ x: 318, y: 230, vy: -620, from: "ship" }];
    expect(step(state, 0.016)).toContain("hit");
    expect(tank.hp).toBe(1);
    state.bullets = [{ x: tank.x + 18, y: tank.y + 30, vy: -620, from: "ship" }];
    expect(step(state, 0.016)).toContain("enemy-down");
    expect(state.score).toBe(POINTS.tank);
  });

  it("clears a wave when the last enemy falls, then starts the next", () => {
    const state = playing();
    state.enemies = [{ x: 300, y: 200, w: 36, h: 24, kind: "grunt", hp: 1 }];
    state.bullets = [{ x: 318, y: 230, vy: -620, from: "ship" }];
    expect(step(state, 0.016)).toContain("wave-cleared");
    startWave(state, 1);
    expect(state.wave).toBe(1);
    expect(state.enemies.length).toBeGreaterThan(0);
  });

  it("costs a life when an enemy shot lands, and ends the game on the last one", () => {
    const state = playing();
    const { ship } = state;
    state.bullets = [{ x: ship.x + ship.w / 2, y: ship.y - 4, vy: 260, from: "enemy" }];
    expect(step(state, 0.03)).toContain("ship-hit");
    expect(state.lives).toBe(DEFAULT_SETTINGS.lives - 1);
    state.lives = 1;
    ship.invulnerable = 0;
    state.bullets = [{ x: ship.x + ship.w / 2, y: ship.y - 4, vy: 260, from: "enemy" }];
    expect(step(state, 0.03)).toContain("lost");
    expect(state.status).toBe("lost");
  });

  it("a shield stops hits, and a power-up is picked up by flying into it", () => {
    const state = playing();
    const { ship } = state;
    state.powerUps = [{ x: ship.x + ship.w / 2, y: ship.y + 4, kind: "shield" }];
    expect(step(state, 0.016)).toContain("power-up");
    expect(ship.shield).toBeGreaterThan(0);
    state.bullets = [{ x: ship.x + ship.w / 2, y: ship.y - 4, vy: 260, from: "enemy" }];
    expect(step(state, 0.03)).not.toContain("ship-hit");
    expect(state.lives).toBe(DEFAULT_SETTINGS.lives);
  });

  it("wins after the last wave", () => {
    const state = playing();
    startWave(state, DEFAULT_SETTINGS.waves.length - 1);
    launch(state);
    state.enemies = [{ x: 300, y: 200, w: 36, h: 24, kind: "grunt", hp: 1 }];
    state.bullets = [{ x: 318, y: 230, vy: -620, from: "ship" }];
    expect(step(state, 0.016)).toContain("won");
    expect(state.status).toBe("won");
  });
});
