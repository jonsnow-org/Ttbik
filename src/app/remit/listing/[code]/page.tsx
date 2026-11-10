import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ListingDashboard from "@/components/remit/ListingDashboard";
import { listingByCode, secretOk } from "@/lib/remit/listings";
import { findAdmenBot } from "@/lib/siteAds";

export const metadata: Metadata = { title: "متابعة إدراج شركة التحويل", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

async function admenUsername(): Promise<string> {
  const bot = await findAdmenBot().catch(() => null);
  if (!bot) return "";
  const r = await fetch(`https://api.telegram.org/bot${bot.token}/getMe`, { signal: AbortSignal.timeout(5000) }).then((x) => x.json()).catch(() => null);
  return String(r?.result?.username || "");
}

export default async function ListingPage(props: { params: Promise<{ code: string }>; searchParams: Promise<{ k?: string }> }) {
  const { code } = await props.params;
  const { k = "" } = await props.searchParams;
  const l = await listingByCode(String(code || "").toUpperCase()).catch(() => null);
  if (!l || !secretOk(l, k)) notFound();
  const u = await admenUsername();
  return (
    <main className="mx-auto max-w-xl px-4 py-8 text-slate-700" dir="rtl" lang="ar">
      <h1 className="text-xl font-extrabold text-slate-900">🏦 {l.name}</h1>
      <p className="mt-1 text-xs text-slate-500" dir="ltr">{l.code} · {l.plan}</p>
      <section className="mt-4 rounded-2xl border bg-white p-4">
        <ListingDashboard code={l.code} k={k} price={l.price} linkBot={u ? `https://t.me/${u}?start=rmt_${l.code}_${l.secret}` : ""} />
      </section>
    </main>
  );
}
