import type { Metadata } from "next";
import { khatmaBotUsername, khatmaStats, openMemorials } from "@/lib/khatma/khatma";
import { MEMORIAL_TIERS, SPONSOR_DAYS, SPONSOR_PRICE_USD } from "@/lib/khatma/rules";
import SponsorForm from "@/components/khatma/SponsorForm";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "ختمة جماعية على تيليجرام: وزّع الأجزاء الثلاثين على مجموعتك",
  description: "بوت ختمة قرآن جماعية لمجموعات العائلة والأصدقاء والمساجد على تيليجرام: كل شخص يأخذ جزءاً بضغطة، وتصل رسالة الختم والدعاء عند اكتمال 30 جزءاً. مجاناً، مع ختمات صدقة جارية للمتوفّين.",
  alternates: { canonical: `${SITE_URL}/khatma` },
};
export const dynamic = "force-dynamic";

export default async function KhatmaHome() {
  const [u, open, stats] = await Promise.all([khatmaBotUsername().catch(() => ""), openMemorials().catch(() => []), khatmaStats().catch(() => null)]);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">📖 ختمة جماعية في مجموعتك على تيليجرام</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">أضف البوت إلى مجموعة العائلة أو الأصدقاء أو المسجد واكتب <code>/khatma</code>. تظهر لوحة الأجزاء الثلاثين، وكل شخص يأخذ جزءاً بضغطة ثم يضغطه حين ينتهي. عند اكتمال الختمة تصل رسالة الختم والدعاء، وتبدأ التالية بضغطة. مجاناً بالكامل.</p>
      {stats && stats.rounds > 0 && <p className="mt-2 text-sm font-bold text-emerald-700">🌿 حتى الآن: {stats.rounds} ختمة مكتملة · {stats.juzRead} جزءاً مقروءاً</p>}
      {u && (
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white" href={`https://t.me/${u}?startgroup=khatma`}>➕ أضف البوت إلى مجموعتك</a>
          <a className="rounded-xl border px-4 py-2 text-sm font-bold" href={`https://t.me/${u}?start=khatma`}>افتح البوت</a>
        </div>
      )}
      <section className="mt-8 rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-extrabold">🕊 ختمة صدقة جارية</h2>
        <p className="mt-1 text-sm leading-7 text-slate-600">ختمة لا تتوقف عن روح من تحب، أو بنية شفاء مريض: كلما اكتملت بدأت التالية، ولها صفحة تذكارية برابط يشارك منه الأهل والأصدقاء بالقراءة. تُطلب من داخل البوت بزر «🕊 ختمة صدقة جارية».</p>
        <ul className="mt-2 space-y-1 text-sm">{MEMORIAL_TIERS.map((t) => <li key={t.id}>⭐ <b>{t.stars}</b> نجمة: {t.label}</li>)}</ul>
      </section>
      {open.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-extrabold">ختمات مفتوحة للمشاركة</h2>
          <ul className="mt-2 space-y-2">{open.map((k) => <li key={k.slug}><a className="block rounded-xl border bg-white p-3 text-sm hover:border-emerald-400" href={`/khatma/${k.slug}`}><b>{k.title}</b> · ختمات مكتملة {k.completedRounds}</a></li>)}</ul>
        </section>
      )}
      <section id="sponsor" className="mt-8 rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-extrabold">🌙 رعاية الختمات (رمضان وغيره)</h2>
        <p className="mb-3 mt-1 text-sm leading-7 text-slate-600">سطر واحد «برعاية …» في كل رسالة ختم القرآن داخل المجموعات، وعلى لوحات الختمات وصفحاتها التذكارية، لمدة {SPONSOR_DAYS} أيام. راعٍ واحد في كل فترة، والفترات تُحجز بالتتابع.</p>
        <SponsorForm price={SPONSOR_PRICE_USD} days={SPONSOR_DAYS} />
      </section>
    </main>
  );
}
