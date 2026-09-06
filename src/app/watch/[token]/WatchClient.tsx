"use client";

import { useEffect, useRef, useState } from "react";

export type ClickData = { ok: true; verified: boolean; issuedAt: string; requiredSeconds: number; targetUrl: string };

// Basic composite browser fingerprint (owner spec, 2026-08-31: "بصمة
// الجهاز... لمنع استخدام عدة حسابات على جهاز واحد"). Deliberately simple —
// a handful of stable, always-available signals hashed together — not a
// commercial-grade fingerprinting library. Spoofable by anyone who tries,
// but catches the common case of one device farming several accounts.
async function computeFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    String(new Date().getTimezoneOffset()),
    String(navigator.hardwareConcurrency || ""),
  ].join("|");
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // SubtleCrypto unavailable (very old browser) — fall back to the raw
    // string; still usable for exact-match comparison, just not hashed.
    return parts;
  }
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
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(initialData?.verified ?? false);
  const openedRef = useRef(false);
  const completingRef = useRef(false);

  // The target is already known from the server-rendered page (no client
  // fetch, no awaited gap) — this is the very first thing that runs on
  // mount, which is what actually gets this treated as part of the
  // original tap-through-to-this-page navigation instead of a blocked
  // "script tried to open a popup" attempt.
  useEffect(() => {
    if (!initialData || confirmed || openedRef.current) return;
    openedRef.current = true;
    window.open(initialData.targetUrl, "_blank", "noopener,noreferrer");
  }, [initialData, confirmed]);

  async function complete() {
    if (completingRef.current) return;
    completingRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    try {
      const fingerprint = await computeFingerprint();
      const res = await fetch(`/api/watch/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint }),
      });
      const d = await res.json();
      if (d.ok) {
        setConfirmed(true);
      } else {
        setConfirmError(d.error || "لم يمر الوقت المطلوب بعد.");
        completingRef.current = false;
      }
    } catch {
      setConfirmError("تعذّر الاتصال بالخادم — سيُعاد المحاولة تلقائياً.");
      completingRef.current = false;
    } finally {
      setConfirming(false);
    }
  }

  // Countdown ticks down from the server-known issuedAt; the instant it
  // hits zero this completes the click AUTOMATICALLY — no button to find
  // and tap on this page at all (owner report, 2026-09-06: the old
  // "متابعة" button here was an entirely redundant extra step on top of
  // the bot's own "✅ تحقق من الإنجاز", and cost enough friction that
  // viewers were abandoning before the timer even ran out). The only
  // remaining action is back in the bot.
  useEffect(() => {
    if (!initialData || confirmed) return;
    const issuedAt = new Date(initialData.issuedAt).getTime();
    const requiredMs = initialData.requiredSeconds * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((issuedAt + requiredMs - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) complete();
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, confirmed]);

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
    <div className="mx-auto max-w-lg px-4 py-12" dir="rtl">
      <h1 className="text-2xl font-extrabold text-slate-900">شاهد واربح</h1>
      <p className="mt-2 text-sm text-slate-600">
        فُتح الرابط تلقائياً في تبويب جديد — إن لم يُفتح (بعض المتصفحات تمنع ذلك)، اضغط الزر أدناه. لا حاجة لفعل أي شيء آخر هنا، العدّاد سيكتمل تلقائياً.
      </p>
      <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-center">
        {confirmed ? (
          <p className="text-lg font-bold text-emerald-700">✅ تم! ارجع الآن إلى البوت واضغط «✅ تحقق من الإنجاز».</p>
        ) : (
          <>
            {/* Backup CTA for the (now rarer) case the automatic
                window.open() above still got blocked — a real <a> tapped
                directly by the viewer is a genuine synchronous user
                gesture no browser blocks. */}
            <a
              href={initialData.targetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white"
            >
              🔗 فتح الرابط الآن
            </a>
            <p className="text-3xl font-extrabold text-brand-700">{secondsLeft ?? initialData.requiredSeconds}</p>
            <p className="text-sm text-slate-500">{confirming ? "جارٍ التسجيل..." : "ثانية متبقية — سيُسجَّل تلقائياً"}</p>
            {confirmError && <p className="text-sm text-red-700">{confirmError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
