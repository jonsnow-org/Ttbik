"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

type MenuButton = { type?: string; text?: string; webAppUrl?: string };
type BotCommand = { command: string; description: string };
type Result = {
  bot?: {
    id?: number;
    username: string;
    firstName: string;
    botFatherName?: string;
    botFatherNameAr?: string;
    canJoinGroups: boolean;
    canReadAllGroupMessages: boolean;
    supportsInlineQueries?: boolean;
    canConnectToBusiness?: boolean;
    hasMainWebApp?: boolean;
    addedToAttachmentMenu?: boolean;
    profilePhotoCount?: number;
    commands?: BotCommand[];
    commandsAr?: BotCommand[];
    description?: string;
    shortDescription?: string;
    descriptionAr?: string;
    shortDescriptionAr?: string;
    menuButton?: MenuButton;
    groupAdminRights?: Record<string, boolean>;
    channelAdminRights?: Record<string, boolean>;
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
    isHttps?: boolean;
    host?: string | null;
  };
  error?: string;
};

function menuLabel(menu?: MenuButton) {
  if (!menu?.type || menu.type === "unknown") return "غير معروف";
  if (menu.type === "web_app") {
    const label = menu.text?.trim() ? `ويب آب («${menu.text.trim()}»)` : "ويب آب";
    return menu.webAppUrl ? `${label} — ${menu.webAppUrl}` : label;
  }
  if (menu.type === "commands") return "قائمة الأوامر";
  if (menu.type === "default") return "الافتراضي (أوامر)";
  return menu.type;
}

function enabledRights(rights?: Record<string, boolean>) {
  if (!rights) return [];
  return Object.entries(rights).filter(([, v]) => v).map(([k]) => k);
}

