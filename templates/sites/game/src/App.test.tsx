import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { POINTS, bricksFor, launch, movePaddle, newGame, startLevel, step, type GameSettings } from "./game";
import { esc, renderAt } from "./lib/testing";

const settings: GameSettings = { ...site.game };

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
    expect(html).toContain(site.prize.threshold.toLocaleString());
    expect(html).not.toContain(esc(site.prize.submitLabel));
    const unlocked = renderAt(<App />, "#/", { "best-score": site.prize.threshold });
    expect(unlocked).toContain(esc(site.prize.submitLabel));
  });

  it("labels itself a preview only while demo is on", () => {
    expect(html.includes("Template preview")).toBe(site.demo);
  });
});

describe("the game", () => {
  it("lays out one brick per digit, with gaps where the level has dots", () => {
    const bricks = bricksFor({ name: "t", rows: ["1.2", "3.."] }, 300);
    expect(bricks.map((brick) => brick.hits)).toEqual([1, 2, 3]);
    expect(bricks.every((brick) => brick.x >= 0 && brick.x + brick.w <= 300)).toBe(true);
  });

  it("waits on the paddle until launched, and the ball rides along", () => {
    const state = newGame(settings);
    movePaddle(state, 100);
    expect(state.status).toBe("ready");
    expect(state.ball.x).toBeCloseTo(state.paddle.x + state.paddle.w / 2);
    expect(step(state, 0.5)).toEqual([]);
    launch(state);
    expect(state.status).toBe("playing");
    expect(state.ball.vy).toBeLessThan(0);
  });

  it("keeps the paddle on the board", () => {
    const state = newGame(settings);
    movePaddle(state, -500);
    expect(state.paddle.x).toBe(0);
    movePaddle(state, 5000);
    expect(state.paddle.x + state.paddle.w).toBe(settings.width);
  });

  it("scores a broken brick by how tough it was", () => {
    const state = newGame(settings);
    state.bricks = [{ x: 300, y: 100, w: 40, h: 20, hits: 1, toughness: 2 }, { x: 10, y: 10, w: 20, h: 20, hits: 1, toughness: 1 }];
    state.status = "playing";
    state.ball = { x: 320, y: 140, vx: 0, vy: -300, r: 8 };
    const events = step(state, 0.2);
    expect(events).toContain("brick");
    expect(state.score).toBe(POINTS[2]);
    expect(state.ball.vy).toBeGreaterThan(0);
  });

  it("clears a level when the last brick breaks, then starts the next", () => {
    const state = newGame(settings);
    state.bricks = [{ x: 300, y: 100, w: 40, h: 20, hits: 1, toughness: 1 }];
    state.status = "playing";
    state.ball = { x: 320, y: 140, vx: 0, vy: -300, r: 8 };
    expect(step(state, 0.2)).toContain("level-cleared");
    startLevel(state, 1);
    expect(state.level).toBe(1);
    expect(state.bricks.length).toBeGreaterThan(0);
    expect(state.status).toBe("ready");
  });

  it("costs a life when the ball is missed, and ends the game on the last one", () => {
    const state = newGame(settings);
    state.status = "playing";
    state.ball = { x: 50, y: settings.height - 5, vx: 0, vy: 400, r: 8 };
    state.paddle.x = 400;
    expect(step(state, 0.1)).toContain("life-lost");
    expect(state.lives).toBe(settings.lives - 1);

    state.lives = 1;
    state.status = "playing";
    state.ball = { x: 50, y: settings.height - 5, vx: 0, vy: 400, r: 8 };
    expect(step(state, 0.1)).toContain("lost");
    expect(state.status).toBe("lost");
  });

  it("bounces off the paddle upwards", () => {
    const state = newGame(settings);
    state.status = "playing";
    state.bricks = [{ x: 0, y: 0, w: 10, h: 10, hits: 3, toughness: 3 }];
    state.ball = { x: state.paddle.x + state.paddle.w / 2, y: state.paddle.y - 10, vx: 0, vy: 300, r: 8 };
    expect(step(state, 0.05)).toContain("paddle");
    expect(state.ball.vy).toBeLessThan(0);
  });
});
