import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { site } from "./content";
import { enableLiveCustomizing, layoutCss, listSections } from "./lib/customize";
import { enableSignature } from "./lib/pro";
import { businessSchema } from "./lib/site";
import "./styles/base.css";
import "./styles/pro.css";
import "./styles/template.css";

document.title = site.business.name;

// The business, described for Google's local results (see businessSchema).
const schema = document.createElement("script");
schema.type = "application/ld+json";
schema.textContent = businessSchema(site.business);
document.head.appendChild(schema);

/**
 * Sections glide in as they scroll into view. Only switched on when the
 * visitor has not asked for less motion, and only once the page's code is
 * running — without it, everything is simply shown.
 */
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches && "IntersectionObserver" in window) {
  document.documentElement.classList.add("motion");
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          seen.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px" }
  );
  const watch = () => document.querySelectorAll(".reveal:not(.in)").forEach((element) => seen.observe(element));
  // Pages change without a reload (#/ routes), so keep watching for new sections.
  new MutationObserver(watch).observe(document.getElementById("root")!, { childList: true, subtree: true });
  watch();
}

// The page-wide finish: the header turns to glass on scroll, cards catch the light.
enableSignature();

const root = createRoot(document.getElementById("root")!);
const draw = () =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
draw();

// The section order and hidden sections the owner chose in their dashboard
// (content.ts `layout`), applied once the page has drawn its sections.
const saved = (site as { layout?: { order?: string[]; hidden?: string[] } }).layout;
if (saved && (saved.order?.length || saved.hidden?.length)) {
  const layout = document.createElement("style");
  layout.id = "arp-saved-layout";
  document.head.appendChild(layout);
  const applyLayout = () => {
    layout.textContent = layoutCss(saved.order ?? [], saved.hidden ?? [], listSections().map((section) => section.id));
  };
  requestAnimationFrame(applyLayout);
  // Pages change without a reload (#/ routes), and the home page's sections come back with it.
  window.addEventListener("hashchange", () => requestAnimationFrame(applyLayout));
}

// Shown inside the shop's "Customise" panel, the site restyles itself as the
// customer picks colours, words and sections (see lib/customize.ts). The page
// reads its content fresh on every draw, so drawing again is all it takes.
enableLiveCustomizing(site as unknown as Record<string, unknown>, () => {
  document.title = site.business.name;
  draw();
});
