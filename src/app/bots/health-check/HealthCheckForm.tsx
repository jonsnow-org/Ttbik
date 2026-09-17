"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

type Result = {
  bot?: {
    id?: number;
    username: string;
    firstName: string;
    canJoinGroups: boolean;
    canReadAllGroupMessages: boolean;
  };
  webhook?: {
    url: string | null;
    pendingUpdateCount: number;
    lastErrorMessage: string | null;
    lastErrorDate?: string | null;
  };
  error?: string;
};

export default function HealthCheckForm() {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const extracted = token.trim().match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/)?.[1] || token.trim();
    if (!TOKEN_RE.test(extracted)) {
      setLocalError("صيغة التوكن غير صحيحة. الشكل: أرقام ثم : ثم مفتاح طويل من BotFather.");
      setResult(null);
      return;
    }
    setLocalError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/bots/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: extracted }),
      });
      setResult(await res.json());
    } catch {
      setResult({ error: "تعذّر الفحص، حاول مجدداً." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative mx-auto max-w-lg px-4 py-10">
      <SectionBackdrop tone="bots" />
      <span className="mx-auto mb-3 block w-fit rounded-full bg-indigo-50 px-4 py-1.5 text-xs font-bold text-indigo-700">
        🔍 فاحص صحة البوتات
      </span>
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">تحقق من حالة بوت تليجرام</h1>
      <p className="mb-6 text-sm text-slate-600">
        الصق توكن أي بوت (توكن فقط، لا نطلب أي بيانات أخرى) لتتحقق فوراً هل لا يزال فعّالاً، وهل الويبهوك (Webhook)
        الخاص به يعمل بلا أخطاء. لا نحفظ التوكن أبداً — الفحص لحظي مباشر عبر خوادم تليجرام نفسها.
      </p>

      <form onSubmit={check} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            required
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setLocalError(null);
            }}
            placeholder="الصق توكن البوت هنا"
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 pe-20 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="absolute inset-y-0 end-2 text-xs font-bold text-indigo-700"
          >
            {showToken ? "إخفاء" : "إظهار"}
          </button>
        </div>
        {localError && <p className="text-sm text-rose-700">{localError}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-indigo-700 py-2.5 font-bold text-white shadow-sm transition hover:bg-indigo-800 disabled:opacity-50"
        >
          {loading ? "جاري الفحص..." : "افحص الآن"}
        </button>
      </form>

      {result?.error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {result.error}
        </div>
      )}

      {result?.bot && (
        <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-bold text-emerald-800">✅ البوت فعّال: @{result.bot.username}</p>
          <ul className="space-y-1 text-sm text-slate-700">
            <li>الاسم: {result.bot.firstName}</li>
            {result.bot.id != null && <li>المعرّف: {result.bot.id}</li>}
            <li>يمكنه الانضمام لمجموعات: {result.bot.canJoinGroups ? "نعم" : "لا"}</li>
            <li>قراءة كل رسائل المجموعة: {result.bot.canReadAllGroupMessages ? "نعم" : "لا"}</li>
            {result.webhook?.url ? (
              <>
                <li>حالة الويبهوك: مُفعَّل ✅</li>
                <li>تحديثات بانتظار المعالجة: {result.webhook.pendingUpdateCount}</li>
                {result.webhook.lastErrorMessage && (
                  <li className="text-rose-700">
                    ⚠️ آخر خطأ: {result.webhook.lastErrorMessage}
                    {result.webhook.lastErrorDate
                      ? ` (${new Date(result.webhook.lastErrorDate).toLocaleString("ar")})`
                      : ""}
                  </li>
                )}
              </>
            ) : (
              <li className="text-amber-700">⚠️ لا يوجد ويبهوك مُفعَّل لهذا البوت حالياً.</li>
            )}
          </ul>
          <a
            href={`https://t.me/${result.bot.username}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800"
          >
            افتح @{result.bot.username} على تليجرام
          </a>
        </div>
      )}
    </main>
  );
}
