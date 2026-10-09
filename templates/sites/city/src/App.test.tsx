import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { DEFAULT_SETTINGS, newGame } from "./game";
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

  it("plays with the settings in content.ts", () => {
    const state = newGame(site.game);
    expect(state.settings.size).toBe(DEFAULT_SETTINGS.size);
    expect(state.cars.length).toBeGreaterThan(0);
  });
});
