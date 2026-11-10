import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { shopPage } from "@/lib/jobs/shop";
import { SITE_URL } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const slug = (await params).slug;
  const s = await shopPage(slug).catch(() => null);
  if (!s) return { title: "متجر" };
  return {
    title: `متجر ${s.name} على تيليجرام`,
    description: `${s.items.length} منتج من ${s.name}${s.place ? ` (${s.place})` : ""}. اطلب مباشرة عبر تيليجرام، والدفع يمكن أن يكون محجوزاً حتى الاستلام.`,
    alternates: { canonical: `${SITE_URL}/shop/${slug}` },
  };
}

export default async function ShopPage({ params }: P) {
  const slug = (await params).slug;
  const s = await shopPage(slug).catch(() => null);
  if (!s) notFound();
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-xs text-slate-500">متجر على تيليجرام · شام AI</p>
      <h1 className="mt-1 text-2xl font-extrabold">🏪 {s.name}</h1>
      {s.place && <p className="mt-1 text-sm text-slate-600">📍 {s.place}</p>}
      {s.shopUrl && <a className="mt-4 inline-block rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white" href={s.shopUrl}>افتح المتجر في تيليجرام</a>}
      <div className="mt-6 space-y-3">
        {s.items.length === 0 && <p className="text-sm text-slate-500">لا توجد منتجات نشطة الآن.</p>}
        {s.items.map((it) => (
          <div key={it.id} className={`rounded-2xl border bg-white p-4 ${it.featured ? "border-amber-400" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-extrabold">{it.featured ? "⭐ " : ""}{it.title}</p>
              <p className="font-bold text-emerald-700">${it.price.toFixed(2)}</p>
            </div>
            {it.description && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{it.description.slice(0, 400)}</p>}
            <p className="mt-2 text-xs text-slate-500">{it.escrow ? "💳 الدفع محجوز في البوت حتى تستلم" : "💳 الدفع يُتفق عليه مع البائع"} · {it.shipping ? "🚚 شحن" : "🤝 تسليم مباشر"}</p>
            {it.orderUrl && <a className="mt-3 inline-block rounded-xl bg-amber-500 px-3 py-1.5 text-sm font-bold text-white" href={it.orderUrl}>اطلب عبر تيليجرام</a>}
          </div>
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-slate-400">عندك ما تبيعه؟ <a className="underline" href="/bots">افتح متجرك المجاني</a></p>
    </main>
  );
}
