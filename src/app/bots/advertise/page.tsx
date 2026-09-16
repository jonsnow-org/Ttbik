import type { Metadata } from "next";
import { LIVE_BOTS } from "@/lib/liveBots";

export const metadata: Metadata = {
  title: "احجز مساحة إعلانية على منصتنا | سوق تولز",
  description: "أعلن لبوتك أو قناتك أمام جمهور حقيقي مهتم بتليجرام والأتمتة والأدوات الرقمية — حجز مباشر، بلا وسيط.",
  alternates: { canonical: "/bots/advertise" },
};

// Real, manual-inquiry-only lead-gen page (owner-analysis idea,
// 2026-09-16: "احجز مساحة إعلانية لبوتك أو قناتك"). Deliberately NO
// automated price/checkout — matches the platform's standing rule
// (docs/AGENT_BUS.md) that anything money-adjacent here is negotiated/
// settled manually by the owner, never self-served. Routes the inquiry
// through AD_BOT's existing "📩 راسل الأدمن" feature instead of building
// a new contact form + schema.
export default function AdvertisePage() {
  const botLink = LIVE_BOTS[0]?.href;

  return (
    <div className="relative mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-amber-50 px-4 py-1.5 text-xs font-bold text-amber-700">
        📢 مساحة إعلانية
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900 sm:text-3xl">
        احجز مساحة إعلانية لبوتك أو قناتك على منصتنا
      </h1>
      <p className="mt-4 text-base text-slate-600">
        جمهور موقعنا وبوتاتنا مهتم فعلياً بتليجرام والأتمتة والأدوات الرقمية — استهداف دقيق لصنّاع البوتات وأصحاب
        القنوات والمشاريع الصغيرة. احجز إعلاناً مباشراً بدل الاعتماد فقط على شبكات الإعلانات العامة.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold text-slate-900">🤖 داخل بوتاتنا</h3>
          <p className="mt-2 text-sm text-slate-500">إعلانك يظهر لمستخدمين حقيقيين نشطين داخل بوت الإعلانات والمهام.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-bold text-slate-900">🌐 داخل الموقع</h3>
          <p className="mt-2 text-sm text-slate-500">مساحة إعلانية على صفحات الأدوات المجانية عالية الزيارات.</p>
        </div>
      </div>

      <div className="mt-8 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 p-6 text-white shadow-md">
        <p className="font-bold">السعر يُحدَّد حسب المدة والموضع — تواصل معنا مباشرة للاتفاق.</p>
        <p className="mt-2 text-sm text-amber-50">
          لا يوجد دفع تلقائي فوري — كل حجز يُراجَع ويُتفَّق عليه يدوياً معك مباشرة لضمان أفضل موضع يناسب ميزانيتك.
        </p>
        {botLink && (
          <a
            href={botLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-amber-700 shadow transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            📩 راسلنا الآن عبر البوت ←
          </a>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        افتح البوت أعلاه، من القائمة اختر «الأسئلة الشائعة» ثم «📩 راسل الأدمن»، واذكر تفاصيل إعلانك — سنرد عليك مباشرة.
      </p>
    </div>
  );
}
