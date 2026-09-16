import type { Metadata } from "next";
import { isOwnerServer } from "@/lib/isOwner";
import AdSlot from "@/components/AdSlot";
import BotsDeployForm from "./BotsDeployForm";
import { LIVE_BOTS } from "@/lib/liveBots";

export const metadata: Metadata = {
  title: "تفعيل بوت تليجرام — سوق تولز",
  description:
    "فعّل بوت تليجرام يعمل فعلياً على توكنك الخاص خلال دقائق: مشاهدة إعلانات وربح نقاط، محفظة، وإحالة. منتج جاهز تملكه وتشغّله فوراً — بدون كتابة أي شيء.",
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

export default function BotsDeployPage() {
  const isOwner = isOwnerServer();
  return (
    <>
      {SOFTWARE_JSON_LD && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_JSON_LD) }} />
      )}
      <BotsDeployForm
        isOwner={isOwner}
        adSlot={<AdSlot position="in-content" label="أسفل نموذج تفعيل البوت" />}
      />
    </>
  );
}
