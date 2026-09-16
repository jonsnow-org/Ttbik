"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

type Result = {
  bot?: { username: string; firstName: string; canJoinGroups: boolean; canReadAllGroupMessages: boolean };
  webhook?: { url: string | null; pendingUpdateCount: number; lastErrorMessage: string | null };
  error?: string;
};

export default function HealthCheckForm() {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/bots/health-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
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
        <input
          type="text"
          required
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="الصق توكن البوت هنا"
          className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
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
            <li>يمكنه الانضمام لمجموعات: {result.bot.canJoinGroups ? "نعم" : "لا"}</li>
            {result.webhook?.url ? (
              <>
                <li>حالة الويبهوك: مُفعَّل ✅</li>
                <li>تحديثات بانتظار المعالجة: {result.webhook.pendingUpdateCount}</li>
                {result.webhook.lastErrorMessage && (
                  <li className="text-rose-700">⚠️ آخر خطأ: {result.webhook.lastErrorMessage}</li>
                )}
              </>
            ) : (
              <li className="text-amber-700">⚠️ لا يوجد ويبهوك مُفعَّل لهذا البوت حالياً.</li>
            )}
          </ul>
        </div>
      )}
    </main>
  );
}
