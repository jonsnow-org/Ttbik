"use client";

import { useEffect, useRef } from "react";

export type ClickData = { ok: true; verified: boolean; issuedAt: string; requiredSeconds: number; targetUrl: string };

// Same handful of stable, always-available signals as before — kept
// un-hashed here (no crypto.subtle await) so this can run and be handed to
// sendBeacon in the exact same synchronous tick as the redirect below, with
// no gap where the redirect could fire before the beacon is queued.
function rawFingerprint(): string {
  return [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    String(new Date().getTimezoneOffset()),
    String(navigator.hardwareConcurrency || ""),
  ].join("|");
}

export default function WatchClient({
  token,
  initialData,
  initialError,
}: {
  token: string;
  initialData: ClickData | null;
  initialError: string | null;
}) {
  const firedRef = useRef(false);

  // Redirects the CURRENT tab — never a new window — to the advertiser's
  // link the instant this page loads. Owner report, 2026-09-06:
  // window.open(targetUrl, "_blank") here was being flagged and blocked as
  // a popup by mobile Chrome / Telegram's in-app browser, no matter how
  // early it ran in the render — opening a NEW browsing context from page
  // JS is never treated as the same user gesture as the Telegram button
  // tap that opened this page, even on mount with zero awaits before it.
  // A same-tab redirect (location.replace) is an ordinary navigation, not
  // a popup, so it is never subject to that block. The fingerprint beacon
  // fires in the same tick, fire-and-forget — it's an anti-abuse signal
  // only, not a gate, so it never delays or blocks the redirect.
  useEffect(() => {
    if (!initialData || firedRef.current) return;
    firedRef.current = true;
    try {
      const payload = JSON.stringify({ fingerprint: rawFingerprint() });
      navigator.sendBeacon(`/api/watch/${token}/complete`, new Blob([payload], { type: "application/json" }));
    } catch {
      /* best-effort anti-fraud signal only */
    }
    window.location.replace(initialData.targetUrl);
  }, [initialData, token]);

  if (initialError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center" dir="rtl">
        <p className="text-red-700">{initialError}</p>
      </div>
    );
  }

  if (!initialData) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-slate-500" dir="rtl">
        جارِ التحميل...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-12 text-center" dir="rtl">
      <h1 className="text-2xl font-extrabold text-slate-900">شاهد واربح</h1>
      <p className="mt-4 text-sm text-slate-600">
        جارِ تحويلك الآن إلى الإعلان... إذا لم يتم تحويلك تلقائياً خلال لحظات، اضغط الزر أدناه.
      </p>
      <a href={initialData.targetUrl} className="mt-6 block w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white">
        🔗 فتح الإعلان
      </a>
      <p className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">
        بعد مشاهدة الإعلان، عد إلى البوت واضغط «✅ تحقق من الإنجاز» — لا حاجة لفعل أي شيء آخر في هذه الصفحة.
      </p>
    </div>
  );
}
