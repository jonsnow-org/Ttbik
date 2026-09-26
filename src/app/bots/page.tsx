import Link from "next/link";
import { isOwnerServer } from "@/lib/isOwner";
import AdSlot from "@/components/AdSlot";
import BotsDeployForm from "./BotsDeployForm";
import { LIVE_BOTS } from "@/lib/liveBots";
import { botsMetadata } from "./botsPageMeta";
import {
  TERMS,
  PREP,
  AFTER,
  LIMITS,
  INCLUDES,
  STEPS,
} from "./botsPageCopy";
import {
  FAQ,
  FAQ_JSON_LD,
  HOWTO_JSON_LD,
  LIVE_BOTS_JSON_LD,
  BREADCRUMB_JSON_LD,
  WEBPAGE_JSON_LD,
  APP_JSON_LD,
} from "./botsPageFaq";

export const metadata = botsMetadata;

export default function BotsDeployPage() {
  const isOwner = isOwnerServer();
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBPAGE_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(APP_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(LIVE_BOTS_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(HOWTO_JSON_LD) }} />
      <nav className="relative mx-auto max-w-lg px-4 pt-6 text-sm text-slate-500" aria-label="مسار التنقل">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/" className="hover:text-slate-800">الرئيسة</Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-semibold text-slate-800">البوتات</li>
        </ol>
      </nav>
      <aside className="relative mx-auto max-w-lg px-4 pb-4" aria-labelledby="bots-terms">
        <h2 id="bots-terms" className="mb-2 text-sm font-extrabold text-slate-900">شروط المنتج</h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {TERMS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-4" aria-labelledby="bots-prep">
        <h2 id="bots-prep" className="mb-2 text-sm font-extrabold text-slate-900">قبل لصق التوكن</h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {PREP.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          <Link href="/bots/health-check" className="font-bold text-indigo-800 hover:underline">فاحص صحة البوت ←</Link>{" "}بلا حفظ التوكن.
        </p>
      </aside>
      <BotsDeployForm isOwner={isOwner} adSlot={<AdSlot position="in-content" label="أسفل نموذج تفعيل البوت" />} />
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-after">
        <h2 id="bots-after" className="mb-2 text-sm font-extrabold text-slate-900">بعد التفعيل</h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {AFTER.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-limits">
        <h2 id="bots-limits" className="mb-2 text-sm font-extrabold text-slate-900">حدود بعد التشغيل</h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {LIMITS.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-includes">
        <h2 id="bots-includes" className="mb-2 text-sm font-extrabold text-slate-900">ما يشمله التفعيل</h2>
        <ul className="list-disc space-y-1 pr-5 text-xs leading-5 text-slate-600">
          {INCLUDES.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="live-bots">
        <h2 id="live-bots" className="mb-2 text-sm font-extrabold text-slate-900">بوتات عاملة يمكنك تجربها الآن على تليجرام</h2>
        <p className="mb-3 text-xs leading-5 text-slate-500">روابط مباشرة إلى البوت على تليجرام — بلا معلمة إحالة. ليست كوداً للتحميل.</p>
        <ul className="space-y-2">
          {LIVE_BOTS.map((bot) => (
            <li key={bot.href} className="rounded-xl border border-slate-200 bg-white p-3">
              <a href={bot.href} className="text-sm font-extrabold text-indigo-800 hover:underline" target="_blank" rel="noopener noreferrer">
                {bot.title} ←
              </a>
              <p className="mt-1 text-xs leading-5 text-slate-600">{bot.desc}</p>
              <p className="mt-1 text-[11px] text-slate-400">t.me مباشر — بلا ?start= وبلا إحالة</p>
            </li>
          ))}
        </ul>
      </aside>
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-related">
        <h2 id="bots-related" className="mb-2 text-sm font-extrabold text-slate-900">أدوات بوت مجانية على الموقع</h2>
        <ul className="space-y-2 text-sm font-bold text-indigo-800">
          <li><Link href="/bots/health-check" className="hover:underline">فاحص صحة البوت ← توكن وويبهوك بلا حفظ التوكن</Link></li>
          <li><Link href="/bots/earnings-calculator" className="hover:underline">حاسبة أرباح القناة ← تقدير تخطيطي بلا سحب نقدي</Link></li>
          <li><Link href="/service/media-bot-premium" className="hover:underline">ترقية بوت تحميل الوسائط ← 50 تحميلاً يومياً بدل 8</Link></li>
          <li><Link href="/watch-and-earn" className="hover:underline">اربح من مشاهدة الإعلانات ← كمستخدم في بوت قائم</Link></li>
        </ul>
      </aside>
      <section className="relative mx-auto max-w-lg px-4 pb-10">
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">كيف تفعّل البوت</h2>
        <ol className="mb-8 list-decimal space-y-2 pr-5 text-sm leading-6 text-slate-600">
          {STEPS.map((s) => (
            <li key={s.name}>
              <span className="font-bold text-slate-800">{s.name}: </span>
              {s.text}
            </li>
          ))}
        </ol>
        <h2 className="mb-3 text-lg font-extrabold text-slate-900">أسئلة شائعة</h2>
        <dl className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="mb-1 text-sm font-bold text-slate-900">{item.q}</dt>
              <dd className="text-sm leading-6 text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
