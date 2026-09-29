import { describe, expect, it } from "vitest";

import App from "./App";
import { site } from "./content";
import { esc, renderAt } from "./lib/testing";
import { allTags, period, projectsTagged, timeline } from "./work";

describe("work", () => {
  it("lists tags by how often they are used", () => {
    const tags = allTags(site.projects);
    expect(tags[0]).toBe("Brand"); // Brand and Product both appear twice; Brand sorts first
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("filters by tag and shows newest first", () => {
    const product = projectsTagged(site.projects, "Product");
    expect(product.every((project) => project.tags.includes("Product"))).toBe(true);
    const all = projectsTagged(site.projects, "All");
    expect(all).toHaveLength(site.projects.length);
    expect(all[0].year).toBeGreaterThanOrEqual(all[all.length - 1].year);
  });

  it("puts the current role first and describes periods", () => {
    expect(timeline(site.experience)[0].end).toBeNull();
    expect(period({ start: 2020, end: null, title: "", place: "", text: "" })).toBe("2020 – now");
  });
});

describe("pages", () => {
  it("the home page shows every project", () => {
    const html = renderAt(<App />);
    for (const project of site.projects) expect(html).toContain(esc(project.title));
  });

  it("each project has its own page with its outcome", () => {
    const [first] = site.projects;
    const html = renderAt(<App />, `#/work/${first.id}`);
    expect(html).toContain(esc(first.outcome));
    for (const paragraph of first.story) expect(html).toContain(esc(paragraph));
  });

  it("about shows the timeline, contact shows the form", () => {
    const about = renderAt(<App />, "#/about");
    for (const role of site.experience) expect(about).toContain(esc(role.title));
    expect(renderAt(<App />, "#/contact")).toContain("Send enquiry");
  });

  it("an unknown project falls back to the work page", () => {
    expect(renderAt(<App />, "#/work/nope")).toContain("Selected work");
  });
});
