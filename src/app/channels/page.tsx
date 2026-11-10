import type { Metadata } from "next";
import { publicListings } from "@/lib/channels/exchange";
import { GRADE_LABEL, type Grade } from "@/lib/channels/auditRules";
import { JoinForm, OrderForm } from "@/components/channels/ExchangeClient";
import AuditForm from "@/components/channels/AuditForm";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "بورصة القنوات: إعلانات تيليجرام بضمان الدفع",
  description: "أعلن في قنوات تيليجرام عربية بأرقام مشاهدة مفحوصة، وادفع بضمان: المبلغ محفوظ حتى يُنشر إعلانك ونتحقق منه. وأصحاب القنوات يستلمون 85% من كل صفقة.",
  alternates: { canonical: `${SITE_URL}/channels` },
};
export const dynamic = "force-dynamic";

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("ar-EG"));

export default async function ChannelsExchange() {
  const listings = await publicListings().catch(() => []);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">📣 بورصة القنوات</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">إعلانات في قنوات تيليجرام عربية بأرقام مفحوصة. ادفع بالنجوم أو العملات الرقمية، والمبلغ يبقى لدى المنصة حتى يُنشر إعلانك ونتحقق من المنشور. لم يُنشر؟ يُعاد إليك.</p>
      <section className="mt-5 rounded-2xl border bg-white p-4">
        <p className="mb-2 text-sm font-bold">🔎 افحص أي قناة مجاناً قبل أن تدفع</p>
        <AuditForm />
      </section>
      <section className="mt-6" aria-label="القنوات المعروضة">
        <h2 className="text-lg font-extrabold">القنوات المعروضة</h2>
        {listings.length === 0 && <p className="mt-2 text-sm text-slate-500">البورصة جديدة. كن أول قناة معروضة من الأسفل.</p>}
        <div className="mt-3 space-y-3">
          {listings.map((l) => (
            <div key={l.username} className="rounded-2xl border bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-extrabold">{l.verifiedUntil ? "☑️ " : ""}{l.title} <a dir="ltr" className="text-sm text-sky-700" href={`https://t.me/${l.username}`} target="_blank" rel="noopener noreferrer">@{l.username}</a></p>
                  <p className="text-xs text-slate-500">مشتركون {fmt(l.subscribers)} · مشاهدات المنشور {fmt(l.medianViews)} · وصول {l.reachPct ?? "—"}% ({GRADE_LABEL[l.grade as Grade] || "—"}) · <a className="underline" href={`/channel-audit/${l.username}`}>التقرير</a></p>
                </div>
              </div>
              <OrderForm listing={{ ...l, gradeLabel: GRADE_LABEL[l.grade as Grade] || "" }} />
            </div>
          ))}
        </div>
      </section>
      <section id="join" className="mt-8 rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-extrabold">صاحب قناة؟ اعرضها مجاناً</h2>
        <p className="mb-3 mt-1 text-sm text-slate-600">حدد سعر منشورك، أثبت ملكيتك بكود صغير في الوصف، واستلم طلبات مدفوعة مسبقاً. تستلم 85% بعد التحقق من النشر.</p>
        <JoinForm />
      </section>
    </main>
  );
}
