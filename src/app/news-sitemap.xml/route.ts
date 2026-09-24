import { NextResponse } from "next/server";
import { newsSitemapEntries } from "@/lib/newsItems";
import { SITE_URL } from "@/lib/siteUrl";

export const revalidate = 600;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function GET() {
  const items = newsSitemapEntries();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n` +
    items
      .map(
        (item) =>
          `  <url>\n` +
          `    <loc>${xmlEscape(`${SITE_URL}${item.path}`)}</loc>\n` +
          `    <news:news>\n` +
          `      <news:publication>\n` +
          `        <news:name>سوق تولز</news:name>\n` +
          `        <news:language>ar</news:language>\n` +
          `      </news:publication>\n` +
          `      <news:publication_date>${item.dateIso}</news:publication_date>\n` +
          `      <news:title>${xmlEscape(item.title)}</news:title>\n` +
          `    </news:news>\n` +
          `  </url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
