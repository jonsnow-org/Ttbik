import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import AdsterraNative from "@/components/AdsterraNative";
import SectionBackdrop from "@/components/SectionBackdrop";
import { FREE_TOOLS, getFreeToolTheme } from "@/lib/freeTools";
import { LIVE_BOTS } from "@/lib/liveBots";

export const metadata: Metadata = {
  title: "أدوات مجانية | سوق تولز",
  description: "أدوات مجانية بالكامل لأصحاب المشاريع الصغيرة، بلا تسجيل وبلا حدود استخدام.",
};

const TOOLS = FREE_TOOLS;

export default function FreeToolsPage() {
  return (
    <div className="relative mx-auto max-w-5xl px-4 py-12">
      <SectionBackdrop tone="free-tools" />

      {/* Hero header */}
      <div className="mb-10 text-center">
        <span className="inline-block rounded-full bg-emerald-50 px-4 py-1.5 text-xs font-bold text-emerald-700">
          🎁 مجاني بالكامل — بلا تسجيل
        </span>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          أدوات مجانية حقيقية
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600">
          أدوات تعمل مباشرة داخل متصفحك — بدون حدود استخدام وبدون رفع ملفات لخوادمنا.
          صُممت لأصحاب المشاريع والمستقلين في الوطن العربي.
        </p>
      </div>

      {/* Promo card */}
      <a
        href="https://literium.ai.studio"
        target="_blank"
        rel="noopener noreferrer"
        className="mb-10 flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-l from-brand-50 to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <div>
          <span className="inline-block rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-bold text-brand-700">
            إعلان
          </span>
          <h2 className="mt-2 text-lg font-bold text-slate-900">Literium AI Studio</h2>
          <p className="mt-1 text-sm text-slate-600">literium.ai.studio</p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white">
          زيارة ←
        </span>
      </a>

      {/* Tools grid — stronger cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool, index) => {
          const theme = getFreeToolTheme(index);
          return (
            <Link
              key={tool.href}
              href={tool.href}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border ${theme.border} ${theme.bg} p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg`}
            >
              <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l ${theme.accent}`} />
              <span className={`inline-flex w-fit items-center rounded-full ${theme.badgeBg} px-2.5 py-1 text-[11px] font-bold ${theme.badgeText}`}>
                مجاني
              </span>
              <h2 className={`mt-3 text-base font-extrabold leading-snug text-slate-900 ${theme.hoverText}`}>
                {tool.title}
              </h2>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">{tool.desc}</p>
              <span className={`mt-4 inline-flex items-center gap-1 text-sm font-bold ${theme.badgeText} opacity-80 transition group-hover:opacity-100`}>
                افتح الأداة
                <span className="transition group-hover:-translate-x-0.5">←</span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="mt-10">
        <AdSlot position="in-content" label="بين الأدوات والبوتات" />
      </div>

      <div className="mt-6">
        <AdsterraNative />
      </div>

      {/* Live bots section */}
      <div className="mt-14">
        <h2 className="text-xl font-extrabold text-slate-900">🤖 جرّب بوتاتنا الآن على تليجرام</h2>
        <p className="mt-1 text-sm text-slate-600">
          بوتات حقيقية تعمل الآن — افتحها وجرّبها مباشرة على تليجرام.
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {LIVE_BOTS.map((bot) => (
            <a
              key={bot.href}
              href={bot.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-sky-300 hover:shadow-lg"
            >
              <span className="inline-flex w-fit items-center rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold text-sky-700">
                افتح على تليجرام
              </span>
              <h2 className="mt-3 text-base font-extrabold text-slate-900 group-hover:text-brand-700">
                {bot.title}
              </h2>
              <p className="mt-2 flex-1 text-sm text-slate-500">{bot.desc}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-sky-600">
                فتح البوت ←
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
