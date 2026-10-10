import type { Metadata } from "next";
import DateClient from "./DateClient";
import { SITE_URL } from "@/lib/config";
import { TOTAL_DATES, ymd } from "@/lib/dates";

// What a shared link to a date looks like (Telegram, X, WhatsApp...): the date as the title and that date's own picture. Plain /date has none.
// (searchParams are only given to a page, not to a layout, so the metadata lives here and the interactive part in DateClient.)
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ i?: string }> }): Promise<Metadata> {
  const i = Number((await searchParams).i);
  if (!Number.isInteger(i) || i < 0 || i >= TOTAL_DATES) return {};
  const { y, m, d } = ymd(i);
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const title = `Athar · ${date}`;
  const description = `Is ${date} taken yet? Every date has one token of each kind. Claim yours: a living token that remembers its owners.`;
  const image = `${SITE_URL}/api/live/${i}.png`;
  return { title: date, description, openGraph: { type: "website", title, description, url: `${SITE_URL}/date?i=${i}`, images: [{ url: image, width: 800, height: 800 }] }, twitter: { card: "summary", title, description, images: [image] } };
}

export default function DatePage() { return <DateClient />; }
