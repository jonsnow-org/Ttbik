/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Owner report, 2026-09-09 ("القص لا يعمل اصلاً"): a real, well-
  // documented Vercel/Next.js gotcha — sharp ships a platform-specific
  // native binary, and without this, Next's default webpack bundling
  // for API routes can fail to trace/copy that binary into the
  // serverless function output, so sharp() throws at runtime on Vercel
  // even though it works fine locally (confirmed working here in this
  // exact sandbox). serverComponentsExternalPackages tells Next to
  // leave sharp as an external Node dependency instead of bundling it,
  // which is the standard fix (Next 15 renamed this to the top-level
  // serverExternalPackages; this project is on Next 14.2, where it's
  // still under experimental).
  experimental: {
    serverComponentsExternalPackages: ["sharp"],
  },
};

export default nextConfig;
