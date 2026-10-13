import { describe, expect, it } from "vitest";

import { daysOf, openStatus, spanOf } from "./hours";

const restaurant = [
  { days: "Tue – Thu", time: "17:30 – 22:00" },
  { days: "Fri – Sat", time: "12:00 – 23:00" },
  { days: "Sunday", time: "12:00 – 16:00" }
];

// 2026-10-13 is a Tuesday.
const at = (day: number, time: string) => new Date(`2026-10-${String(day).padStart(2, "0")}T${time}:00`);

describe("opening hours", () => {
  it("reads day ranges, single days and every day", () => {
    expect(daysOf("Tue – Thu")).toEqual([2, 3, 4]);
    expect(daysOf("Saturday")).toEqual([6]);
    expect(daysOf("Fri - Mon").sort()).toEqual([0, 1, 5, 6]);
    expect(daysOf("Daily")).toHaveLength(7);
    expect(daysOf("Public holidays")).toEqual([]);
  });

  it("reads times, including past midnight", () => {
    expect(spanOf("17:30 – 22:00")).toEqual({ from: 1050, to: 1320 });
    expect(spanOf("20:00 – 02:00")).toEqual({ from: 1200, to: 1560 });
    expect(spanOf("Closed")).toBeNull();
  });

  it("says when it is open and until when", () => {
    expect(openStatus(restaurant, at(13, "19:00"))).toEqual({ open: true, label: "Open now · until 22:00" });
    expect(openStatus(restaurant, at(18, "13:00"))).toEqual({ open: true, label: "Open now · until 16:00" });
  });

  it("says when it opens next", () => {
    expect(openStatus(restaurant, at(13, "10:00"))).toEqual({ open: false, label: "Closed · opens today 17:30" });
    expect(openStatus(restaurant, at(13, "23:00"))).toEqual({ open: false, label: "Closed · opens tomorrow 17:30" });
    // Sunday evening: next is Tuesday (Monday is closed).
    expect(openStatus(restaurant, at(18, "18:00"))).toEqual({ open: false, label: "Closed · opens Tue 17:30" });
  });

  it("stays open past midnight on a late night", () => {
    expect(openStatus([{ days: "Friday", time: "20:00 – 02:00" }], at(17, "01:00"))).toEqual({ open: true, label: "Open now · until 02:00" });
  });

  it("has nothing to say about hours it cannot read", () => {
    expect(openStatus([{ days: "By appointment", time: "Call us" }], at(13, "10:00"))).toBeNull();
    expect(openStatus(undefined, at(13, "10:00"))).toBeNull();
  });
});
