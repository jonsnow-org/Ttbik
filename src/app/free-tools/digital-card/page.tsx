import type { Metadata } from "next";
import Link from "next/link";
import DigitalCardForm from "./DigitalCardForm";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

const PATH = "/free-tools/digital-card";

export const metadata: Metadata = {
  title: "بطاقة أعمال رقمية مجانية (بديل Linktree) | شام AI",
  description:
    "أنشئ صفحة روابط واحدة مجاناً مثل Linktree: اسم، نبذة، صورة وأزرار روابط مع عداد مشاهدات — بلا اشتراك وبلا تسجيل.",
  keywords: [
    "بطاقة أعمال رقمية",
    "بديل Linktree",
    "صفحة روابط",
    "بطاقة أعمال مجانية",
    "شام AI",
  ],
  alternates: { canonical: `${SITE_URL}${PATH}` },
  openGraph: { images: [{ url: "/og/cover.jpg", width: 1200, height: 630 }],
    title: "بطاقة أعمال رقمية مجانية | شام AI",
    description: "صفحة روابط احترافية بعداد مشاهدات — بديل مجاني لـ Linktree.",
    url: `${SITE_URL}${PATH}`,
    locale: "ar_AR",
    type: "website",
  },
};

export default function DigitalCardPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 مجاني بالكامل — بديل Linktree
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">بطاقة أعمال رقمية مجانية</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        اجمع روابط متاجرك وواتساب وسوشيال ميديا في صفحة واحدة أنيقة. شارك الرابط في البايو واعرف عدد
        المشاهدات الحقيقي — بدون رسوم شهرية.
      </p>
      <div className="mt-8">
        <DigitalCardForm />
      </div>
      <p className="mt-6 text-sm text-slate-600">
        أكمل حضورك الرقمي:{" "}
        <Link href="/free-tools/whatsapp-link" className="font-bold text-sky-700 hover:underline">
          رابط واتساب للطلب
        </Link>
        {" · "}
        <Link href="/free-tools/qr-generator" className="font-bold text-sky-700 hover:underline">
          مولّد QR
        </Link>
        {" · "}
        <Link href="/free-tools/logo-generator" className="font-bold text-sky-700 hover:underline">
          شعار نصي عربي
        </Link>
      </p>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل نموذج البطاقة الرقمية" />
      </div>
    </div>
  );
}
