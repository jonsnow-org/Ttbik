import Script from "next/script";
import type { SwapWidget as W } from "@/lib/remit/widgets";

/** The provider's own exchange page in an iframe. Funds go from the user's wallet to the provider; nothing passes through us. */
export default function SwapWidget({ w }: { w: W }) {
  return (
    <div>
      <iframe
        id="iframe-widget"
        title={`تبديل العملات الرقمية عبر ${w.name}`}
        src={w.src}
        width="100%"
        height={w.height}
        style={{ border: 0, borderRadius: 12, width: "100%", height: w.height }}
        loading="eager"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {w.script && <Script src={w.script} strategy="afterInteractive" />}
      <p className="mt-1 text-[11px] text-slate-400">الخدمة يقدّمها {w.name} مباشرة، بلا حساب.</p>
    </div>
  );
}
