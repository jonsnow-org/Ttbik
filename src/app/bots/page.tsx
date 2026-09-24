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
      <aside className="relative mx-auto max-w-lg px-4 pb-10" aria-labelledby="bots-related">
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
            <Link href="/news" className="hover:underline">
              أخبار سوق تولز
            </Link>
          </li>
        </ul>
      </aside>
    </>
  );
}
