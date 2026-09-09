"use client";

import { useState } from "react";
import Link from "next/link";

const T = {
  ar: {
    enterUrlFirst: "أدخل الرابط أولاً",
    shortenFailed: "فشل الاختصار",
    connectFailed: "تعذر الاتصال بالخادم",
    placeholder: "https://example.com/صفحة-طويلة...",
    expiry: "صلاحية:",
    expiryNone: "بدون انتهاء",
    expiry7: "7 أيام",
    expiry30: "30 يوم",
    shortening: "جاري الاختصار...",
    shortenBtn: "اختصر الرابط",
    shortUrlLabel: "الرابط القصير:",
    clicksSoFar: (n: number) => `النقرات حتى الآن: ${n}`,
    copied: "✅ تم النسخ",
    copy: "نسخ الرابط",
    open: "فتح",
    qrNotePre: "لمشاركة كـ QR: انسخ الرابط ثم افتح",
    qrNoteLink: "مولّد QR الخاص بنا",
    qrNotePost: "أو استخدمه مباشرة في منشوراتك.",
    realToolPre: "أداة حقيقية على نطاق الموقع — ليست مجرد عرض كود. للاحتياجات المتقدمة (نطاق فرعي مخصص، صفحات روابط متعددة) راجع",
    realToolLink: "باقي الأدوات المجانية",
  },
  en: {
    enterUrlFirst: "Enter a link first",
    shortenFailed: "Failed to shorten the link",
    connectFailed: "Couldn't reach the server",
    placeholder: "https://example.com/a-very-long-page...",
    expiry: "Expires:",
    expiryNone: "Never",
    expiry7: "7 days",
    expiry30: "30 days",
    shortening: "Shortening...",
    shortenBtn: "Shorten link",
    shortUrlLabel: "Short link:",
    clicksSoFar: (n: number) => `Clicks so far: ${n}`,
    copied: "✅ Copied",
    copy: "Copy link",
    open: "Open",
    qrNotePre: "To share as a QR: copy the link then open our",
    qrNoteLink: "QR generator",
    qrNotePost: "or use it directly in your posts.",
    realToolPre: "A real tool running on this domain — not just a code demo. For advanced needs (custom subdomain, multiple link pages) see",
    realToolLink: "the rest of the free tools",
  },
} as const;

export default function UrlShortener({ lang = "ar" }: { lang?: "ar" | "en" }) {
  const t = T[lang];
  const [url, setUrl] = useState("");
  const [expiresDays, setExpiresDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ shortUrl: string; code: string; clicks: number } | null>(null);
  const [copied, setCopied] = useState(false);

  async function shorten() {
    setError("");
    setResult(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError(t.enterUrlFirst);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/tools/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed, expiresDays }),
      });
      const data = await res.json();
      if (!res.ok) {
        // The API route's own validation errors are Arabic-only — never
        // surface them on the English page, always show the translation.
        setError(lang === "en" ? t.shortenFailed : data.error || t.shortenFailed);
        return;
      }
      setResult({ shortUrl: data.shortUrl, code: data.code, clicks: data.clicks ?? 0 });
    } catch {
      setError(t.connectFailed);
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!result) return;
    navigator.clipboard.writeText(result.shortUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6" dir={lang === "en" ? "ltr" : "rtl"}>
      <div className="grid gap-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t.placeholder}
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          dir="ltr"
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="text-slate-500">{t.expiry}</span>
          {[
            { label: t.expiryNone, v: null },
            { label: t.expiry7, v: 7 },
            { label: t.expiry30, v: 30 },
          ].map((opt) => (
            <button
              key={String(opt.v)}
              type="button"
              onClick={() => setExpiresDays(opt.v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                expiresDays === opt.v
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={shorten}
          disabled={loading}
          className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {loading ? t.shortening : t.shortenBtn}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <p className="mb-2 text-xs font-semibold text-slate-500">{t.shortUrlLabel}</p>
          <p className="break-all font-mono text-sm text-brand-700" dir="ltr">
            {result.shortUrl}
          </p>
          <p className="mt-1 text-xs text-slate-500">{t.clicksSoFar(result.clicks)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
            >
              {copied ? t.copied : t.copy}
            </button>
            <a
              href={result.shortUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:border-brand-300"
            >
              {t.open}
            </a>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {t.qrNotePre}{" "}
            <Link href="/free-tools/qr-generator" className="font-semibold text-brand-700 underline">
              {t.qrNoteLink}
            </Link>
            {" "}{t.qrNotePost}
          </p>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-dashed border-brand-200 bg-brand-50/50 p-4 text-sm text-slate-600">
        {t.realToolPre}{" "}
        <Link href="/free-tools" className="font-bold text-brand-700 underline">
          {t.realToolLink}
        </Link>
        .
      </div>
    </div>
  );
}
