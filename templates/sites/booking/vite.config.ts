import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built site works from any folder on any host:
  // a domain root, a subfolder, or a file share. Pages use hash routes (#/…)
  // for the same reason — no server rewrites to configure anywhere.
  base: process.env.BASE_PATH ?? "./",
  test: {
    environment: "node"
  }
});