function readiness(result: Result): { tone: "ok" | "warn" | "bad"; title: string; notes: string[] } {
  const notes: string[] = [];
  const w = result.webhook;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates اليدوي.");
  if ((w?.pendingUpdateCount ?? 0) > 10) notes.push(`تراكم تحديثات معلّق (${w?.pendingUpdateCount}) — الويبهوك قد يكون متوقفاً أو بطيئاً.`);
  if (w?.lastErrorMessage) notes.push(`آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS — تليجرام يرفض الاستقبال غالباً.");
  if (w?.lastSyncErrorDate) notes.push("يوجد خطأ مزامنة أخير على الويبهوك.");
  if ((result.bot?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  if (!result.bot?.description?.trim() && !result.bot?.shortDescription?.trim()) notes.push("لا يوجد وصف مسجل في BotFather.");
  if ((result.bot?.commands?.length ?? 0) > 0 && (result.bot?.commandsAr?.length ?? 0) === 0) notes.push("لا توجد قائمة أوامر عربية (لغة ar) في BotFather.");
  if ((result.bot?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة ملف شخصي في BotFather.");
  if ((result.bot?.description?.trim() || result.bot?.shortDescription?.trim()) && !result.bot?.descriptionAr?.trim() && !result.bot?.shortDescriptionAr?.trim()) {
    notes.push("لا يوجد وصف عربي (لغة ar) في BotFather.");
  }
  if (notes.some((n) => n.startsWith("آخر خطأ") || n.startsWith("تراكم") || n.includes("ليس HTTPS"))) {
    return { tone: "bad", title: "البوت حي لكن الويبهوك فيه مشكلة", notes };
  }
  if (notes.length) return { tone: "warn", title: "البوت حي ويحتاج ضبطاً قبل الإطلاق", notes };
  return { tone: "ok", title: "جاهز للتشغيل: ويبهوك سليم وأوامر مسجلة", notes: [] };
}

export default function HealthCheckForm() {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedReport, setCopiedReport] = useState(false);

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

  async function copyReport() {
    const b = result?.bot;
    const w = result?.webhook;
    if (!b) return;
    const verdict = readiness(result!);
    const lines = [
      `تقرير فحص بوت — سوق تولز`,
      `الخلاصة: ${verdict.title}`,
      ...verdict.notes.map((n) => `- ${n}`),
      `@${b.username} (المعرّف: ${b.id ?? "—"})`,
      `الاسم: ${b.firstName}`,
      `الويبهوك: ${w?.url ? "مفعّل" : "غير مفعّل"}`,
      w?.host ? `مضيف الويبهوك: ${w.host}` : "",
      w?.url ? `HTTPS: ${w.isHttps === false ? "لا" : "نعم"}` : "",
      `التحديثات المسموحة: ${(w?.allowedUpdates?.length ?? 0) > 0 ? w!.allowedUpdates!.join(", ") : "كل الأنواع (الافتراضي)"}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch {
      setCopiedReport(false);
    }
  }

  const verdict = result?.bot ? readiness(result) : null;
  const b = result?.bot;
  const w = result?.webhook;

  return (
    <main className="relative mx-auto max-w-lg px-4 py-10">
      <SectionBackdrop tone="bots" />
      <span className="mx-auto mb-3 block w-fit rounded-full bg-indigo-50 px-4 py-1.5 text-xs font-bold text-indigo-700">🔍 فاحص صحة البوتات</span>
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">تحقق من حالة بوت تليجرام</h1>
      <p className="mb-6 text-sm text-slate-600">الصق توكن البوت فقط. لا نحفظ التوكن — الفحص لحظي عبر خوادم تليجرام.</p>
      <form onSubmit={check} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="relative">
          <input type={showToken ? "text" : "password"} required autoComplete="off" spellCheck={false} value={token} onChange={(e) => { setToken(e.target.value); setLocalError(null); }} placeholder="الصق توكن البوت هنا" className="w-full rounded-xl border border-slate-300 bg-white p-2.5 pe-20 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <button type="button" onClick={() => setShowToken((v) => !v)} className="absolute inset-y-0 end-2 text-xs font-bold text-indigo-700">{showToken ? "إخفاء" : "إظهار"}</button>
        </div>
        {localError && <p className="text-sm text-rose-700">{localError}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-indigo-700 py-2.5 font-bold text-white shadow-sm transition hover:bg-indigo-800 disabled:opacity-50">{loading ? "جاري الفحص..." : "افحص الآن"}</button>
      </form>
      {result?.error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{result.error}</div>}
      {b && (
        <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          {verdict && (
            <div className={verdict.tone === "ok" ? "rounded-xl border border-emerald-300 bg-white/80 p-3 text-sm text-emerald-900" : verdict.tone === "warn" ? "rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" : "rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"}>
              <p className="font-bold">{verdict.tone === "ok" ? "✅ " : verdict.tone === "warn" ? "⚠️ " : "❌ "}{verdict.title}</p>
              {verdict.notes.length > 0 && <ul className="mt-1 list-disc space-y-0.5 ps-5">{verdict.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            </div>
          )}
          <p className="text-sm font-bold text-emerald-800">✅ البوت فعّال: @{b.username}</p>
          <ul className="space-y-1 text-sm text-slate-700">
            <li>الاسم: {b.firstName}</li>
            {b.id != null && <li>المعرّف: {b.id}</li>}
            <li>صورة الملف: {(b.profilePhotoCount ?? 0) > 0 ? `${b.profilePhotoCount} صورة` : "غير مضبوطة"}</li>
            <li>الوصف المختصر: {b.shortDescription?.trim() || "غير مضبوط"}</li>
            <li>الوصف العربي (ar): {b.descriptionAr?.trim() || "غير مضبوط"}</li>
            <li>أوامر: {b.commands?.length ?? 0} — عربي: {b.commandsAr?.length ?? 0}</li>
            <li>زر القائمة: {menuLabel(b.menuButton)}</li>
            <li>صلاحيات مجموعات: {enabledRights(b.groupAdminRights).join(", ") || "لا شيء"}</li>
            {w?.url ? (
              <>
                <li>الويبهوك: مفعّل</li>
                <li className="break-all font-mono text-xs">{w.url}</li>
                {w.host && <li>المضيف: {w.host}</li>}
                <li>HTTPS: {w.isHttps === false ? "لا" : "نعم"}</li>
                <li>التحديثات المسموحة: {(w.allowedUpdates?.length ?? 0) > 0 ? w.allowedUpdates!.join(", ") : "كل الأنواع (الافتراضي)"}</li>
                <li>تحديثات معلّقة: {w.pendingUpdateCount}</li>
                {w.lastErrorMessage && <li className="text-rose-700">آخر خطأ: {w.lastErrorMessage}</li>}
                {w.lastSyncErrorDate && <li className="text-amber-800">خطأ مزامنة: {new Date(w.lastSyncErrorDate).toLocaleString("ar")}</li>}
              </>
            ) : (
              <li className="text-amber-700">لا يوجد ويبهوك مفعّل</li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            <a href={`https://t.me/${b.username}`} target="_blank" rel="noopener noreferrer" className="inline-block rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800">افتح @{b.username}</a>
            {w?.url && <button type="button" onClick={copyWebhook} className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-800">{copiedUrl ? "تم نسخ الرابط" : "نسخ الويبهوك"}</button>}
            <button type="button" onClick={copyReport} className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-800">{copiedReport ? "تم نسخ التقرير" : "نسخ ملخص الفحص"}</button>
          </div>
        </div>
      )}
    </main>
  );
}
