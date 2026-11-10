import type { Metadata } from "next";
import Link from "next/link";
import RemitCalculator from "@/components/remit/RemitCalculator";
import { fetchEcbRates } from "@/lib/ecbRates";
import { midRates, PROVIDERS, providerLink } from "@/lib/remit/remit";
import { SITE_URL } from "@/lib/siteUrl";

const PATH = "/remit";
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "حاسبة الحوالات: اكشف التكلفة الحقيقية لأي حوالة | شام AI",
  description: "أدخل المبلغ والرسوم وما سيستلمه المستفيد حسب عرض شركة التحويل، ونحسب لك التكلفة الحقيقية وهامش سعر الصرف المخفي مقارنة بالسعر الوسطي الرسمي. معلومات فقط، لا نستلم ولا نحوّل أموالاً.",
  alternates: { canonical: `${SITE_URL}${PATH}` },
};

export default async function RemitPage() {
  const snap = await fetchEcbRates();
  const rates = midRates(snap);
  const links = PROVIDERS.map((p) => ({ ...p, ...providerLink(p) }));
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
      <section className="mt-8">
        <h2 className="text-lg font-extrabold text-slate-900">🏦 شركات تحويل مرخّصة للمقارنة</h2>
        <p className="mt-1 text-xs text-slate-500">افتح الشركة، خذ عرضها لمبلغك، ثم ضع الرقم في الحاسبة. قارن 2-3 عروض قبل الإرسال.</p>
        <ul className="mt-3 space-y-2">
          {links.map((p) => (
            <li key={p.key} className="flex items-start justify-between gap-3 rounded-xl border bg-white p-3">
              <div><b className="text-slate-900">{p.name}</b><p className="text-xs text-slate-600">{p.note}</p></div>
              <a className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white" href={p.href} target="_blank" rel={p.sponsored ? "sponsored noopener" : "nofollow noopener"}>
                افتح {p.sponsored ? "· رابط إحالة" : ""}
              </a>
            </li>
          ))}
        </ul>
        {anySponsored && <p className="mt-2 text-xs text-slate-500">بعض الروابط روابط إحالة: قد نحصل على عمولة من الشركة دون أي تكلفة إضافية عليك، ولا يغيّر ذلك الترتيب ولا الحساب.</p>}
      </section>
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
