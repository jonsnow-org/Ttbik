import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { adDailyStats, totals, verifyAdReport } from "@/lib/adStats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "تقرير إعلانك", robots: { index: false, follow: false } };

const STATUS: Record<string, string> = {
  PENDING_PAYMENT: "بانتظار الدفع", PENDING_APPROVAL: "بانتظار المراجعة", ACTIVE: "نشط ✅", EXPIRED: "انتهى", REJECTED: "مرفوض",
};

export default async function AdReport({ searchParams }: { searchParams: Promise<{ c?: string; s?: string }> }) {
  const { c = "", s = "" } = await searchParams;
  const code = c.toUpperCase();
  if (!verifyAdReport(code, s)) return <main dir="rtl" className="px-4 py-16 text-center">رابط التقرير غير صالح.</main>;
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } }).catch(() => null);
  if (!ad) return <main dir="rtl" className="px-4 py-16 text-center">الإعلان غير موجود.</main>;
  const days = await adDailyStats(code);
  const t = totals(days);
  const left = ad.endsAt ? Math.max(0, Math.ceil((ad.endsAt.getTime() - Date.now()) / 86400_000)) : null;
  return (
    <main dir="rtl" className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <h1 className="text-2xl font-extrabold">📊 تقرير إعلانك {code}</h1>
      <p className="text-sm text-slate-600">{ad.altText} · <span dir="ltr">{ad.targetUrl}</span></p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl bg-slate-100 p-3"><p className="text-xs text-slate-500">الحالة</p><p className="font-bold">{STATUS[ad.adStatus] || ad.adStatus}</p></div>
        <div className="rounded-2xl bg-slate-100 p-3"><p className="text-xs text-slate-500">مشاهدات</p><p className="text-xl font-bold">{t.views}</p></div>
        <div className="rounded-2xl bg-slate-100 p-3"><p className="text-xs text-slate-500">نقرات</p><p className="text-xl font-bold">{t.clicks}</p></div>
        <div className="rounded-2xl bg-slate-100 p-3"><p className="text-xs text-slate-500">نسبة النقر</p><p className="text-xl font-bold">{t.ctr}%</p></div>
      </div>
      <p className="text-sm text-slate-600">
        {ad.startsAt ? `بدأ ${ad.startsAt.toISOString().slice(0, 10)}` : "لم يبدأ بعد"}
        {ad.endsAt ? ` · ينتهي ${ad.endsAt.toISOString().slice(0, 10)}` : ""}
        {left !== null && ad.adStatus === "ACTIVE" ? ` · بقي ${left} يوم` : ""}
      </p>
      <table className="w-full text-sm">
        <thead><tr className="text-slate-500"><th className="text-right">اليوم</th><th>مشاهدات</th><th>نقرات</th></tr></thead>
        <tbody>
          {days.map((d) => <tr key={d.day} className="border-t"><td className="py-1" dir="ltr">{d.day}</td><td className="text-center">{d.views}</td><td className="text-center">{d.clicks}</td></tr>)}
          {days.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-slate-500">لا بيانات بعد</td></tr>}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">تُحتسب مشاهدة واحدة لكل زائر كل 30 دقيقة، ولا تُحتسب زيارات البرامج الآلية. للتجديد أو التمديد: <a className="underline" href="/advertise">صفحة الإعلان</a>.</p>
    </main>
  );
}
