"use client";

import { useCallback, useEffect, useState } from "react";

type NovaUser = {
  id: string;
  telegramId: string | null;
  email: string | null;
  apiKey: string | null;
  plan: string;
  subscriptionExpiresAt: string | null;
  dailyUsed: number;
  dailyUsedImage: number;
  weeklyUsedText: number;
  weeklyUsedImage: number;
  dailyResetAt: string;
  created_at: string;
};

type LogRow = { id: string; channel: string; queryType: string; message: string | null; answer: string | null; created_at: string };

type Plan = {
  label: string;
  daily_text: number;
  daily_image: number;
  weekly_text: number;
  weekly_image: number;
  price_usd: number;
};

export default function NovaDashboardClient({ uid }: { uid: string }) {
  const [tab, setTab] = useState<"overview" | "history" | "apikey" | "upgrade">("overview");
  const [user, setUser] = useState<NovaUser | null>(null);
  const [plans, setPlans] = useState<Record<string, Plan>>({});
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!uid) return;
    const res = await fetch(`/api/nova/me?uid=${uid}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "تعذّر تحميل الحساب");
      return;
    }
    setUser(data.user);
    setPlans(data.plans || {});
    setLogs(data.recentLogs || []);
    setApiKey(data.user.apiKey);
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  async function generateApiKey() {
    setBusy(true);
    const res = await fetch("/api/nova/me/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
    });
    const data = await res.json();
    if (res.ok) setApiKey(data.apiKey);
    setBusy(false);
  }

  if (!uid) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center" dir="rtl">
        <p className="text-red-700">رابط غير صالح — افتح هذه الصفحة من زر «🎛 لوحتي» داخل بوت Nova.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center" dir="rtl">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12 text-center text-slate-500" dir="rtl">
        جارِ التحميل...
      </div>
    );
  }

  const isPro = user.plan !== "FREE";
  const currentPlan: Plan | undefined = plans[user.plan];
  const remainingText = currentPlan ? Math.max(0, currentPlan.daily_text - user.dailyUsed) : null;
  const remainingImage = currentPlan ? Math.max(0, currentPlan.daily_image - user.dailyUsedImage) : null;

  const TABS: { id: typeof tab; label: string }[] = [
    { id: "overview", label: "نظرة عامة" },
    { id: "history", label: "سجل المحادثات" },
    { id: "apikey", label: "مفتاح API" },
    { id: "upgrade", label: isPro ? "اشتراكي" : "الترقية" },
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10" dir="rtl">
      <h1 className="mb-1 text-2xl font-extrabold text-slate-900">لوحتي — Nova AI</h1>
      <p className="mb-6 text-sm text-slate-500">{user.telegramId ? `حساب تيليجرام: ${user.telegramId}` : user.email}</p>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              tab === t.id ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">الخطة الحالية</span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${isPro ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
                {isPro ? `👑 ${currentPlan?.label || user.plan}` : "مجانية"}
              </span>
            </div>
            {isPro && user.subscriptionExpiresAt && (
              <p className="mt-1 text-xs text-slate-400">ينتهي في: {new Date(user.subscriptionExpiresAt).toLocaleDateString("ar")}</p>
            )}
            {currentPlan && (
              <div className="mt-2 space-y-1 text-sm text-slate-500">
                <p>رسائل اليوم: {remainingText} من {currentPlan.daily_text}</p>
                <p>صور اليوم: {remainingImage} من {currentPlan.daily_image}</p>
                <p className="text-xs text-slate-400">
                  الحد الأسبوعي: {currentPlan.weekly_text} رسالة، {currentPlan.weekly_image} صورة
                </p>
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            عضو منذ {new Date(user.created_at).toLocaleDateString("ar")}
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          {logs.length === 0 && <p className="text-slate-500">لا توجد محادثات محفوظة بعد.</p>}
          {logs.map((l) => (
            <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
              <p className="text-xs text-slate-400">{new Date(l.created_at).toLocaleString("ar")} · {l.queryType}</p>
              <p className="mt-1 font-semibold text-slate-800">س: {l.message}</p>
              <p className="mt-1 text-slate-600">ج: {(l.answer || "").slice(0, 300)}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "apikey" && (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-600">
            استخدم هذا المفتاح للوصول إلى Nova برمجياً من تطبيقاتك الخاصة (قناة API):{" "}
            <code className="rounded bg-slate-100 px-1">Authorization: Bearer &lt;المفتاح&gt;</code>
          </p>
          {apiKey ? (
            <div className="rounded-xl bg-slate-100 p-3 font-mono text-xs break-all">{apiKey}</div>
          ) : (
            <p className="text-sm text-slate-500">لم تُنشئ مفتاحاً بعد.</p>
          )}
          <button
            disabled={busy}
            onClick={generateApiKey}
            className="w-full rounded-xl bg-brand-700 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "جارٍ الإنشاء..." : apiKey ? "توليد مفتاح جديد (يُلغي القديم)" : "إنشاء مفتاح API"}
          </button>
        </div>
      )}

      {tab === "upgrade" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          {isPro && (
            <p className="mb-3 text-sm text-slate-600">
              اشتراكك الحالي: {currentPlan?.label || user.plan} — يمكنك الترقية لخطة أعلى في أي وقت.
            </p>
          )}
          <p className="mb-3 text-sm text-slate-600">كل الخطط تتيح كل ميزات نوفا (نص، صور، صوت، ملفات) — الفرق فقط في الكمية اليومية/الأسبوعية.</p>
          <a
            href={`/pay/nova?uid=${uid}`}
            className="block w-full rounded-xl bg-brand-700 py-3 text-center text-sm font-bold text-white"
          >
            عرض الخطط والاشتراك بعملة رقمية →
          </a>
        </div>
      )}
    </div>
  );
}
