/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },   // no next/image anywhere: the image optimizer (a known attack surface of Next) is off
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
