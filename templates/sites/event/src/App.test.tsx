import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { calendarFile, timeUntil } from "./countdown";
import { esc, renderAt } from "./lib/testing";

const html = renderAt(<App />);

describe("the invitation", () => {
  it("shows who, when and where", () => {
    expect(html).toContain(esc(site.event.title));
    expect(html).toContain(esc(site.event.dateText));
    expect(html).toContain(esc(site.venue.name));
    expect(html).toContain(esc(site.venue.address));
  });

  it("lists the whole day, every detail and every question", () => {
    for (const item of site.schedule) {
      expect(html).toContain(esc(item.time));
      expect(html).toContain(esc(item.title));
    }
    for (const detail of site.details) expect(html).toContain(esc(detail.title));
    for (const item of site.faq) expect(html).toContain(esc(item.q));
  });

  it("has an RSVP form, and every navigation link has somewhere to go", () => {
    expect(html).toContain('id="rsvp"');
    expect(html).toContain(esc(site.rsvp.submitLabel));
    expect(html).toContain("Will you be there?");
    for (const link of site.nav) expect(html).toContain(`id="${link.href.slice(1)}"`);
  });

  it("labels itself a preview only while demo is on", () => {
    expect(html.includes("Template preview")).toBe(site.demo);
  });
});

describe("the countdown", () => {
  const start = "2027-03-20T15:00:00+02:00";
  const at = new Date(start).getTime();

  it("counts whole days, hours and minutes to the start", () => {
    expect(timeUntil(start, at - (2 * 86_400_000 + 3 * 3_600_000 + 4 * 60_000))).toEqual({ days: 2, hours: 3, minutes: 4 });
  });

  it("stops once the event has started", () => {
    expect(timeUntil(start, at)).toBeNull();
    expect(timeUntil(start, at + 60_000)).toBeNull();
  });
});

describe("add to calendar", () => {
  it("makes a calendar entry with the right start, end and place", () => {
    const ics = calendarFile({ title: "A, B", startsAt: "2027-03-20T15:00:00+02:00", hours: 8, location: "Farm; Road", description: "Line one" });
    expect(ics).toContain("DTSTART:20270320T130000Z");
    expect(ics).toContain("DTEND:20270320T210000Z");
    expect(ics).toContain("SUMMARY:A\\, B");
    expect(ics).toContain("LOCATION:Farm\\; Road");
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
  });
});
