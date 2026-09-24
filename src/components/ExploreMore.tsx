import Link from "next/link";

type Section = "tools" | "prayer" | "news" | "events" | "bots";

type Item = { href: string; label: string; hint: string; section?: Section; external?: boolean };

// Cross-links between the site's sections (tools ↔ prayer times ↔ news ↔
// bots). Rendered by each section's layout.tsx so every page in it gets the
// block without touching the page files. The current section is skipped.
const ITEMS: Item[] = [
  { href: "/bashar", label: "💬 بَشَر", hint: "يجيبك إنسان لا ذكاء اصطناعي" },
  { href: "/prayer-times", label: "🕌 مواقيت الصلاة", hint: "مدينتك + عدّاد الصلاة القادمة", section: "prayer" },
  { href: "/news", label: "📰 خبر اليوم", hint: "بمصدرين + شريط عاجل", section: "news" },
  { href: "/events", label: "🗓️ أحداث ومقالات", hint: "شروحات قصيرة بمصادر", section: "events" },
  { href: "/free-tools/hijri-converter", label: "📅 محوّل الهجري والميلادي", hint: "أي تاريخ في ثانية", section: "tools" },
  { href: "/free-tools/zakat-calculator", label: "💰 حاسبة الزكاة", hint: "نقد وذهب وأسهم", section: "tools" },
  { href: "/#free-tools", label: "🎁 كل الأدوات المجانية", hint: "بلا تسجيل", section: "tools" },
  { href: "/bots", label: "🤖 منشئ البوتات", hint: "شغّل بوتك بتوكنك", section: "bots" },
  { href: "/watch-and-earn", label: "💵 اربح من الإعلانات", hint: "عبر بوت تليجرام", section: "bots" },
  { href: "https://t.me/ArabicAds_bot", label: "⬇️ بوت تحميل الوسائط", hint: "فيديو وصوت من أي منصة", external: true },
];

export default function ExploreMore({ from }: { from: Section }) {
  const items = ITEMS.filter((i) => i.section !== from);
  return (
    <nav aria-label="استكشف أيضاً" className="mx-auto max-w-4xl px-4 pb-4 pt-8" dir="rtl">
      <h2 className="mb-3 text-base font-extrabold text-slate-900">استكشف أيضاً</h2>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((i) => {
          const body = (
            <>
              <span className="block text-sm font-bold text-slate-900">{i.label}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{i.hint}</span>
            </>
          );
          const cls =
            "block h-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 transition hover:border-indigo-300 hover:bg-indigo-50";
          return (
            <li key={i.href}>
              {i.external ? (
                <a href={i.href} target="_blank" rel="noopener noreferrer" className={cls}>
                  {body}
                </a>
              ) : (
                <Link href={i.href} className={cls}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
