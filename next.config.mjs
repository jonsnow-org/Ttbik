import { readFileSync } from "node:fs";

// The site's public identity comes from ONE committed file (deploy/hosting/site.json), so the Vercel build and the Oracle build always agree and
// moving behind the gate is a commit, not a dashboard edit. Empty engineUrl = no override: the environment variables (or the old defaults) apply.
let hosting = {};
try { hosting = JSON.parse(readFileSync(new URL("./deploy/hosting/site.json", import.meta.url), "utf8")); } catch { /* the file is optional */ }
const hostingEnv = {
  ...(hosting.engineUrl ? { NEXT_PUBLIC_SITE_URL: String(hosting.engineUrl).replace(/\/$/, "") } : {}),
  ...(hosting.canonicalUrl ? { NEXT_PUBLIC_CANONICAL_URL: String(hosting.canonicalUrl).replace(/\/$/, "") } : {}),
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: hostingEnv,
  images: { unoptimized: true },
  async rewrites() {
    return [
      // Fresh path so Telegram Mini App WebView loads new bundle (bypasses aggressive path cache)
      { source: "/nova", destination: "/coder-app" },
      { source: "/nova/:path*", destination: "/coder-app/:path*" },
    ];
  },   // no next/image anywhere: the image optimizer (a known attack surface of Next) is off
  // Self-hosting (Oracle, see deploy/oracle): NEXT_OUTPUT=standalone builds a
  // small self-contained server. Unset on Vercel, so nothing changes there.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
  // Owner report, 2026-09-09 ("القص لا يعمل اصلاً"): a real, well-
  // documented Vercel/Next.js gotcha — sharp ships a platform-specific
  // native binary, and without this, Next's default webpack bundling
  // for API routes can fail to trace/copy that binary into the
  // serverless function output, so sharp() throws at runtime on Vercel
  // even though it works fine locally (confirmed working here in this
  // exact sandbox). serverExternalPackages tells Next to leave sharp as
  // an external Node dependency instead of bundling it, which is the
  // standard fix (called experimental.serverComponentsExternalPackages
  // on Next 14; this project is on Next 16).
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
