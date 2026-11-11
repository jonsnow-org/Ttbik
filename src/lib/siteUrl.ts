// The site's public base URL — ONE helper for every link the platform generates or sends (promo posts, share texts, QR codes,
// referral links, bot buttons, sitemaps, feeds). Since Vercel stopped (HTTP 402, 2026-11-11) the live site is the gate
// (deploy/hosting/site.json `gateUrl`); a ttbik*.vercel.app address — in an env var or in a stored template — is never emitted:
// it is mapped to the gate, keeping the path and query.
// NEXT_PUBLIC_CANONICAL_URL (optional) keeps the search-engine identity of the public pages (canonical links, sitemap, robots) on one
// address even when NEXT_PUBLIC_SITE_URL, the address of the bots/mini apps/payments API, points elsewhere (docs/HOSTING.md).
import site from "../../deploy/hosting/site.json";

export const GATE_URL = String((site as { gateUrl?: string }).gateUrl || "https://ttbik-gate.jonsnowx1r.workers.dev").replace(/\/+$/, "");

/** The platform's old Vercel host(s): ttbik.vercel.app and its preview aliases (ttbik-xxx.vercel.app). Not other people's vercel apps. */
const LEGACY_HOST = /^(?:https?:\/\/)?ttbik(?:-[a-z0-9-]+)?\.vercel\.app/i;
const LEGACY_IN_TEXT = /(?:https?:\/\/)?\bttbik(?:-[a-z0-9-]+)?\.vercel\.app/gi;

export function isLegacySiteUrl(u: string | null | undefined): boolean {
  return LEGACY_HOST.test(String(u || "").trim());
}
/** A configured base (env/setting) → the base to use: empty or the old Vercel host → the gate. No trailing slash. */
export function publicBase(raw: string | null | undefined): string {
  const u = String(raw || "").trim().replace(/\/+$/, "");
  return !u || isLegacySiteUrl(u) ? GATE_URL : u;
}
/** The public site base for generated links: NEXT_PUBLIC_SITE_URL, with the gate as fallback (never ttbik.vercel.app). */
export function publicSiteUrl(): string {
  return publicBase(process.env.NEXT_PUBLIC_SITE_URL);
}
/** Rewrites every ttbik*.vercel.app link inside a stored text/template to the public base, keeping path and query. */
export function rewriteLegacyLinks(text: string, base: string = publicSiteUrl()): string {
  return String(text ?? "").replace(LEGACY_IN_TEXT, base.replace(/\/+$/, ""));
}

export const SITE_URL = publicBase(process.env.NEXT_PUBLIC_CANONICAL_URL || process.env.NEXT_PUBLIC_SITE_URL);
