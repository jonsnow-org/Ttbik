import Link from "next/link";
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
import SectionBackdrop from "@/components/SectionBackdrop";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { latestNewsItem } from "@/lib/newsItems";

export const revalidate = 30;

const ATHAR_APP_URL = (process.env.NEXT_PUBLIC_ATHAR_URL || "https://athar.89-168-89-15.sslip.io").replace(/\/$/, "");
const ATHAR_BOT_URL = (process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot").trim();

export default async function HomePage() {
  const news = latestNewsItem();

  return (
    <div>
      <a href="/advertise" className="mx-auto mt-3 block max-w-6xl rounded-2xl bg-amber-400 px-4 py-4 text-center text-base font-extrabold text-slate-950">
        أعلن هنا — احجز ظهور بنرك في كل الصفحات
      </a>
      <TodayStrip
        latestEvent={EVENT_ITEMS[0] && { slug: EVENT_ITEMS[0].slug, title: EVENT_ITEMS[0].title }}
        latestNews={news && { slug: news.slug, title: news.title }}
      />
      <section className="mx-auto max-w-6xl px-4 pt-4">
        <div className="rounded-2xl bg-gradient-to-l from-sky-700 to-indigo-900 p-5 text-white shadow-lg">
          <span className="rounded-full bg-sky-300/25 px-2.5 py-0.5 text-[11px] font-bold text-sky-100">مدونة · أخبار · أحداث · مقالات</span>
          <h2 className="mt-2 text-lg font-extrabold sm:text-xl">مركز المدونة والأخبار</h2>
          <p className="mt-1 text-xs text-white/80 sm:text-sm">
            أخبار عاجلة، أحداث يومية، ومقالات هادفة — اختر القسم مباشرة.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/news" className="rounded-full bg-white px-4 py-2 text-sm font-extrabold text-slate-900">
              📰 الأخبار
            </Link>
            <Link href="/events" className="rounded-full border border-white/50 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/20">
              🗓️ الأحداث
            </Link>
            <Link href="/articles" className="rounded-full border border-white/50 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/20">
              ✍️ المقالات
            </Link>
            <Link href="/digest" className="rounded-full border border-white/50 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/20">
              ☀️ ملخص اليوم
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-4">
        <div className="flex flex-col gap-4 rounded-2xl bg-gradient-to-l from-amber-600 to-slate-900 p-5 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="rounded-full bg-amber-300/25 px-2.5 py-0.5 text-[11px] font-bold text-amber-100">رموز · شبكة TON · Gram</span>
            <h2 className="mt-2 text-lg font-extrabold sm:text-xl">🕰 أثر: رمز واحد لكل يوم في التقويم</h2>
            <p className="mt-1 text-xs text-white/80 sm:text-sm">
              يوم ميلادك أو زواجك أو يوم تحبه، رمز حيّ يومض ويدور وينضج كلما طال بقاؤه عندك، يعدّ أصحابه ويحفظ ما يُنقش عليه.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <a href={ATHAR_APP_URL} className="rounded-full bg-white px-4 py-2 text-sm font-extrabold text-slate-900">افتح أثر ←</a>
            {ATHAR_BOT_URL && <a href={ATHAR_BOT_URL} className="rounded-full border border-white/60 px-4 py-2 text-sm font-bold text-white">بوت تيليجرام</a>}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-hero-glow bg-white">
        <SectionBackdrop />
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 pt-12 sm:pb-14 sm:pt-16 md:grid-cols-2">
          <div className="text-center md:text-right">
            <span className="inline-block rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700">
              أدوات تعمل فعلياً — وليست ملفات للتحميل
            </span>
            <h1 className="mt-5 text-3xl font-extrabold leading-tight text-slate-900 sm:text-5xl">
              أدوات عربية مجانية تعمل فوراً
            </h1>
            <p className="mt-4 text-base text-slate-600 sm:text-lg">
              احسب، حوّل، وصمّم مباشرة من المتصفح، بلا تسجيل ولا تحميل — وتصفّح بوتاتنا الجاهزة أدناه.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3 md:justify-start">
              <a href="#free-tools" className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">
                🎁 ابدأ بالأدوات المجانية
              </a>
              <Link href="/bots" className="rounded-full border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-bold text-indigo-700">
                🤖 منشئ البوتات
              </Link>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-md">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/img/phone-apps.jpg" alt="هاتف يعرض تطبيقات التواصل وتليجرام" width={1000} height={667} className="h-64 w-full rounded-3xl object-cover shadow-2xl ring-1 ring-slate-200 sm:h-80" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-6">
        <AdSlot position="in-content" label="بين الترحيب والأقسام" />
      </div>

      <section id="free-tools" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-8">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/code.jpg" alt="" loading="lazy" className="mb-4 h-28 w-full rounded-2xl object-cover sm:h-36" />
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
        <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">لماذا شام AI؟</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {[
            { img: "/img/community.jpg", alt: "أصدقاء يعملون معاً", t: "مجاني وبلا تسجيل", d: "أدوات حسابية وتصميمية تعمل فوراً داخل المتصفح، بدون حساب وبدون حدود استخدام." },
            { img: "/img/analytics.jpg", alt: "لوحة إحصائيات", t: "عربية وسريعة على الجوال", d: "واجهات عربية بالكامل تعمل بسلاسة على أي هاتف، مع نتائج فورية ومشاركة بضغطة واحدة." },
            { img: "/img/payment.jpg", alt: "دفع إلكتروني", t: "دفع موحّد وواضح", d: "عملات رقمية أو نجوم تليجرام بخطوات واحدة في كل البوتات، ويُضاف الرصيد تلقائياً." },
          ].map((f) => (
            <div key={f.t} className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.img} alt={f.alt} loading="lazy" width={900} height={600} className="h-40 w-full object-cover" />
              <div className="p-4">
                <h3 className="font-extrabold text-slate-900">{f.t}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{f.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 sm:text-2xl">🤖 جرّب بوتاتنا الآن على تليجرام</h2>
          <p className="mt-1 text-sm text-slate-600">بوتات حقيقية تعمل الآن — افتحها وجرّبها مباشرة.</p>
        </div>
        <BotCards />
      </section>
    </div>
  );
}
