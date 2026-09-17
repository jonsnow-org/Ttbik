"use client";

import { useState } from "react";

function extractBotToken(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(trimmed)) return trimmed;
  const m =
    trimmed.match(
      /(?:token is|Use this token to access the HTTP API:|API Token:|Your bot token is|التوكن هو|رمز البوت|التوكن)\s*[:：]?\s*([\d]{6,12}:[A-Za-z0-9_-]{30,})/i
    ) || trimmed.match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/);
  return m ? m[1] : trimmed;
}

/**
 * Owner-only creator for the Media Download Bot.
 * Protected by isOwnerServer() — never visible or usable by others.
 * After activation the real control happens INSIDE the Telegram bot
 * (Owner Panel vs User Panel as reply/inline keyboards), not on this form.
 */
export default function MediaBotCreator() {
  const [token, setToken] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [archiveChannelId, setArchiveChannelId] = useState("");
  const [forceSubChannel, setForceSubChannel] = useState("");
  const [botName, setBotName] = useState("");
  const [enableGlobalFeed, setEnableGlobalFeed] = useState(false);
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
      await new Promise((r) => setTimeout(r, 700));

      setStatus(
        `✅ تم التحقق من البيانات بنجاح.\n\n` +
          `📌 مهم:\n` +
          `• هذا النموذج مجرد قالب تفعيل على الموقع.\n` +
          `• بعد تشغيل الـ worker ستظهر داخل البوت نفسه لوحتان:\n` +
          `  1) لوحة مالك البوت (أزرار تحكم كاملة)\n` +
          `  2) لوحة المستخدم العادي\n\n` +
          `الخطوات التالية:\n` +
          `1. أنشئ قناة أرشيف خاصة وأضف البوت كمشرف.\n` +
          `2. (اختياري) أنشئ قناة اشتراك إجباري.\n` +
          `3. انشر خدمة media-bot على Render Free.\n` +
          `4. بعد الربط أرسل /start داخل البوت لرؤية لوحة المالك.\n\n` +
          `التوكن لن يُحفظ أبداً في موقع سوق تولز.`
      );
    } catch (err: any) {
      setStatus(`❌ خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        🔒 هذه الصفحة خاصة بالمالك فقط. لا يمكن لأي زائر آخر الوصول إليها أو تفعيل بوتات.
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">اسم البوت (للعرض فقط)</label>
        <input
          type="text"
          value={botName}
          onChange={(e) => setBotName(e.target.value)}
          placeholder="مثال: محمل الوسائط الاحترافي"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">Bot Token من BotFather</label>
        <input
          type="text"
          required
          value={token}
          onChange={(e) => setToken(extractBotToken(e.target.value))}
          placeholder="الصق التوكن أو رسالة BotFather كاملة"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">معرّف المالك (Telegram User ID)</label>
        <input
          type="text"
          required
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value.replace(/\D/g, ""))}
          placeholder="420066855"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <p className="mt-1 text-xs text-slate-500">هذا الآيدي سيحصل على لوحة مالك البوت داخل التيليجرام</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">آيدي قناة الأرشيف (التخزين الدائم)</label>
        <input
          type="text"
          value={archiveChannelId}
          onChange={(e) => setArchiveChannelId(e.target.value.trim())}
          placeholder="-100xxxxxxxxxx"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          قناة خاصة — أضف البوت كمشرف. تُستخدم لحفظ file_id + الرابط.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">قناة الاشتراك الإجباري (اختياري)</label>
        <input
          type="text"
          value={forceSubChannel}
          onChange={(e) => setForceSubChannel(e.target.value.trim())}
          placeholder="@YourChannel أو -100xxxxxxxxxx"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          إذا وُضعت، يجب على كل مستخدم الانضمام إليها قبل استخدام البوت. يمكن تغييرها لاحقاً من لوحة المالك داخل البوت.
        </p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
        <input
          type="checkbox"
          id="globalFeed"
          checked={enableGlobalFeed}
          onChange={(e) => setEnableGlobalFeed(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
        />
        <label htmlFor="globalFeed" className="text-sm text-slate-700">
          <span className="font-semibold">تفعيل الموجز العام (Mini App Feed) — مفتاح المالك</span>
          <br />
          <span className="text-slate-500">
            المفتاح الرئيسي. حتى لو كان مفعّلاً، كل مستخدم يقرر من إعدادات البوت هل محتواه يظهر في الموجز أم لا.
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
      >
        {loading ? "جاري التحقق..." : "تفعيل بوت الوسائط (قالب فقط)"}
      </button>

      {status && (
        <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {status}
        </div>
      )}

      <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-4 text-xs leading-relaxed text-violet-900">
        <p className="font-bold">بعد التفعيل ستظهر داخل البوت لوحتان منفصلتان:</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <strong>لوحة مالك البوت</strong>: إحصائيات، قناة الاشتراك الإجباري، تفعيل/إيقاف الموجز، إدارة المستخدمين، الميزات المدفوعة...
          </li>
          <li>
            <strong>لوحة المستخدم</strong>: تحميل، إعدادات الخصوصية (هل يظهر محتواي في الموجز؟)، حد الاستخدام، مساعدة...
          </li>
        </ul>
      </div>
    </form>
  );
}
