"use client";

import { useEffect, useState } from "react";

export type ClickData = {
  ok: true;
  started: boolean;
  remainingSeconds: number;
  requiredSeconds: number;
  description: string | null;
  targetUrl: string;
};

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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (initialData?.started && startedAt === null) {
      setStartedAt(Date.now() - (initialData.requiredSeconds - initialData.remainingSeconds) * 1000);
    }
  }, [initialData, startedAt]);

  useEffect(() => {
    if (!initialData) return;
    try {
      const payload = JSON.stringify({ fingerprint: rawFingerprint() });
      navigator.sendBeacon(`/api/watch/${token}/complete`, new Blob([payload], { type: "application/json" }));
    } catch {
      // Anti-abuse signal only. It never starts or completes the paid timer.
    }
  }, [initialData, token]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  if (initialError) {
    return (
      <main className="mx-auto max-w-lg px-4 py-12 text-center" dir="rtl">
        <p className="text-lg font-extrabold text-red-700">{initialError}</p>
        <p className="mt-3 text-sm text-slate-600">ارجع إلى البوت واختر مهمة أخرى.</p>
      </main>
    );
  }
  if (!initialData) return null;

  const remaining = startedAt === null
    ? initialData.requiredSeconds
    : Math.max(0, Math.ceil((initialData.requiredSeconds * 1000 - (now - startedAt)) / 1000));
  const hasStarted = startedAt !== null;

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-8 text-slate-900" dir="rtl">
      <section className="rounded-3xl bg-white p-5 text-center shadow-sm">
        <div className="text-3xl">👀</div>
        <h1 className="mt-2 text-2xl font-black">شاهد واربح</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          افتح صفحة الإعلان من الزر أدناه. يبدأ احتساب وقت الزيارة عند ضغطك الفعلي على الزر، وليس عند عرض هذه الصفحة.
        </p>
        {initialData.description && (
          <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">{initialData.description}</p>
        )}
        {!hasStarted ? (
          <form action={`/watch/${token}/open`} method="POST" target="_blank" onSubmit={() => { setStartedAt(Date.now()); setNow(Date.now()); }}>
            <button type="submit" className="mt-5 w-full rounded-2xl bg-blue-700 px-4 py-4 text-base font-extrabold text-white">
              🔗 افتح الإعلان وابدأ الزيارة
            </button>
          </form>
        ) : (
          <div className="mt-5 rounded-2xl bg-blue-50 p-4">
            <div className="text-sm font-bold text-blue-900">
              {remaining > 0 ? "تم تسجيل فتح الإعلان. أبقِ الصفحة مفتوحة حتى يكتمل المؤقت." : "اكتمل وقت الزيارة."}
            </div>
            <div className="mt-2 text-4xl font-black tabular-nums text-blue-800">{remaining > 0 ? `${remaining} ث` : "✓"}</div>
            {remaining === 0 && (
              <form action={`/watch/${token}/open`} method="POST" target="_blank">
                <button type="submit" className="mt-3 w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-extrabold text-white">
                  فتح الإعلان مجدداً
                </button>
              </form>
            )}
          </div>
        )}
        <p className="mt-5 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-6 text-slate-600">
          بعد فتح الإعلان وانتظار {initialData.requiredSeconds} ثانية، ارجع إلى التطبيق المصغّر أو محادثة البوت واضغط «تحقّق واستلم». لا نعتبر مجرد عرض البطاقة زيارة.
        </p>
      </section>
    </main>
  );
}
