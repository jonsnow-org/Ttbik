import type { Metadata } from "next";
import { auditByUsername } from "@/lib/channels/exchange";
import { GRADE_LABEL, normalizeChannel } from "@/lib/channels/auditRules";
import AuditForm from "@/components/channels/AuditForm";
import { SITE_URL } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ username: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const u = normalizeChannel(decodeURIComponent((await params).username)) || "channel";
  return {
    title: `تقرير قناة @${u}: نسبة المشاهدة والسعر العادل للإعلان`,
    description: `فحص مجاني لقناة @${u} على تيليجرام: المشاهدات الحقيقية، نسبة الوصول، وتيرة النشر، والسعر العادل لمنشور إعلاني.`,
    alternates: { canonical: `${SITE_URL}/channel-audit/${u}` },
  };
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ar-EG"));
const GRADE_COLOR: Record<string, string> = { excellent: "bg-emerald-100 text-emerald-800", good: "bg-lime-100 text-lime-800", weak: "bg-amber-100 text-amber-800", suspicious: "bg-rose-100 text-rose-800", unknown: "bg-slate-100 text-slate-700" };

export default async function ChannelAuditReport({ params }: P) {
  const raw = decodeURIComponent((await params).username);
  const r = await auditByUsername(raw).catch(() => ({ ok: false as const, error: "تعذّر الفحص الآن." }));
  if (!r.ok) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-xl font-extrabold">تعذّر فحص @{raw}</h1>
        <p className="mt-2 text-sm text-rose-700">{r.error}</p>
        <div className="mt-5"><AuditForm initial={raw} /></div>
      </main>
    );
  }
  const a = r.report;
  const share = `${SITE_URL}/channel-audit/${a.username}`;
  const shareText = `تقرير قناة @${a.username}: نسبة المشاهدة ${a.reachPct ?? "—"}% (${GRADE_LABEL[a.grade]})`;
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-xs text-slate-500">تقرير مجاني من شام AI · تقديرات من آخر {a.postsSampled} منشوراً عاماً</p>
      <h1 className="mt-1 text-2xl font-extrabold">{a.title} <span dir="ltr" className="text-base text-slate-500">@{a.username}</span></h1>
      <p className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-bold ${GRADE_COLOR[a.grade]}`}>التقييم: {GRADE_LABEL[a.grade]}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          ["المشتركون", fmt(a.subscribers)],
          ["متوسط المشاهدات (وسيط)", fmt(a.medianViews)],
          ["نسبة الوصول", a.reachPct == null ? "—" : `${a.reachPct}%`],
          ["منشورات يومياً", a.postsPerDay == null ? "—" : String(a.postsPerDay)],
          ["آخر منشور", a.lastPostAt ? a.lastPostAt.slice(0, 10) : "—"],
          ["السعر العادل لمنشور", a.priceHigh ? `$${a.priceLow}–$${a.priceHigh}` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border bg-white p-3"><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-1 text-lg font-extrabold">{v}</dd></div>
        ))}
      </dl>
      {a.notes.length > 0 && <ul className="mt-4 list-disc space-y-1 pr-5 text-sm text-slate-700">{a.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p className="mt-3 text-xs leading-6 text-slate-500">السعر العادل محسوب على 15–25 دولاراً لكل ألف مشاهدة لمنشور مباشر في قناة عربية. الأرقام تقديرية من المعاينة العامة لتيليجرام، وتُحدَّث كل 6 ساعات.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <a className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white" href={`https://t.me/share/url?url=${encodeURIComponent(share)}&text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">شارك التقرير على تيليجرام</a>
        <a className="rounded-xl border px-4 py-2 text-sm font-bold" href={`/channels#join`}>هذه قناتك؟ اعرضها واستلم إعلانات</a>
        <a className="rounded-xl border px-4 py-2 text-sm font-bold" href="/channels">أعلن في قنوات موثّقة</a>
      </div>
      <div className="mt-8"><p className="mb-2 text-sm font-bold">افحص قناة أخرى</p><AuditForm /></div>
    </main>
  );
}
