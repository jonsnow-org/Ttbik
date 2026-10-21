import type { Metadata } from "next";
import { SITE_URL } from "@/lib/siteUrl";

const BRAND = "شام AI";
const SUFFIX = ` | ${BRAND}`;

/**
 * Social/SEO metadata for a free-tool page (/free-tools/<slug>).
 *
 * Why: a page that sets no `openGraph`/`twitter` inherits the root layout's,
 * so links to a tool were shared with the HOMEPAGE title, description and
 * og:url. And a page title that already ends in "| شام AI" got the root
 * template's "| شام AI" appended a second time.
 *
 * The page's own fields always win; this only fills what is missing.
 */
export function toolMeta(slug: string, meta: Metadata): Metadata {
  const url = `${SITE_URL}/free-tools/${slug}`;
  const raw = typeof meta.title === "string" ? meta.title.trim() : undefined;
  // Exactly one brand suffix, never doubled by the root "%s | شام AI" template.
  const title = raw ? (raw.endsWith(SUFFIX) ? raw : `${raw}${SUFFIX}`) : undefined;
  const description = typeof meta.description === "string" ? meta.description : undefined;
  const ownOg = (meta.openGraph ?? {}) as NonNullable<Metadata["openGraph"]>;
  const ownTw = (meta.twitter ?? {}) as NonNullable<Metadata["twitter"]>;
  const ogTitle = (ownOg.title as string | undefined) ?? title;
  const ogDescription = ownOg.description ?? description;
  const images = ownOg.images ?? [{ url: `${SITE_URL}/og/cover.jpg`, width: 1200, height: 630 }];

  return {
    ...meta,
    ...(title ? { title: { absolute: title } } : {}),
    alternates: meta.alternates ?? { canonical: url },
    openGraph: {
      type: "website",
      locale: "ar_AR",
      siteName: BRAND,
      ...ownOg,
      url: ownOg.url ?? url,
      title: ogTitle,
      description: ogDescription,
      images,
    } as Metadata["openGraph"],
    twitter: {
      card: "summary_large_image",
      ...ownTw,
      title: (ownTw.title as string | undefined) ?? ogTitle,
      description: ownTw.description ?? ogDescription,
    } as Metadata["twitter"],
  };
}
