import type { Metadata } from "next";
import Link from "next/link";
import WhatsappLinkGenerator from "./WhatsappLinkGenerator";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

const PATH = "/free-tools/whatsapp-link";

export const metadata: Metadata = {
  title: "مولد رابط واتساب للطلب والشراء مجاناً | شام AI",
  description:
    "أنشئ رابط طلب واتساب احترافياً برسالة جاهزة لعملائك — مجاناً بلا تسجيل. مثالي للمتاجر الإلكترونية والتسويق عبر واتساب.",
  keywords: [
    "رابط واتساب",
    "مولد رابط واتساب",
    "رابط طلب واتساب",
    "واتساب للأعمال",
    "تسويق واتساب",
    "شام AI",
  ],
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: {
    title: "مولد رابط واتساب للطلب مجاناً",
    description: "رابط يفتح محادثة واتساب برسالة طلب معبّأة تلقائياً.",
    url: `${SITE_URL}${PATH}`,
    locale: "ar_AR",
    type: "website",
  },
};

export default function WhatsappLinkPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">مولد رابط واتساب للطلب والشراء</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        أدخل رقمك ونص الرسالة مرة واحدة واحصل على رابط جاهز للمشاركة في البايو، الإعلانات، أو بطاقة الأعمال.
        العميل يضغط فيفتح واتساب برسالة طلب معبّأة — بدون تطبيقات إضافية.
      </p>
      <div className="mt-6">
        <WhatsappLinkGenerator />
      </div>
      <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">
        <h2 className="font-extrabold text-slate-900">لماذا تستخدم رابط واتساب جاهز؟</h2>
        <ul className="mt-2 list-disc space-y-1 pr-5">
          <li>يزيد احتمال إكمال الطلب لأن الرسالة جاهزة ولا يكتب العميل من الصفر.</li>
          <li>يناسب المتاجر، الخدمات، والحجوزات عبر الجوال.</li>
          <li>مجاني 100٪ ويعمل من المتصفح فوراً.</li>
        </ul>
      </section>
      <p className="mt-6 text-sm text-slate-600">
        أدوات مكملة:{" "}
        <Link href="/free-tools/digital-card" className="font-bold text-sky-700 hover:underline">
          بطاقة أعمال رقمية
        </Link>
        {" · "}
        <Link href="/free-tools/url-shortener" className="font-bold text-sky-700 hover:underline">
          اختصار الروابط
        </Link>
        {" · "}
        <Link href="/free-tools/invoice-generator" className="font-bold text-sky-700 hover:underline">
          مولّد فواتير
        </Link>
      </p>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل مولد رابط واتساب" />
      </div>
    </div>
  );
}
