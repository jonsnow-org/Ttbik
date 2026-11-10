import type { Metadata } from "next";
import Link from "next/link";
import RemitCalculator from "@/components/remit/RemitCalculator";
import { fetchEcbRates } from "@/lib/ecbRates";
import { GROUP_TITLES, midRates, PROVIDERS, providerLink, type ProviderGroup } from "@/lib/remit/remit";
import { savedRefLinks } from "@/lib/remit/refLinks";
import { activeListings } from "@/lib/remit/listings";
import { SITE_URL } from "@/lib/siteUrl";

const PATH = "/remit";
export const dynamic = "force-dynamic"; // paid listings and the owner's referral links change without a redeploy

export const metadata: Metadata = {
  title: "حاسبة الحوالات: اكشف التكلفة الحقيقية لأي حوالة | شام AI",
  description: "أدخل المبلغ والرسوم وما سيستلمه المستفيد حسب عرض شركة التحويل، ونحسب لك التكلفة الحقيقية وهامش سعر الصرف المخفي مقارنة بالسعر الوسطي الرسمي. معلومات فقط، لا نستلم ولا نحوّل أموالاً.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

export default async function RemitPage() {
  const snap = await fetchEcbRates();
  const rates = midRates(snap);
  const [saved, listed] = await Promise.all([savedRefLinks().catch(() => ({})), activeListings().catch(() => [])]);
  const links = PROVIDERS.map((p) => ({ ...p, ...providerLink(p, process.env, saved) }));
  const groups = (Object.keys(GROUP_TITLES) as ProviderGroup[]).map((g) => ({ g, items: links.filter((l) => l.group === g) })).filter((x) => x.items.length);
  const anySponsored = links.some((l) => l.sponsored);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-slate-700" dir="rtl" lang="ar">
      <h1 className="text-2xl font-extrabold text-slate-900">💸 حاسبة الحوالات: كم تكلّفك الحوالة فعلاً؟</h1>
      <p className="mt-2 text-sm leading-7">كثير من العروض «بلا رسوم» تأخذ ربحها من سعر صرف أسوأ. أدخل ما تعرضه عليك شركة التحويل، ونقارنه بالسعر الوسطي الرسمي لنُظهر التكلفة الكاملة.</p>
      <p className="mt-2 rounded-lg bg-sky-50 p-2 text-xs leading-6 text-sky-900">ℹ️ هذه أداة معلومات ومقارنة فقط: <b>لا نستلم أموالك ولا نحوّلها ولا نحتفظ بها</b>. التحويل يتم مباشرة لدى الشركة المرخّصة التي تختارها.</p>
      <section className="mt-5">
        {rates.length ? <RemitCalculator rates={rates} /> : <p className="text-sm text-slate-500">تعذّر جلب الأسعار المرجعية الآن. حاول لاحقاً.</p>}
        {snap && <p className="mt-2 text-xs text-slate-500">المصدر: {snap.sourceName}، نشرة {snap.date}، مع الربط الرسمي للعملات الخليجية والدينار الأردني بالدولار. التفاصيل في <Link className="underline" href="/prices">أسعار الصرف</Link>.</p>}
      </section>
      {listed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-extrabold text-slate-900">📌 شركات ومكاتب مسجّلة لدينا</h2>
          <p className="mt-1 text-xs text-slate-500">إدراجات مدفوعة من الشركات نفسها، تُعرض كما قدّمتها مع بلد الترخيص وجهته. تحقّق من الترخيص بنفسك قبل الإرسال.</p>
          <ul className="mt-3 space-y-2">
            {listed.map((l) => (
              <li key={l.code} className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${l.plan === "FEATURED" ? "border-amber-300 bg-amber-50" : "bg-white"}`}>
                <div>
                  <b className="text-slate-900">{l.plan === "FEATURED" ? "⭐ " : ""}{l.name}</b>
                  <p className="text-xs text-slate-600">{l.country} · الترخيص: {l.license}{l.corridors ? ` · ${l.corridors}` : ""}</p>
                  <p className="text-[11px] text-slate-400">إعلان مدفوع</p>
                </div>
                <a className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white" href={`/remit/go/${l.code}`} target="_blank" rel="sponsored noopener">تواصل</a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {groups.map(({ g, items }) => (
        <section key={g} className="mt-8">
          <h2 className="text-lg font-extrabold text-slate-900">{GROUP_TITLES[g]}</h2>
          {g === "crypto" && <p className="mt-1 text-xs text-amber-800">العملات الرقمية متقلّبة وقد تكون مقيّدة في بلدك. هذه خدمات تبديل، لا تسلّم حوالة نقدية بنفسها.</p>}
          <ul className="mt-3 space-y-2">
            {items.map((p) => (
              <li key={p.key} className="flex items-start justify-between gap-3 rounded-xl border bg-white p-3">
                <div><b className="text-slate-900">{p.name}</b><p className="text-xs text-slate-600">{p.note}</p></div>
                <a className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white" href={p.href} target="_blank" rel={p.sponsored ? "sponsored noopener" : "nofollow noopener"}>
                  افتح {p.sponsored ? "· رابط إحالة" : ""}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {anySponsored && <p className="mt-2 text-xs text-slate-500">بعض الروابط روابط إحالة: قد نحصل على عمولة من الشركة دون أي تكلفة إضافية عليك، ولا يغيّر ذلك الترتيب ولا الحساب.</p>}
      <p className="mt-6 rounded-xl border border-dashed p-3 text-sm">🏦 شركة تحويل أو مكتب صرافة مرخّص؟ <Link className="font-bold text-sky-700 underline" href="/remit/join">أدرج شركتك هنا</Link> وتابع النقرات يومياً.</p>
      <section className="mt-8 text-sm leading-7">
        <h2 className="text-lg font-extrabold text-slate-900">نصائح سريعة</h2>
        <ul className="list-disc pr-5">
          <li>قارن «المبلغ الذي يستلمه المستفيد» لا الرسوم وحدها.</li>
          <li>في بلدان بسعرين (رسمي وموازٍ) استخدم الحاسبة بخيار «سأُدخل السعر بنفسي» بالسعر الذي تريد المقارنة به.</li>
          <li>لا ترسل لوسيط مجهول على تيليجرام أو واتساب يعدك بسعر أعلى من السوق: هذه أشهر طرق الاحتيال.</li>
        </ul>
      </section>
    </main>
  );
}
