import type { Metadata } from "next";
import Link from "next/link";
import { jobsBotUsername, listShops } from "@/lib/jobs/shop";
import { SITE_URL } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "متاجر البائعين",
  description: "متاجر أعضاء بوت فرص العمل والمتجر على تيليجرام: تصفّح المنتجات واطلب عبر البوت، مع دفع بضمان لبعض العروض.",
  alternates: { canonical: `${SITE_URL}/shop` },
};

export default async function ShopsDirectory() {
  const [shops, username] = await Promise.all([listShops().catch(() => []), jobsBotUsername().catch(() => "")]);
  const openShop = username ? `https://t.me/${username}` : "/bot/jobs-and-store";
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold text-slate-900">🛍 متاجر البائعين</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        كل بائع في بوت فرص العمل والمتجر له صفحة متجر يشاركها. اختر متجراً واطلب المنتج من البوت مباشرة.
      </p>
      {shops.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700 ring-1 ring-slate-200">لا توجد متاجر فيها منتجات معروضة الآن. كن أول بائع.</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {shops.map((s) => (
            <li key={s.slug}>
              <Link href={`/shop/${s.slug}`} className="block rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 hover:shadow-md">
                <span className="font-extrabold text-slate-900">{s.name}</span>
                <span className="mt-1 block text-xs text-slate-500">{[s.place, `${s.items} منتج`].filter(Boolean).join(" · ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <a href={openShop} className="mt-6 inline-block rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white">افتح متجرك في البوت</a>
    </main>
  );
}
