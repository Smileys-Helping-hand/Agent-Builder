import { describe, expect, it } from "vitest";

import { addScore, loseLife, newGame } from "./rules";

describe("the rules", () => {
  it("levels up with the score", () => {
    expect(addScore(newGame(), 250).level).toBe(3);
  });
  it("ends when the lives run out", () => {
    let state = newGame();
    for (let i = 0; i < 3; i++) state = loseLife(state);
    expect(state.over).toBe(true);
  });
});
