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

export default function MediaBotCreator() {
  const [token, setToken] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [archiveChannelId, setArchiveChannelId] = useState("");
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
      // Placeholder — real deploy will call a dedicated API once the Python worker is ready.
      // For now we just validate and show the next steps clearly.
      await new Promise((r) => setTimeout(r, 800));

      setStatus(
        `✅ تم التحقق من البيانات.\n\n` +
          `الخطوات التالية (يدوية حالياً حتى يكتمل الـ worker):\n` +
          `1. أنشئ قناة تيليجرام خاصة للأرشيف وأضف البوت كمشرف.\n` +
          `2. انسخ آيدي القناة (يبدأ بـ -100) وضعه في الحقل أعلاه.\n` +
          `3. انشر خدمة media-bot على Render Free وضع التوكن + آيدي القناة كـ env.\n` +
          `4. بعد الربط سيظهر البوت هنا كـ "نشط".\n\n` +
          `التوكن لن يُحفظ أبداً في قاعدة بيانات الموقع.`
      );
    } catch (err: any) {
      setStatus(`❌ خطأ: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
        <p className="mt-1 text-xs text-slate-500">احصل عليه من @userinfobot</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">
          آيدي قناة الأرشيف (اختياري الآن — مطلوب لاحقاً)
        </label>
        <input
          type="text"
          value={archiveChannelId}
          onChange={(e) => setArchiveChannelId(e.target.value.trim())}
          placeholder="-100xxxxxxxxxx"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 font-mono text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          قناة خاصة يُضاف إليها البوت كمشرف. تُستخدم كمخزن دائم لـ file_id + الرابط (حل مشكلة Ephemeral Storage).
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
          <span className="font-semibold">تفعيل الموجز العام الاختياري (Mini App Feed)</span>
          <br />
          <span className="text-slate-500">
            عند التفعيل، الفيديوهات العامة التي يحمّلها المستخدمون تظهر في موجز مشترك داخل تطبيق مصغر.
            يمكن للمستخدم إيقاف مشاركة محتواه الخاص من إعدادات البوت. المحتوى الخاص لا يظهر أبداً بدون موافقة.
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:opacity-50"
      >
        {loading ? "جاري التحقق..." : "إنشاء / ربط بوت الوسائط"}
      </button>

      {status && (
        <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {status}
        </div>
      )}

      <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-4 text-xs leading-relaxed text-violet-900">
        <p className="font-bold">الميزات المخطط لها في هذا البوت (مجانية دائماً):</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>تحميل متعدد المنصات + اختيار جودة + استخراج صوت + رسالة صوتية (PTT)</li>
          <li>كاش دائم عبر قناة تيليجرام (file_id)</li>
          <li>تقطيع ذكي للفيديوهات الكبيرة أو رابط بث مؤقت</li>
          <li>واجهة إيقاظ ذكية عند نوم Render</li>
          <li>ملخص ترجمة سريع + لقطات تشويق أساسية</li>
          <li>وضع مجموعات + تنظيف الروابط</li>
          <li>أعلام ميزات مدفوعة جاهزة للتفعيل لاحقاً بضغطة</li>
        </ul>
      </div>
    </form>
  );
}
