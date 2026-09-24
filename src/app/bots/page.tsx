import type { Metadata } from "next";
import Link from "next/link";
import { isOwnerServer } from "@/lib/isOwner";
import AdSlot from "@/components/AdSlot";
import BotsDeployForm from "./BotsDeployForm";
import { LIVE_BOTS } from "@/lib/liveBots";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/bots";

export const metadata: Metadata = {
  title: "تفعيل بوت تليجرام — سوق تولز",
  description:
    "فعّل بوت تليجرام يعمل فعلياً على توكنك الخاص خلال دقائق: مشاهدة إعلانات وربح نقاط، محفظة، وإحالة. منتج جاهز تملكه وتشغّله فوراً — بدون كتابة أي شيء.",
  alternates: { canonical: `${SITE}${PATH}` },
};

const FAQ = [
  {
    q: "هل أحصل على كود مصدري للبوت؟",
    a: "لا. المنتج بوت يعمل على توكنك. لا تحميل كوداً ولا بيع ملفات مصدرية.",
  },
  {
    q: "هل يوجد سحب نقدي من البوت؟",
    a: "لا. النقاط داخل البوت فقط. لا يوجد سحب نقدي عبر سوق تولز.",
  },
  {
    q: "كيف أفعّل بوتاً؟",
    a: "بعد طلب معتمد برمز طلب واحد لكل بوت. المالك يمكنه التجاوز للاختبار. الصق توكن BotFather في النموذج.",
  },
  {
    q: "كيف أتأكد أن البوت يعمل؟",
    a: "استخدم فاحص صحة البوت للتوكن والويبهوك بلا حفظ التوكن.",
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

// SoftwareApplication structured data for the real, live bot template
// itself (not just the deploy-your-own-instance page) -- owner directive
// 2026-09-16: help the bots surface as real, indexable entities in search
// results, not only this page's own text.
const SOFTWARE_JSON_LD = LIVE_BOTS[0] && {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: LIVE_BOTS[0].title,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Telegram",
  description: LIVE_BOTS[0].desc,
  url: LIVE_BOTS[0].href,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

const BREADCRUMB_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "البوتات", item: `${SITE}${PATH}` },
  ],
};

export default function BotsDeployPage() {
  const isOwner = isOwnerServer();
  return (
    <>
      {SOFTWARE_JSON_LD && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }} />
      )}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_JSON_LD) }}
      />
      <nav className="relative mx-auto max-w-lg px-4 pt-6 text-sm text-slate-500" aria-label="مسار التنقل">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/" className="hover:text-slate-800">
              الرئيسة
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-semibold text-slate-800">البوتات</li>
        </ol>
      </nav>
      <BotsDeployForm
        isOwner={isOwner}
        adSlot={<AdSlot position="in-content" label="أسفل نموذج تفعيل البوت" />}
      />
      <aside className="relative mx-auto max-w-lg px-4 pb-6" aria-labelledby="bots-related">
        <h2 id="bots-related" className="mb-2 text-sm font-extrabold text-slate-900">
          أدوات بوت مجانية على الموقع
        </h2>
        <ul className="space-y-2 text-sm font-bold text-indigo-800">
          <li>
            <Link href="/bots/health-check" className="hover:underline">
              فاحص صحة البوت ← توكن وويبهوك بلا حفظ التوكن
            </Link>
          </li>
          <li>
            <Link href="/bots/earnings-calculator" className="hover:underline">
              حاسبة أرباح القناة ← تقدير تخطيطي بلا سحب نقدي
            </Link>
          </li>
          <li>
            <Link href="/service/media-bot-premium" className="hover:underline">
              💎 ترقية بوت تحميل الوسائط ← 50 تحميلاً يومياً بدل 8
            </Link>
          </li>
          <li>
            <Link href="/watch-and-earn" className="hover:underline">
              اربح من مشاهدة الإعلانات ← كمستخدم في بوت قائم
            </Link>
          </li>
        </ul>
      </aside>
      <section className="relative mx-auto max-w-lg px-4 pb-10">
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
