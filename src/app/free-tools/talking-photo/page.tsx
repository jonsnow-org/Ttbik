import type { Metadata } from "next";
import Link from "next/link";
import TalkingPhoto from "./TalkingPhoto";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";
import ToolSeoSection from "@/components/ToolSeoSection";

const PATH = "/free-tools/talking-photo";

export const metadata: Metadata = {
  title: "تحريك صورة بالصوت: اجعل أي صورة تتكلم مجاناً | شام AI",
  description: "ارفع صورة وصوتاً (أو سجّل بصوتك) فتتحرك الصورة وكأنها تتكلم، وتنزّل فيديو قصيراً. كل شيء داخل متصفحك بلا رفع لأي خادم.",
  keywords: ["صورة تتكلم", "تحريك صورة بالصوت", "فيديو من صورة وصوت", "أداة مجانية", "شام AI"],
  alternates: {
    canonical: `${SITE_URL}${PATH}`,
    languages: { ar: `${SITE_URL}${PATH}`, en: `${SITE_URL}/en${PATH}`, "x-default": `${SITE_URL}${PATH}` },
  },
  openGraph: {
    title: "اجعل أي صورة تتكلم مجاناً | شام AI",
    description: "صورة + صوت = فيديو قصير. داخل المتصفح بلا رفع.",
    url: `${SITE_URL}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE_URL}/og/cover.jpg`, width: 1200, height: 630 }],
  },
};

export default function TalkingPhotoPage() {
  return (
    <>
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="flex items-center justify-between gap-3">
          <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل — تعمل في متصفحك</span>
          <Link href={`/en${PATH}`} className="shrink-0 text-xs font-semibold text-slate-500 hover:text-brand-700">🇬🇧 English</Link>
        </div>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">اجعل أي صورة تتكلم</h1>
        <p className="mt-2 text-slate-600">ارفع صورة شخصية أو رسماً أو شخصية خيالية، ثم أضف صوتاً مرفوعاً أو مسجّلاً، فتتحرك الصورة مع الصوت ويمكنك تنزيل الفيديو.</p>
        <div className="my-5"><AdSlot position="in-content" label="فوق أداة الصورة الناطقة" /></div>
        <TalkingPhoto lang="ar" />
        <div className="mt-8"><AdSlot position="footer-banner" label="أسفل أداة الصورة الناطقة" /></div>
        <section className="mt-10 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
          <h2 className="mb-2 text-base font-extrabold text-slate-900">استخدام مسؤول</h2>
          <p>استعمل صوراً تملكها أو شخصيات خيالية أو صور من سمح لك. لا تنتحل شخصية أحد ولا تستعمل الفيديو للخداع أو الإساءة. يحمل كل فيديو علامة «AI-generated».</p>
        </section>
      </div>
      <ToolSeoSection slug="talking-photo" />
    </>
  );
}
