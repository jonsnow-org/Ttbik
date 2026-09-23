import Link from "next/link";
import { supabasePublic } from "@/lib/supabase";
import type { Category, Service } from "@/types";
import StorefrontBrowser from "@/components/StorefrontBrowser";
import SectionBackdrop from "@/components/SectionBackdrop";
import AdSlot from "@/components/AdSlot";
import { FREE_TOOLS, getFreeToolTheme } from "@/lib/freeTools";
import BotCards from "@/components/BotCards";

export const revalidate = 30;

async function getStorefront() {
  try {
    const db = supabasePublic();
    const [{ data: categories }, { data: services }] = await Promise.all([
      db.from("categories").select("*").order("sort_order"),
      db.from("services").select("*").eq("is_active", true).order("sort_order"),
    ]);
    return {
      categories: (categories ?? []) as Category[],
      services: (services ?? []) as Service[],
    };
  } catch {
    // Avoid failing the whole production deploy when env/DB is briefly unavailable at build.
    return { categories: [] as Category[], services: [] as Service[] };
  }
}

export default async function HomePage() {
  const { categories, services } = await getStorefront();
  const visible = categories.filter((c) => ["telegram-bots", "creative-studio"].includes(c.slug));

  return (
    <div>
      <section className="relative overflow-hidden bg-hero-glow bg-white">
        <SectionBackdrop />
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-14 text-center sm:pb-14 sm:pt-20">
          <span className="inline-block rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700">
            أدوات تعمل فعلياً — وليست ملفات للتحميل
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-3xl font-extrabold leading-tight text-slate-900 sm:text-5xl">
            شغّل بوت تليجرام بتوكنك، أو استخدم أداة داخل المتصفح
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-slate-600 sm:text-lg">
            منشئ البوتات يستضيف القالب على الموقع. روابط الإيداع والسحب تُولَّد من هنا وتربط رصيد البوت بتحويل بنكي أو USDT بعد المراجعة.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href="/bots" className="rounded-full bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-800">
              منشئ البوتات
            </Link>
            <Link href="/free-tools" className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-bold text-emerald-700">
              كل الأدوات المجانية
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <AdSlot position="in-content" label="بين الترحيب والأقسام" />
      </div>

      <section className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">🎁 أدوات مجانية بالكامل</h2>
            <p className="mt-1 text-sm text-slate-600">بلا تسجيل، بلا حدود استخدام — جرّبها الآن مباشرة.</p>
          </div>
          <Link href="/free-tools" className="text-sm font-bold text-brand-700 hover:text-brand-800">
            كل الأدوات ←
          </Link>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FREE_TOOLS.map((tool, index) => {
            const theme = getFreeToolTheme(index);
            return (
              <Link
                key={tool.href}
                href={tool.href}
                className={`group rounded-2xl border ${theme.border} ${theme.bg} p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
              >
                <span className={`inline-block rounded-full ${theme.badgeBg} px-2.5 py-0.5 text-[11px] font-bold ${theme.badgeText}`}>
                  مجاني
                </span>
                <h3 className={`mt-2 font-bold text-slate-900 ${theme.hoverText}`}>{tool.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{tool.desc}</p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">🤖 جرّب بوتاتنا الآن على تليجرام</h2>
          <p className="mt-1 text-sm text-slate-600">بوتات حقيقية تعمل الآن — افتحها وجرّبها مباشرة.</p>
        </div>
        <BotCards />
      </section>

      {visible.length > 0 && <StorefrontBrowser categories={visible} services={services} />}
    </div>
  );
}
