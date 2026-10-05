import type { Metadata } from "next";
import { SITE_URL } from "@/lib/config";
import { TOTAL_DATES, ymd } from "@/lib/dates";

// What a shared link to a token looks like (Telegram, X, WhatsApp...): its date as the title and its own picture, as a still PNG.
export async function generateMetadata({ params }: { params: Promise<{ index: string }> }): Promise<Metadata> {
  const i = Number((await params).index);
  if (!Number.isInteger(i) || i < 0 || i >= TOTAL_DATES) return {};
  const { y, m, d } = ymd(i);
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const title = `Athar · ${date}`;
  const description = `The token of ${date}: one of a kind. It remembers everyone who owned it and matures the longer it is held.`;
  const image = `${SITE_URL}/api/live/${i}.png`;
  return { title: date, description, alternates: { canonical: `/token/${i}` }, openGraph: { type: "website", title, description, url: `${SITE_URL}/token/${i}`, images: [{ url: image, width: 800, height: 800 }] }, twitter: { card: "summary", title, description, images: [image] } };
}
export default function TokenLayout({ children }: { children: React.ReactNode }) { return children; }
