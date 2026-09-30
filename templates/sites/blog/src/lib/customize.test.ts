import { describe, expect, it } from "vitest";

import { applyPatch, describeFields, layoutCss } from "./customize";

const sample = () => ({
  business: { name: "Old name", tagline: "t", email: "a@b.co" },
  hero: { title: "Old title", subtitle: "s" },
  brand: { primary: "#111111", accent: "#222222", font: "system-ui" },
  secret: { price: 100 }
});

describe("live customising", () => {
  it("changes only the fields a customer may edit", () => {
    const content = sample();
    const changed = applyPatch(content, { "business.name": "New name", "hero.title": "New title", "secret.price": "0", "__proto__.x": "y" });
    expect(changed).toEqual(["business.name", "hero.title"]);
    expect(content.business.name).toBe("New name");
    expect(content.hero.title).toBe("New title");
    expect(content.secret.price).toBe(100);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("accepts only real colours for colour fields", () => {
    const content = sample();
    applyPatch(content, { "brand.primary": "#0a7f5a", "brand.accent": "red; background:url(x)" });
    expect(content.brand.primary).toBe("#0a7f5a");
    expect(content.brand.accent).toBe("#222222");
  });

  it("describes only the fields this template actually has", () => {
    const paths = describeFields(sample()).map((field) => field.path);
    expect(paths).toContain("hero.title");
    expect(paths).not.toContain("business.phone");
  });

  it("orders and hides sections without letting an id inject CSS", () => {
    const css = layoutCss(["pricing", "faq", "x{}body{display:none"], ["contact"]);
    expect(css).toContain("#pricing { order: 100; }");
    expect(css).toContain("#faq { order: 101; }");
    expect(css).toContain("#contact { display: none !important; }");
    expect(css).not.toContain("body{display:none");
  });

  it("keeps sections left out of a partial order below the ones named", () => {
    const css = layoutCss(["pricing"], [], ["services", "pricing", "faq"]);
    expect(css).toContain("#pricing { order: 100; }");
    expect(css).toContain("#services { order: 101; }");
    expect(css).toContain("#faq { order: 102; }");
  });
});
