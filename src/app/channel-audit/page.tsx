import type { Metadata } from "next";
import AuditForm from "@/components/channels/AuditForm";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "فحص قناة تيليجرام مجاناً: هل المشتركون حقيقيون؟",
  description: "اكتب معرّف أي قناة عامة واعرف نسبة المشاهدة الحقيقية، متوسط المشاهدات، وتيرة النشر، والسعر العادل للإعلان فيها. مجاناً وبرابط قابل للمشاركة.",
  alternates: { canonical: `${SITE_URL}/channel-audit` },
};

export default function ChannelAuditHome() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-extrabold">🔎 فحص قناة تيليجرام مجاناً</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">قبل أن تدفع لإعلان في قناة: هل يشاهد المشتركون فعلاً؟ اكتب معرّف القناة العامة، وخلال ثوانٍ تحصل على نسبة الوصول، متوسط المشاهدات، وتيرة النشر، والسعر العادل لمنشور واحد. التقرير له رابط ثابت ترسله لمن تريد.</p>
      <div className="mt-5"><AuditForm /></div>
      <ul className="mt-6 list-disc space-y-1 pr-5 text-sm text-slate-600">
        <li>يعمل على القنوات العامة فقط، ويقرأ آخر المنشورات من معاينة تيليجرام العامة.</li>
        <li>نسبة مشاهدة أقل من 3% في قناة كبيرة علامة على مشتركين غير نشطين أو مشترَين.</li>
        <li>صاحب قناة؟ <a className="font-bold text-amber-700 underline" href="/channels#join">اعرض قناتك في بورصة القنوات</a> واستلم إعلانات مدفوعة مضمونة.</li>
      </ul>
    </main>
  );
}
