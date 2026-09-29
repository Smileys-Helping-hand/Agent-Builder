import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { formatMoney } from "./lib/site";
import { esc, renderAt } from "./lib/testing";

const html = renderAt(<App />);

describe("landing page", () => {
  it("shows the business and its main message", () => {
    expect(html).toContain(esc(site.business.name));
    expect(html).toContain(esc(site.hero.title));
  });

  it("lists every service, plan and question from the content file", () => {
    for (const service of site.services) expect(html).toContain(esc(service.title));
    for (const plan of site.pricing) {
      expect(html).toContain(esc(plan.name));
      expect(html).toContain(formatMoney(plan.price));
    }
    for (const item of site.faq) expect(html).toContain(esc(item.q));
  });

  it("has a working contact section the navigation points at", () => {
    expect(html).toContain('id="contact"');
    expect(html).toContain("Request my quote");
    for (const link of site.nav) expect(html).toContain(`id="${link.href.slice(1)}"`);
  });

  it("labels itself a preview only while demo is on", () => {
    expect(html.includes("Template preview")).toBe(site.demo);
  });
});
