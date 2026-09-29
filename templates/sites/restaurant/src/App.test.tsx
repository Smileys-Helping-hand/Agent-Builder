import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { formatMoney } from "./lib/site";
import { esc, renderAt } from "./lib/testing";
import { checkReservation, filterMenu, tableFromRoute } from "./menu";

const rules = site.reservations;
const now = new Date(2026, 2, 10, 9, 0); // a Tuesday morning

describe("menu filter", () => {
  it("keeps only dishes that meet every chosen need, and drops empty sections", () => {
    const vegan = filterMenu(site.menu, ["vegan"]);
    expect(vegan.every((section) => section.dishes.every((dish) => dish.diet?.includes("vegan")))).toBe(true);
    expect(vegan.some((section) => section.title === "To start")).toBe(false); // no vegan starter
  });

  it("returns the whole menu when nothing is chosen", () => {
    expect(filterMenu(site.menu, [])).toBe(site.menu);
  });
});

describe("reservations", () => {
  it("accepts a valid request", () => {
    expect(checkReservation({ date: "2026-03-12", time: rules.times[0], party: 4 }, rules, now)).toEqual([]);
  });

  it("refuses closed days, past dates, unlisted times and big groups", () => {
    expect(checkReservation({ date: "2026-03-16", time: rules.times[0], party: 2 }, rules, now)).toContain("We are closed that day.");
    expect(checkReservation({ date: "2026-03-01", time: rules.times[0], party: 2 }, rules, now)).toContain("That date has passed.");
    expect(checkReservation({ date: "2026-03-12", time: "03:00", party: 2 }, rules, now)).toContain("Choose one of the listed times.");
    expect(checkReservation({ date: "2026-03-12", time: rules.times[0], party: rules.maxParty + 1 }, rules, now)[0]).toMatch(/group booking/);
  });
});

describe("pages", () => {
  it("the home page shows the whole menu with prices", () => {
    const html = renderAt(<App />);
    for (const section of site.menu) {
      expect(html).toContain(esc(section.title));
      for (const dish of section.dishes) {
        expect(html).toContain(esc(dish.name));
        expect(html).toContain(formatMoney(dish.price));
      }
    }
    expect(html).toContain('id="book"');
  });

  it("a QR table address shows only the menu, labelled with the table", () => {
    expect(tableFromRoute("/table/12")).toBe("12");
    expect(tableFromRoute("/menu")).toBeNull();
    const html = renderAt(<App />, "#/table/12");
    expect(html).toContain("Table 12");
    expect(html).toContain(esc(site.menu[0].dishes[0].name));
    expect(html).not.toContain('id="book"');
  });
});
