"use client";

import { useState } from "react";

function extractBotToken(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(trimmed)) return trimmed;
  const m =
    trimmed.match(
      /(?:token is|Use this token to access the HTTP API:|API Token:|Your bot token is|التوكن هو|رمز البوت|التوكن)\s*[:：]?\s*([\d]{6,12}:[A-Za-z0-9_-]{30,})/i,
    ) || trimmed.match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/);
  return m ? m[1] : trimmed;
}

export default function AtharBotCreator() {
  const [token, setToken] = useState("");
  const [ownerId, setOwnerId] = useState("420066855");
  const [botName, setBotName] = useState("أثر");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const trimmedToken = extractBotToken(token);
    if (trimmedToken !== token.trim()) setToken(trimmedToken);
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(trimmedToken)) {
      setStatus("❌ صيغة التوكن غير صحيحة.");
      return;
    }
    if (!ownerId || ownerId.length < 5) {
      setStatus("❌ معرّف المالك غير صالح.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/admin/bots/activate-athar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: trimmedToken, ownerId, botName }),
      });
      const j = await r.json();
      if (!r.ok) {
        setStatus(`❌ ${j.error || "فشل التفعيل"}`);
      } else {
        setStatus(
          `✅ تم تفعيل @${j.username}\n\n• القالب: ATHAR_BOT\n• التطبيق المصغر: ${j.miniApp}\n• أرسل /start في البوت\n• زر القائمة «أثر» يفتح التطبيق\n\nلا جداول ولا إعداد إضافي: كل شيء على السلسلة وعلى Oracle.`,
        );
      }
    } catch (err: any) {
      setStatus(`❌ ${err.message || "خطأ شبكة"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        🔒 للمالك فقط. البوت يعمل على webhook فيرسيل ويفتح تطبيق أثر على Oracle.
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">اسم العرض</label>
        <input value={botName} onChange={(e) => setBotName(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">Bot Token</label>
        <input
          required
          value={token}
          onChange={(e) => setToken(extractBotToken(e.target.value))}
          placeholder="الصق توكن BotFather"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">Telegram User ID للمالك</label>
        <input
          required
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm"
        />
      </div>
      <button type="submit" disabled={loading} className="w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white disabled:opacity-50">
        {loading ? "جاري التفعيل..." : "تفعيل بوت أثر"}
      </button>
      {status && <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{status}</pre>}
    </form>
  );
}
