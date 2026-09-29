import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { formatMoney } from "./lib/site";
import { esc, renderAt } from "./lib/testing";
import { availableSlots, isoDate, openDays, type DayHours } from "./slots";

// A Tuesday, 09:00–17:00 with lunch 12:00–13:00.
const TUESDAY = "2026-03-10";
const hours: DayHours[] = [{ day: 2, open: "09:00", close: "17:00", breakFrom: "12:00", breakTo: "13:00" }];
const earlierDay = new Date(2026, 2, 1, 8, 0);

describe("available times", () => {
  it("offers every half hour that fits before closing, skipping lunch", () => {
    const slots = availableSlots({ date: TUESDAY, minutes: 60, hours, bookings: [], now: earlierDay });
    expect(slots[0]).toBe("09:00");
    expect(slots).toContain("11:00");
    expect(slots).not.toContain("11:30"); // would run into lunch
    expect(slots).not.toContain("12:00");
    expect(slots).toContain("13:00");
    expect(slots[slots.length - 1]).toBe("16:00"); // 60 minutes still fits
  });

  it("never offers a time that clashes with an existing booking", () => {
    const slots = availableSlots({
      date: TUESDAY,
      minutes: 60,
      hours,
      bookings: [{ date: TUESDAY, time: "10:00", minutes: 90 }],
      now: earlierDay
    });
    // The booking runs 10:00–11:30, so a one-hour slot may end at 10:00 or start at 11:30 —
    // and 11:30 would then run into lunch, so the next free start is 13:00.
    expect(slots).toContain("09:00");
    expect(slots).not.toContain("09:30");
    expect(slots).not.toContain("11:00");
    expect(slots).not.toContain("11:30");
    expect(slots).toContain("13:00");
  });

  it("does not offer times already past today, with notice", () => {
    const nowOnTuesday = new Date(2026, 2, 10, 13, 10);
    const slots = availableSlots({ date: TUESDAY, minutes: 30, hours, bookings: [], now: nowOnTuesday, leadMinutes: 60 });
    expect(slots[0]).toBe("14:30");
  });

  it("offers nothing on a closed day", () => {
    expect(availableSlots({ date: "2026-03-08", minutes: 30, hours, bookings: [], now: earlierDay })).toEqual([]);
  });

  it("lists only open days, in order", () => {
    const days = openDays(site.openingHours, 5, new Date(2026, 2, 8));
    expect(days).toHaveLength(5);
    expect(days[0]).toBe("2026-03-10"); // Sunday and Monday are closed
    expect(isoDate(new Date(2026, 2, 8))).toBe("2026-03-08");
  });
});

describe("page", () => {
  const html = renderAt(<App />);

  it("lists every service with its price and length", () => {
    for (const service of site.services) {
      expect(html).toContain(esc(service.name));
      expect(html).toContain(formatMoney(service.price));
    }
  });

  it("shows the team and the booking policies", () => {
    for (const person of site.team) expect(html).toContain(esc(person.name));
    for (const policy of site.policies) expect(html).toContain(esc(policy));
  });

  it("has the booking section the buttons point at", () => {
    expect(html).toContain('id="book"');
    expect(html).toContain("Choose a time");
  });
});
