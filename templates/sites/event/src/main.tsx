import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { site } from "./content";
import { businessSchema } from "./lib/site";
import "./styles/base.css";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
