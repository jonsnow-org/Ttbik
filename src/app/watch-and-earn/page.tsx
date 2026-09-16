import type { Metadata } from "next";
import { LIVE_BOTS } from "@/lib/liveBots";

export const metadata: Metadata = {
  title: "الربح من مشاهدة الإعلانات على تليجرام | سوق تولز",
  description:
    "اربح مالاً حقيقياً من مشاهدة الإعلانات عبر بوت تليجرام مجاني — بلا استثمار، سحب حقيقي عبر تحويل بنكي أو USDT. اعرف كيف يعمل بالتفصيل.",
  alternates: { canonical: "/watch-and-earn" },
};

// A real content/SEO landing page for AD_BOT's "watch & earn" feature —
// distinct from /bots (which is for someone who wants to RUN their own
// bot instance). This page targets a different, much higher-search-volume
// audience: people looking to earn as a USER of an existing bot. Owner
// directive (2026-09-16): invent real ways to grow site traffic within my
// own section; this is a new branch under "قسم البوتات" — see
// components/MobileNav.tsx, which links here.
const FAQ = [
  {
    q: "هل الربح من مشاهدة الإعلانات حقيقي فعلاً؟",
    a: "نعم — تشاهد إعلاناً حقيقياً (قناة تليجرام، رابط، فيديو) لمدة محددة، ويُضاف لك نصيبك من قيمة ذلك الإعلان فوراً إلى رصيدك داخل البوت. لا حدّ أدنى وهمي، ولا شروط مخفية.",
  },
  {
    q: "كيف أسحب أرباحي؟",
    a: "من قسم «المحفظة» داخل البوت — تطلب السحب، ويُحوَّل لك المبلغ عبر تحويل بنكي أو USDT بعد مراجعة سريعة من الفريق.",
  },
  {
    q: "هل أحتاج لدفع أي مبلغ للبدء؟",
    a: "لا إطلاقاً. المشاهدة والربح مجانيان بالكامل لأي مستخدم. الدفع مطلوب فقط من صاحب الإعلان نفسه (من يريد الترويج لقناته أو منتجه)، وليس ممن يشاهد ويربح.",
  },
  {
    q: "هل يمكنني ربح المزيد بدعوة أصدقائي؟",
    a: "نعم — لديك رابط إحالة خاص بك، وتربح 5% إضافية من أرباح كل شخص تدعوه من كل مهمة يُنجزها، مدى الحياة، بلا حد أقصى.",
  },
];

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function WatchAndEarnPage() {
  const botLink = LIVE_BOTS[0]?.href;

  return (
    <div className="relative mx-auto max-w-3xl px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }} />
      <span className="inline-block rounded-full bg-indigo-50 px-4 py-1.5 text-xs font-bold text-indigo-700">
        💰 اربح مالاً حقيقياً
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-4xl">
        الربح من مشاهدة الإعلانات على تليجرام — مجاني بالكامل
      </h1>
      <p className="mt-4 text-base text-slate-600 sm:text-lg">
        بوت حقيقي يعمل الآن على تليجرام: شاهد إعلانات (قنوات، روابط، فيديوهات) لثوانٍ معدودة، واربح نصيبك من قيمة كل
        إعلان فوراً في رصيدك — بلا استثمار، بلا اشتراك، بلا رسوم خفية.
      </p>

      {botLink && (
        <a
          href={botLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-indigo-700 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-indigo-800 hover:shadow-lg"
        >
          🤖 ابدأ الربح الآن على تليجرام ←
        </a>
      )}

      <h2 className="mt-12 text-xl font-extrabold text-slate-900">كيف يعمل بالضبط؟</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {[
          { n: "1", t: "افتح البوت", d: "اضغط الزر أعلاه وابدأ محادثة البوت على تليجرام مباشرة." },
          { n: "2", t: "شاهد إعلاناً", d: "اختر «شاهد واربح»، وشاهد إعلاناً حقيقياً لثوانٍ معدودة." },
          { n: "3", t: "اسحب أرباحك", d: "بعد تجميع رصيدك، اسحبه بتحويل بنكي أو USDT من المحفظة." },
        ].map((step) => (
          <div key={step.n} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-700 text-sm font-extrabold text-white">
              {step.n}
            </span>
            <h3 className="mt-3 font-bold text-slate-900">{step.t}</h3>
            <p className="mt-1.5 text-sm text-slate-500">{step.d}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 text-xl font-extrabold text-slate-900">أسئلة شائعة</h2>
      <div className="mt-5 space-y-4">
        {FAQ.map((item) => (
          <div key={item.q} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-bold text-slate-900">{item.q}</h3>
            <p className="mt-2 text-sm text-slate-600">{item.a}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
