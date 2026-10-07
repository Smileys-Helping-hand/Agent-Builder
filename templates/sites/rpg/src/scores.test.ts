import { beforeEach, describe, expect, it } from "vitest";

import { MAX_SCORES, addScore, bestScore, clearScores, loadScores } from "./scores";

describe("the high-score table", () => {
  beforeEach(() => clearScores());

  it("starts empty", () => {
    expect(loadScores()).toEqual([]);
    expect(bestScore()).toBe(0);
  });

  it("keeps scores best first, with their place", () => {
    addScore({ name: "Ana", score: 300 });
    const { place } = addScore({ name: "Ben", score: 900, detail: "Level 3" });
    addScore({ name: "Cy", score: 500 });
    expect(place).toBe(1);
    expect(loadScores().map((entry) => entry.name)).toEqual(["Ben", "Cy", "Ana"]);
    expect(loadScores()[0].detail).toBe("Level 3");
    expect(bestScore()).toBe(900);
  });

  it("keeps only the best ten, and says when a score did not make it", () => {
    for (let i = 1; i <= MAX_SCORES; i++) addScore({ name: `P${i}`, score: i * 100 });
    expect(addScore({ name: "Low", score: 5 }).place).toBe(0);
    expect(loadScores()).toHaveLength(MAX_SCORES);
    expect(addScore({ name: "High", score: 5000 }).place).toBe(1);
    expect(loadScores().some((entry) => entry.name === "P1")).toBe(false);
  });

  it("saves a game reported twice only once", () => {
    addScore({ name: "Ana", score: 300 });
    expect(addScore({ name: "Ana", score: 300 }).place).toBe(1);
    expect(loadScores()).toHaveLength(1);
    addScore({ name: "Ana", score: 300, at: "2020-01-01T00:00:00.000Z" });
    expect(loadScores()).toHaveLength(2);
  });

  it("separate games keep separate tables", () => {
    addScore({ name: "Ana", score: 300 }, "game-a");
    expect(loadScores("game-b")).toEqual([]);
  });
});
