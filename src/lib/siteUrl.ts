// Single shared constant for the site's canonical base URL — used by pages
// that need to build absolute URLs (hreflang alternates, sitemap entries)
// instead of each repeating the same env-var + fallback + trailing-slash-
// strip logic.
// NEXT_PUBLIC_CANONICAL_URL (optional) keeps the search-engine identity of the public pages (canonical links, sitemap, robots) on one
// address even when NEXT_PUBLIC_SITE_URL, the address of the bots/mini apps/payments API, points at the gate (docs/HOSTING.md).
export const SITE_URL = (process.env.NEXT_PUBLIC_CANONICAL_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
