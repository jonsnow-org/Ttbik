"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

type Result = {
  bot?: {
    id?: number;
    username: string;
    firstName: string;
    botFatherName?: string;
    canJoinGroups: boolean;
    canReadAllGroupMessages: boolean;
    supportsInlineQueries?: boolean;
    canConnectToBusiness?: boolean;
    hasMainWebApp?: boolean;
    commands?: { command: string; description: string }[];
    description?: string;
    shortDescription?: string;
  };
  webhook?: {
    url: string | null;
    pendingUpdateCount: number;
    lastErrorMessage: string | null;
    lastErrorDate?: string | null;
    lastSyncErrorDate?: string | null;
    ipAddress?: string | null;
    maxConnections?: number | null;
    allowedUpdates?: string[];
    hasCustomCertificate?: boolean;
  };
  error?: string;
};

export default function HealthCheckForm() {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

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

  async function copyWebhook() {
    const url = result?.webhook?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setCopiedUrl(false);
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
        الخاص به يعمل بلا أخطاء، وما الأوامر والوصف المسجّلة لدى BotFather. لا نحفظ التوكن أبداً — الفحص لحظي مباشر عبر خوادم تليجرام نفسها.
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
            {result.bot.botFatherName?.trim() && result.bot.botFatherName.trim() !== result.bot.firstName && (
              <li>اسم BotFather المعروض: {result.bot.botFatherName}</li>
            )}
            {result.bot.id != null && <li>المعرّف: {result.bot.id}</li>}
            <li>
              الوصف المختصر:{" "}
              {result.bot.shortDescription?.trim()
                ? result.bot.shortDescription
                : "غير مضبوط في BotFather"}
            </li>
            <li>
              الوصف الكامل:{" "}
              {result.bot.description?.trim()
                ? result.bot.description
                : "غير مضبوط في BotFather"}
            </li>
            <li>يمكنه الانضمام لمجموعات: {result.bot.canJoinGroups ? "نعم" : "لا"}</li>
            <li>قراءة كل رسائل المجموعة: {result.bot.canReadAllGroupMessages ? "نعم" : "لا"}</li>
            {result.bot.supportsInlineQueries != null && (
              <li>استعلامات إنلاين: {result.bot.supportsInlineQueries ? "مفعّلة" : "غير مفعّلة"}</li>
            )}
            <li>
              Mini App (واجهة رئيسية):{" "}
              {result.bot.hasMainWebApp ? "مضبوطة" : "غير مضبوطة"}
            </li>
            <li>
              اتصال Telegram Business:{" "}
              {result.bot.canConnectToBusiness ? "مسموح" : "غير مسموح"}
            </li>
            <li>
              أوامر BotFather المسجّلة:{" "}
              {(result.bot.commands?.length ?? 0) === 0
                ? "لا يوجد (القائمة فارغة)"
                : `${result.bot.commands!.length} أمر`}
            </li>
            {(result.bot.commands?.length ?? 0) > 0 && (
              <li>
                <ul className="mt-1 space-y-1 rounded-xl border border-emerald-100 bg-white/70 p-3 text-xs text-slate-700">
                  {result.bot.commands!.map((c) => (
                    <li key={c.command} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                      <span className="font-mono font-bold text-indigo-800">/{c.command}</span>
                      <span className="text-slate-600">{c.description?.trim() || "بدون وصف"}</span>
                    </li>
                  ))}
                </ul>
              </li>
            )}
            {result.webhook?.url ? (
              <>
                <li>حالة الويبهوك: مُفعَّل ✅</li>
                <li className="break-all font-mono text-xs text-slate-600">
                  الرابط: {result.webhook.url}
                </li>
                {result.webhook.ipAddress && <li>عنوان IP للويبهوك: {result.webhook.ipAddress}</li>}
                {result.webhook.maxConnections != null && (
                  <li>أقصى اتصالات متزامنة: {result.webhook.maxConnections}</li>
                )}
                <li>
                  شهادة مخصصة على الويبهوك:{" "}
                  {result.webhook.hasCustomCertificate ? "نعم" : "لا (شهادة المزود الافتراضي)"}
                </li>
                {(result.webhook.allowedUpdates?.length ?? 0) > 0 && (
                  <li className="text-xs text-slate-600">
                    التحديثات المسموحة: {result.webhook.allowedUpdates!.join("، ")}
                  </li>
                )}
                <li>تحديثات بانتظار المعالجة: {result.webhook.pendingUpdateCount}</li>
                {(result.webhook.pendingUpdateCount ?? 0) > 10 && (
                  <li className="text-amber-800">
                    ⚠️ تراكم تحديثات مرتفع — الويبهوك قد يكون بطيئاً أو متوقفاً.
                  </li>
                )}
                {result.webhook.lastErrorMessage && (
                  <li className="text-rose-700">
                    ⚠️ آخر خطأ: {result.webhook.lastErrorMessage}
                    {result.webhook.lastErrorDate
                      ? ` (${new Date(result.webhook.lastErrorDate).toLocaleString("ar")})`
                      : ""}
                  </li>
                )}
                {result.webhook.lastSyncErrorDate && (
                  <li className="text-amber-800">
                    آخر خطأ مزامنة: {new Date(result.webhook.lastSyncErrorDate).toLocaleString("ar")}
                  </li>
                )}
              </>
            ) : (
              <li className="text-amber-700">⚠️ لا يوجد ويبهوك مُفعَّل لهذا البوت حالياً.</li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://t.me/${result.bot.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800"
            >
              افتح @{result.bot.username} على تليجرام
            </a>
            {result.webhook?.url && (
              <button
                type="button"
                onClick={copyWebhook}
                className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-800 hover:bg-indigo-50"
              >
                {copiedUrl ? "تم نسخ الرابط ✓" : "نسخ رابط الويبهوك"}
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
