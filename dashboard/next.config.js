/** @type {import('next').NextConfig} */

// Tauri needs a directory of static files, not a Next server. Setting
// NEXT_OUTPUT=export switches the build to a static export in `out/`
// (what src-tauri/tauri.conf.json points distDir at). Left unset, the build
// stays a normal server build so `next start` keeps working.
const isStaticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export",
        // The Image Optimization API needs a server; static export has none.
        images: { unoptimized: true }
      }
    : {})
};

module.exports = nextConfig;
