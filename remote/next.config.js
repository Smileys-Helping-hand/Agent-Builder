/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Everything renders in the browser and talks straight to your machine, so the
  // hosted side is static files only — no secrets ever reach Vercel.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true
};

module.exports = nextConfig;
