import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Put the built JavaScript and CSS inside index.html, so the finished site is
 * one file that works everywhere — including opened straight from a folder by
 * double-clicking it.
 *
 * A normal build loads ./assets/index-abc.js with <script type="module" src>.
 * Browsers refuse that from a file on disk (a file:// page has no origin, so
 * the module request is blocked) and the page stays blank. A module written
 * inline in the page needs no request, so it runs. On a web host it makes no
 * difference: one file instead of three.
 */
function singleFile(): Plugin {
  return {
    name: "single-file",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = Object.values(bundle).find((file) => file.type === "asset" && file.fileName.endsWith(".html"));
      if (!html || html.type !== "asset") return;
      let page = String(html.source);

      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === "chunk" && file.isEntry) {
          const tag = new RegExp(`<script[^>]*src="[^"]*${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*></script>`);
          // "</script" inside the code would end the tag early; escape it.
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          page = page.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.type === "asset" && file.fileName.endsWith(".css")) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${file.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
          page = page.replace(tag, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = page;
    }
  };
}

export default defineConfig({
  plugins: [react(), singleFile()],
  // Relative paths and #/ page addresses: the site works from a domain root,
  // a subfolder, or a folder on disk, with no server configuration.
  base: process.env.BASE_PATH ?? "./",
  build: {
    // One script, no lazily loaded pieces, and small images inlined, so
    // nothing needs fetching beside index.html.
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } }
  },
  test: {
    // A browser-like document, and describe/it/test/expect without importing
    // them: generated tests are usually written that way.
    environment: "jsdom",
    globals: true
  }
});
