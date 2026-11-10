import type { Metadata } from "next";
import { weeklyGroups } from "@/lib/contests/contests";
import { activeSponsorRow, khatmaBotUsername, SPONSOR_PRODUCTS } from "@/lib/khatma/khatma";
import SponsorForm from "@/components/khatma/SponsorForm";
import { settleDueSponsors } from "@/lib/contests/prizes";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "مسابقات جروبات تيليجرام: أسئلة ولوحة صدارة أسبوعية",
  description: "أضف البوت لجروبك وابدأ جولة أسئلة بالعربي (دين، جغرافيا، تاريخ، علوم، لغة). نقاط كل الجولات تدخل صدارة أسبوعية بين كل الجروبات، والجوائز من الرعاة. اللعب مجاني.",
  alternates: { canonical: `${SITE_URL}/contests` },
};
export const dynamic = "force-dynamic";

export default async function ContestsPage() {
  void settleDueSponsors().catch(() => null); // fire-and-forget on the self-hosted server; cheap when nothing is due; the scheduled sweep does the same
  const [rows, u, sponsor] = await Promise.all([weeklyGroups().catch(() => []), khatmaBotUsername().catch(() => ""), activeSponsorRow("contest").catch(() => null)]);
  const conf = SPONSOR_PRODUCTS.contest;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">🏆 مسابقات الجروبات</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">أضف البوت لجروب الأصدقاء أو الدفعة أو القناة، وتبدأ جولة من 5 أسئلة بأزرار. كل إجابة صحيحة 10 نقاط وأول إجابة صحيحة 15. نقاط كل الجولات تدخل صدارة أسبوعية بين كل الجروبات. <b>اللعب مجاني دائماً ولا رسوم دخول</b>: الجوائز يموّلها الرعاة فقط.</p>
      {u && <a className="mt-4 inline-block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white" href={`https://t.me/${u}?startgroup=contest`}>➕ أضف البوت لجروبك</a>}
      {sponsor && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm">🎁 جائزة هذا الأسبوع برعاية <b>{sponsor.name}</b>{sponsor.prize ? `: ${sponsor.prize}` : ""} (حتى {sponsor.ends_at.toISOString().slice(0, 10)})</p>}
      <section className="mt-6">
        <h2 className="text-lg font-extrabold">📊 صدارة هذا الأسبوع</h2>
        {rows.length === 0 && <p className="mt-2 text-sm text-slate-500">لا نقاط بعد هذا الأسبوع. كن أول جروب!</p>}
        <ol className="mt-2 space-y-1 text-sm">
          {rows.slice(0, 20).map((r, i) => (
            <li key={r.chat_id} className="flex justify-between rounded-lg bg-white px-3 py-2 shadow-sm">
              <span>{i + 1}. {r.username ? <a className="text-sky-700" href={`https://t.me/${r.username}`}>{r.title || r.username}</a> : "جروب خاص"}</span>
              <span className="font-bold">{Number(r.points)} نقطة · {Number(r.players)} لاعب</span>
            </li>
          ))}
        </ol>
      </section>
      <section id="sponsor" className="mt-8 rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-extrabold">🎁 رعاية المسابقة الأسبوعية</h2>
        <p className="mb-3 mt-1 text-sm leading-7 text-slate-600">اسمك ورابطك وجائزتك في بداية كل جولة ونتائجها ولوحة الصدارة في كل الجروبات لمدة {conf.days} أيام، بـ ${conf.price}. كل شيء تلقائي: الدفع يفعّل الرعاية فوراً، وبعد نهاية المدة يختار النظام أعلى 3 لاعبين (20 نقطة على الأقل في جولتين) ويرسل لهم الجائزة بنفسه، وتظهر لك أسماؤهم في صفحة طلبك. راعٍ واحد كل أسبوع والدور يُحجز تلقائياً.</p>
        <SponsorForm price={conf.price} days={conf.days} product="contest" />
      </section>
    </main>
  );
}
