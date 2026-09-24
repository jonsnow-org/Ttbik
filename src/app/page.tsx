import Link from "next/link";
import { supabasePublic } from "@/lib/supabase";
import type { Category, Service } from "@/types";
import StorefrontBrowser from "@/components/StorefrontBrowser";
import SectionBackdrop from "@/components/SectionBackdrop";
import AdSlot from "@/components/AdSlot";
import { FREE_TOOLS } from "@/lib/freeTools";

// Full literal class strings so Tailwind's scanner generates them.
const TOOL_GRADIENTS = [
  "from-emerald-500 to-teal-700",
  "from-sky-500 to-blue-700",
  "from-amber-500 to-orange-700",
  "from-rose-500 to-pink-700",
  "from-violet-500 to-purple-700",
  "from-cyan-500 to-sky-700",
  "from-fuchsia-500 to-purple-700",
  "from-lime-600 to-green-700",
];
import BotCards from "@/components/BotCards";
import TodayStrip from "@/components/TodayStrip";
import { EVENT_ITEMS } from "@/lib/eventsIndex";

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
      <TodayStrip latestEvent={EVENT_ITEMS[0] && { slug: EVENT_ITEMS[0].slug, title: EVENT_ITEMS[0].title }} />
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
            <a href="#free-tools" className="rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-bold text-emerald-700">
              الأدوات المجانية
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <AdSlot position="in-content" label="بين الترحيب والأقسام" />
      </div>

      <section id="free-tools" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-8">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">🎁 أدوات مجانية بالكامل</h2>
          <p className="mt-1 text-sm text-slate-600">بلا تسجيل، بلا حدود استخدام — جرّبها الآن مباشرة.</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {FREE_TOOLS.map((tool, index) => (
            <Link
              key={tool.href}
              href={tool.href}
              className={`flex flex-col rounded-2xl bg-gradient-to-br ${TOOL_GRADIENTS[index % TOOL_GRADIENTS.length]} p-4 text-white shadow-md transition hover:-translate-y-1 hover:shadow-xl sm:p-5`}
            >
              <h3 className="text-base font-extrabold leading-snug sm:text-lg">{tool.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-white/85 sm:text-sm">{tool.desc}</p>
            </Link>
          ))}
        </div>

        {/* Moved here from the retired /free-tools index page (2026-09-23) so
            this promo isn't lost with it. */}
        <a
          href="https://literium.ai.studio"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 flex items-center justify-between gap-4 overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-l from-brand-50 to-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <div>
            <span className="inline-block rounded-full bg-brand-100 px-2.5 py-0.5 text-[11px] font-bold text-brand-700">إعلان</span>
            <h3 className="mt-2 text-lg font-bold text-slate-900">Literium AI Studio</h3>
            <p className="mt-1 text-sm text-slate-600">literium.ai.studio</p>
          </div>
          <span className="shrink-0 rounded-full bg-brand-600 px-4 py-2 text-sm font-bold text-white">زيارة ←</span>
        </a>
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
