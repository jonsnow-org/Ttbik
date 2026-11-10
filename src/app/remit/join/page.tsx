import type { Metadata } from "next";
import Link from "next/link";
import ApplyForm from "@/components/remit/ApplyForm";
import { PLANS } from "@/lib/remit/listings";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "أدرج شركة التحويل أو مكتب الصرافة في صفحة الحوالات | شام AI",
  description: "شركات ومكاتب التحويل المرخّصة: اظهر لمن يقارن تكلفة حوالته في صفحة الحوالات، مع عدّاد نقرات. الدفع بـ USDT أو العملات الرقمية أو نجوم تيليجرام، والإدراج يتفعّل تلقائياً.",
  alternates: { canonical: `${SITE_URL}/remit/join` },
};

export default function RemitJoinPage() {
  const plans = (Object.keys(PLANS) as (keyof typeof PLANS)[]).map((k) => ({ key: k, ...PLANS[k] }));
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-slate-700" dir="rtl" lang="ar">
      <h1 className="text-2xl font-extrabold text-slate-900">🏦 أدرج شركتك في صفحة الحوالات</h1>
      <p className="mt-2 text-sm leading-7">صفحة <Link className="underline" href="/remit">الحوالات</Link> يزورها من يقارن تكلفة حوالته الآن. أدرج شركتك أو مكتبك المرخّص ليظهر اسمك ورابطك وبلدان التحويل، وتابع النقرات يومياً.</p>
      <ul className="mt-3 space-y-1 text-sm">
        {plans.map((p) => <li key={p.key}>• <b>{p.title}</b>: ${p.price} لـ {p.days} يوماً. {p.what}.</li>)}
      </ul>
      <ol className="mt-3 list-decimal space-y-1 pr-5 text-sm leading-7">
        <li>أرسل الطلب مع بلد الترخيص وجهته.</li>
        <li>بعد الموافقة ادفع من صفحة المتابعة (USDT TRC20 أو عملات رقمية أو نجوم).</li>
        <li>يظهر إدراجك فوراً، وينتهي تلقائياً بعد المدة مع تذكير قبلها.</li>
      </ol>
      <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs leading-6 text-amber-900">⚠️ للشركات والمكاتب المرخّصة فقط. المنصة تعرض معلوماتكم ولا تستلم أموال العملاء ولا تحوّلها ولا تضمن أي تحويل. نرفض أو نوقف أي إدراج يتبيّن أن معلوماته غير صحيحة.</p>
      <section className="mt-5 rounded-2xl border bg-white p-4"><ApplyForm plans={plans} /></section>
    </main>
  );
}
