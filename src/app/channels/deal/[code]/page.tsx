import type { Metadata } from "next";
import { dealByCode } from "@/lib/channels/exchange";
import { PayButtons } from "@/components/channels/ExchangeClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "طلب إعلان في قناة", robots: { index: false } };

const STATUS: Record<string, string> = {
  PENDING_PAYMENT: "بانتظار الدفع", PAID: "مدفوع ومحفوظ لدى المنصة. بانتظار نشر صاحب القناة.", POSTED: "نُشر، قيد التحقق.",
  VERIFIED: "تحققنا من النشر ✅", RELEASED: "مكتمل ✅", REFUNDED: "أُعيد المبلغ", CANCELLED: "ملغى",
};

export default async function DealPage({ params }: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await params).code).toUpperCase();
  const d = await dealByCode(code).catch(() => null);
  if (!d) return <main className="mx-auto max-w-xl px-4 py-8"><h1 className="text-xl font-extrabold">الطلب غير موجود</h1></main>;
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <p className="text-xs text-slate-500">احفظ هذه الصفحة لمتابعة طلبك</p>
      <h1 className="text-xl font-extrabold">{d.kind === "BADGE" ? `☑️ توثيق @${d.channel}` : `إعلان في @${d.channel}`} · {d.code}</h1>
      <p className="mt-2 text-sm">الحالة: <b>{STATUS[d.status] || d.status}</b></p>
      {d.post_link && <p className="mt-1 text-sm">المنشور: <a dir="ltr" className="text-sky-700 underline" href={d.post_link}>{d.post_link}</a></p>}
      {d.ad_text && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{d.ad_text}</p>}
      <div className="mt-4"><PayButtons code={d.code} price={d.price} done={d.status !== "PENDING_PAYMENT"} /></div>
      <p className="mt-4 text-xs leading-6 text-slate-500">الضمان: المبلغ لا يُحوَّل لصاحب القناة إلا بعد التحقق من وجود منشورك. إن لم يُنشر خلال 72 ساعة من الدفع يُعاد إليك. للتواصل راسل الأدمن مع الكود {d.code}.</p>
    </main>
  );
}
