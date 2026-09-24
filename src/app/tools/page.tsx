import AdSlot from "@/components/AdSlot";
import type { Metadata } from "next";
import Link from "next/link";
import { STUDIO_TOOL_LABELS } from "@/lib/studioTools";

export const metadata: Metadata = {
  title: "أدوات الاستوديو المتقدمة | سوق تولز",
  description: "أدوات استوديو متقدمة (صوت/فيديو/صورة) بطلب مسبق — وصول دائم بعد الشراء.",
};

// This page is ONLY for "studio" tools (STUDIO_TOOL_LABELS — real,
// order-gated, permanent-access tools like the audio-visualizer). It used
// to also list the bot creator as if this were "كل الأدوات" (all tools),
// which caused real, reported confusion: three different places to
// "browse tools" (this page, the homepage's own tools section, and
// /free-tools) with this one looking broken/near-empty since only one
// bot-creator entry ever lived here. The homepage's "كل الأدوات" button
// and the header nav now both point to /free-tools instead, which is the
// actual complete, always-current list. Don't re-add the bot creator or
// free tools here — this page's only job is the paid studio catalog.
const STUDIO_ITEMS = Object.entries(STUDIO_TOOL_LABELS).map(([slug, meta]) => ({
  href: `/tools/${slug}`,
  title: meta.title,
}));

export default function ToolsHubPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <span className="inline-block rounded-full bg-violet-50 px-4 py-1.5 text-xs font-bold text-violet-700">
        🎬 أدوات الاستوديو
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">أدوات الاستوديو المتقدمة</h1>
      <p className="mt-2 text-sm text-slate-600">
        أدوات معالجة صوت/فيديو/صورة حقيقية تعمل بالكامل داخل متصفحك، بطلب مسبق ووصول دائم بعده — ليست جزءاً من
        الأدوات المجانية. تبحث عن الأدوات المجانية بلا تسجيل؟{" "}
        <Link href="/#free-tools" className="font-bold text-emerald-700 underline">
          كل الأدوات المجانية من هنا
        </Link>
        .
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {STUDIO_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 to-purple-700 p-6 text-white shadow-md transition hover:-translate-y-1 hover:shadow-xl"
          >
            <span className="text-3xl">🎬</span>
            <h3 className="mt-3 font-extrabold">{item.title}</h3>
            <span className="mt-4 inline-flex items-center gap-1 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold backdrop-blur transition group-hover:bg-white group-hover:text-violet-700">
              التفاصيل والطلب ←
            </span>
          </Link>
        ))}
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل الأدوات المتقدمة" />
      </div>
    </div>
  );
}
