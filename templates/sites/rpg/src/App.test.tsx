import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { DEFAULT_SETTINGS, attack, enterFloor, flee, move, newGame, usePotion, xpToNext, type GameState } from "./game";
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

/** A one-room floor: the hero, then whatever `rest` is, in a corridor. */
const corridor = (rest: string): GameState => {
  const settings = { ...DEFAULT_SETTINGS, floors: [{ name: "Test", rows: ["#".repeat(rest.length + 3), `#@${rest}#`, "#".repeat(rest.length + 3)] }] };
  return newGame(settings);
};

describe("the RPG", () => {
  it("every floor is a closed rectangle with one start, and its stairs or boss can be reached", () => {
    DEFAULT_SETTINGS.floors.forEach((floor, i) => {
      const width = floor.rows[0].length;
      expect(floor.rows.every((row) => row.length === width)).toBe(true);
      expect(floor.rows.join("").split("@").length - 1).toBe(1);
      const goal = i === DEFAULT_SETTINGS.floors.length - 1 ? "D" : ">";
      // Walk everything that is not a wall from the start.
      const start = floor.rows.findIndex((row) => row.includes("@"));
      const seen = new Set<string>();
      const queue: [number, number][] = [[floor.rows[start].indexOf("@"), start]];
      let found = false;
      while (queue.length) {
        const [x, y] = queue.shift()!;
        const key = `${x},${y}`;
        if (seen.has(key) || floor.rows[y]?.[x] === undefined || floor.rows[y][x] === "#") continue;
        seen.add(key);
        if (floor.rows[y][x] === goal) found = true;
        queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      expect(found).toBe(true);
    });
  });

  it("walks on floor, not through walls", () => {
    const state = newGame(DEFAULT_SETTINGS);
    const { x, y } = state.hero;
    expect(move(state, 0, -1)).toEqual(["blocked"]);
    expect(move(state, 1, 0)).toEqual(["moved"]);
    expect(state.hero.x).toBe(x + 1);
    expect(state.hero.y).toBe(y);
  });

  it("picks up potions and gold on the way", () => {
    const state = corridor("p$.");
    expect(move(state, 1, 0)).toContain("potion-found");
    expect(state.hero.potions).toBe(DEFAULT_SETTINGS.hero.potions + 1);
    expect(move(state, 1, 0)).toContain("gold-found");
    expect(state.hero.gold).toBe(DEFAULT_SETTINGS.chestGold);
  });

  it("walking into a monster starts a battle, and beating it pays experience and gold", () => {
    const state = corridor("s.");
    expect(move(state, 1, 0)).toEqual(["battle"]);
    expect(state.status).toBe("battle");
    expect(move(state, 1, 0)).toEqual([]);
    let events: string[] = [];
    for (let i = 0; i < 20 && state.status === "battle"; i++) events = attack(state);
    expect(events).toContain("enemy-down");
    expect(state.status).toBe("playing");
    expect(state.hero.xp).toBe(DEFAULT_SETTINGS.monsters.s.xp);
    expect(state.hero.gold).toBe(DEFAULT_SETTINGS.monsters.s.gold);
    expect(move(state, 1, 0)).toEqual(["moved"]);
  });

  it("tells the experience to the next level from the game or from a hero", () => {
    const state = newGame(DEFAULT_SETTINGS);
    expect(xpToNext(state)).toBe(DEFAULT_SETTINGS.xpPerLevel);
    expect(xpToNext(state.hero)).toBe(DEFAULT_SETTINGS.xpPerLevel);
    expect(xpToNext({ ...state.hero, level: 3 })).toBe(DEFAULT_SETTINGS.xpPerLevel * 3);
  });

  it("levels up with enough experience: stronger and fully healed", () => {
    const state = corridor("g");
    state.hero.xp = xpToNext(state) - 1;
    state.hero.hp = 5;
    move(state, 1, 0);
    state.hero.attack = 99;
    const events = attack(state);
    expect(events).toContain("level-up");
    expect(state.hero.level).toBe(2);
    expect(state.hero.hp).toBe(state.hero.maxHp);
    expect(state.hero.maxHp).toBe(DEFAULT_SETTINGS.hero.hp + 8);
  });

  it("a potion heals, and in a battle the monster still gets its turn", () => {
    const state = corridor("o");
    state.hero.hp = 10;
    move(state, 1, 0);
    const events = usePotion(state);
    expect(events).toEqual(expect.arrayContaining(["healed", "hero-hit"]));
    expect(state.hero.potions).toBe(DEFAULT_SETTINGS.hero.potions - 1);
  });

  it("the hero falls when health runs out", () => {
    const state = corridor("D");
    state.hero.hp = 1;
    move(state, 1, 0);
    expect(attack(state)).toContain("lost");
    expect(state.status).toBe("lost");
  });

  it("there is no fleeing from the boss", () => {
    const state = corridor("D");
    move(state, 1, 0);
    expect(flee(state)).toContain("flee-failed");
    expect(state.status === "battle" || state.status === "lost").toBe(true);
  });

  it("stairs lead down, and beating the last floor's boss wins", () => {
    const state = newGame(DEFAULT_SETTINGS);
    enterFloor(state, DEFAULT_SETTINGS.floors.length - 1);
    expect(state.floor).toBe(2);
    const win = corridor("D");
    win.hero.attack = 999;
    move(win, 1, 0);
    expect(attack(win)).toContain("won");
    expect(win.status).toBe("won");
    expect(win.score).toBeGreaterThan(1000);
  });
});
