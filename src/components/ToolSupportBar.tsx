"use client";
// Shown under every free tool: the two things that turn a one-time visitor into growth and the first revenue.
//   1. Share: one tap to WhatsApp / Telegram / X / copy (most visitors arrive from shared links, not search).
//   2. Support: an optional coffee (NOWPayments donation page /coffee) and a pointer to the paid Telegram bots.
// Every tap is counted (src/lib/trackEvent.ts) so the owner can see which tool converts.
import { useState } from "react";
import { trackEvent } from "@/lib/trackEvent";

export default function ToolSupportBar() {
  const [copied, setCopied] = useState(false);
  const share = (net: "whatsapp" | "telegram" | "x" | "copy") => {
    const url = window.location.href.split("#")[0];
    const title = document.title.split("|")[0].trim() || "أداة مجانية";
    const text = `${title} — أداة مجانية بلا تسجيل:`;
    trackEvent(`share_${net}`);
    if (net === "copy") {
      navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
      return;
    }
    const href =
      net === "whatsapp" ? `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
      : net === "telegram" ? `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
      : `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    window.open(href, "_blank", "noopener,noreferrer");
  };
  const btn = "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 transition hover:border-indigo-300 hover:bg-indigo-50";
  return (
    <section dir="rtl" aria-label="شارك وادعم" className="mx-auto max-w-4xl px-4 pt-8">
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-l from-indigo-50 to-amber-50 p-4">
        <p className="text-sm font-extrabold text-slate-900">أعجبتك الأداة؟ شاركها مع من يحتاجها 👇</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => share("whatsapp")} className={btn}>واتساب</button>
          <button type="button" onClick={() => share("telegram")} className={btn}>تيليجرام</button>
          <button type="button" onClick={() => share("x")} className={btn}>X</button>
          <button type="button" onClick={() => share("copy")} className={btn}>{copied ? "✓ نُسخ الرابط" : "نسخ الرابط"}</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-indigo-100 pt-3 text-sm text-slate-700">
          <span>كل أدواتنا مجانية وتبقى مجانية.</span>
          <a href="/coffee" onClick={() => trackEvent("support_coffee")} className="rounded-xl bg-amber-500 px-3 py-1.5 font-bold text-white hover:bg-amber-600">☕ ادعمنا بفنجان قهوة</a>
          <a href="/bots" onClick={() => trackEvent("cta_bots")} className="rounded-xl bg-indigo-600 px-3 py-1.5 font-bold text-white hover:bg-indigo-700">🤖 بوتات تيليجرام</a>
        </div>
      </div>
    </section>
  );
}
