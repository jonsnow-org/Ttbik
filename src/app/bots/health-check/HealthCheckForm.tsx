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
    commandsPrivate?: BotCommand[];
    commandsGroups?: BotCommand[];
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
    maxConnections?: number | null;
    allowedUpdates?: string[];
    hasCustomCertificate?: boolean;
    isHttps?: boolean;
    host?: string | null;
    tokenEmbeddedInUrl?: boolean;
    hostIsIp?: boolean;
    hostIsPrivate?: boolean;
    ipAddress?: string | null;
  };
  error?: string;
};

function yn(v?: boolean) {
  return v ? "نعم" : "لا";
}

function fmtDate(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ar");
  } catch {
    return iso;
  }
}

function hoursSince(iso?: string | null) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 36e5;
}

function enabledRights(rights?: Record<string, boolean>) {
  if (!rights) return [];
  return Object.entries(rights)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function commandSlugs(cmds?: BotCommand[], limit = 8) {
  return (cmds ?? []).slice(0, limit).map((c) => `/${c.command}`).join(" ");
}

function collectNotes(result: Result): string[] {
  const notes: string[] = [];
  const w = result.webhook;
  const b = result.bot;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates.");
  const pending = w?.pendingUpdateCount ?? 0;
  if (pending > 100) notes.push(`تراكم تحديثات كبير (${pending}) — الويبهوك قد يكون متوقفاً.`);
  else if (pending > 10) notes.push(`تراكم تحديثات معلّق (${pending}).`);
  else if (pending > 0) notes.push(`تحديثات معلّقة (${pending}).`);
  if (w?.lastErrorMessage) notes.push(`آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS.");
  if (w?.url && hoursSince(w.lastErrorDate) != null && hoursSince(w.lastErrorDate)! <= 24) {
    notes.push(`خطأ ويبهوك خلال آخر 24 ساعة (${fmtDate(w.lastErrorDate)}).`);
  }
  if (w?.url && hoursSince(w.lastSyncErrorDate) != null && hoursSince(w.lastSyncErrorDate)! <= 24) {
    notes.push(`خطأ مزامنة ويبهوك خلال آخر 24 ساعة (${fmtDate(w.lastSyncErrorDate)}).`);
  }
  if (w?.url && w.hasCustomCertificate) {
    notes.push("الويبهوك يستخدم شهادة TLS مخصصة — تأكد أن تليجرام يثق بها.");
  }
  if (w?.url && (w.host === "api.telegram.org" || (w.host || "").endsWith(".telegram.org"))) {
    notes.push("مضيف الويبهوك يشير إلى خوادم تليجرام — عيّن رابط خادمك.");
  }
  if (!b?.username?.trim()) {
    notes.push("البوت بلا @username.");
  } else if (!b.username.trim().toLowerCase().endsWith("bot")) {
    notes.push(`المعرف @${b.username.trim()} لا ينتهي بـ bot.`);
  }
  if (!b?.firstName?.trim()) notes.push("الاسم الظاهر (first_name) فارغ.");
  if (w?.url && w.hostIsPrivate) {
    notes.push("مضيف الويبهوك عنوان خاص/محلي — تليجرام لا يصل إليه من الإنترنت.");
  }
  if (w?.url && w.hostIsIp) notes.push("مضيف الويبهوك عنوان IP خام — فضّل نطاقاً.");
  if (w?.url && w.maxConnections != null && w.maxConnections < 10) {
    notes.push(`أقصى اتصالات منخفض (${w.maxConnections}).`);
  }
  const allowed = w?.allowedUpdates ?? [];
  if (w?.url && allowed.length > 0) {
    if (!allowed.includes("message")) notes.push("allowed_updates يستثني message — البوت لن يستقبل الرسائل العادية.");
    if (!allowed.includes("callback_query")) notes.push("allowed_updates يستثني callback_query — أزرار القوائم قد لا تعمل.");
  }
  if (b?.canJoinGroups === false) notes.push("البوت ممنوع من الانضمام للمجموعات.");
  if (b?.canJoinGroups && b.canReadAllGroupMessages === false) {
    notes.push("وضع الخصوصية مفعّل: البوت لا يقرأ كل رسائل المجموعة.");
  }
  if ((b?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  if ((b?.commands?.length ?? 0) > 0 && (b?.commandsAr?.length ?? 0) === 0) {
    notes.push("توجد أوامر عامة بلا نسخة عربية (language_code=ar).");
  }
  if (!b?.description?.trim() && !b?.shortDescription?.trim()) notes.push("لا يوجد وصف في BotFather.");
  if (!b?.descriptionAr?.trim() && !b?.shortDescriptionAr?.trim()) {
    notes.push("لا يوجد وصف عربي (language_code=ar) في BotFather.");
  }
  if (w?.tokenEmbeddedInUrl) notes.push("رابط الويبهوك يحتوي التوكن — خطر تسريب.");
  if ((b?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة ملف شخصي.");
  if (b?.addedToAttachmentMenu) notes.push("البوت مظهور في قائمة المرفقات.");
  if (b?.menuButton?.type === "web_app" && !b.menuButton.webAppUrl) {
    notes.push("زر القائمة مضبوط كـ Web App بلا رابط.");
  }
  return notes;
}

export default function HealthCheckForm() {
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const extracted = token.trim().match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/)?.[1] || token.trim();
    if (!TOKEN_RE.test(extracted)) {
      setLocalError("صيغة التوكن غير صحيحة.");
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
      const data: Result = await res.json();
      setResult(data);
      if (data.bot && !data.error) {
        setToken("");
        setShowToken(false);
      }
    } catch {
      setResult({ error: "تعذّر الفحص، حاول مجدداً." });
    } finally {
      setLoading(false);
    }
  }

  async function copyReport() {
    const b = result?.bot;
    if (!b) return;
    const notes = collectNotes(result!);
    const w = result?.webhook;
    const slugs = commandSlugs(b.commands);
    const lines = [
      "تقرير فحص بوت — سوق تولز",
      `@${b.username} — ${b.firstName}`,
      ...notes.map((n) => `- ${n}`),
      slugs ? `أوامر: ${slugs}` : "",
      b.addedToAttachmentMenu ? "قائمة المرفقات: مظهور" : "",
      `ويبهوك: ${w?.url || "غير مفعّل"}`,
      w?.hostIsPrivate ? "مضيف الويبهوك: خاص/محلي (غير قابل للوصول من تليجرام)" : "",
      w?.lastErrorDate ? `آخر خطأ ويبهوك: ${fmtDate(w.lastErrorDate)}` : "",
      w?.lastSyncErrorDate ? `آخر خطأ مزامنة: ${fmtDate(w.lastSyncErrorDate)}` : "",
      w?.maxConnections != null ? `أقصى اتصالات: ${w.maxConnections}` : "",
      `صور الملف: ${b.profilePhotoCount ?? 0}`,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const b = result?.bot;
  const w = result?.webhook;
  const notes = result?.bot ? collectNotes(result) : [];
  const tone = notes.some(
    (n) =>
      n.includes("خطأ") ||
      n.includes("HTTPS") ||
      n.includes("تسريب") ||
      n.includes("allowed_updates") ||
      n.includes("متوقف") ||
      n.includes("خاص/محلي"),
  )
    ? "bad"
    : notes.length
      ? "warn"
      : "ok";
  const groupRights = enabledRights(b?.groupAdminRights);
  const channelRights = enabledRights(b?.channelAdminRights);
  const allowedList = w?.allowedUpdates ?? [];
  const slugs = commandSlugs(b?.commands);

  return (
    <main className="relative mx-auto max-w-lg px-4 py-10">
      <SectionBackdrop tone="bots" />
      <span className="mx-auto mb-3 block w-fit rounded-full bg-indigo-50 px-4 py-1.5 text-xs font-bold text-indigo-700">
        🔍 فاحص صحة البوتات
      </span>
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">تحقق من حالة بوت تليجرام</h1>
      <p className="mb-6 text-sm text-slate-600">
        الصق توكن البوت فقط. لا نحفظ التوكن — الفحص لحظي عبر خوادم تليجرام. بعد فحص ناجح يُمسح حقل التوكن من الشاشة.
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
          <button type="button" onClick={() => setShowToken((v) => !v)} className="absolute inset-y-0 end-2 text-xs font-bold text-indigo-700">
            {showToken ? "إخفاء" : "إظهار"}
          </button>
        </div>
        {localError && <p className="text-sm text-rose-700">{localError}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-indigo-700 py-2.5 font-bold text-white hover:bg-indigo-800 disabled:opacity-50">
          {loading ? "جاري الفحص..." : "افحص الآن"}
        </button>
      </form>
      {result?.error && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{result.error}</div>
      )}
      {b && (
        <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div
            className={
              tone === "ok"
                ? "rounded-xl border border-emerald-300 bg-white/80 p-3 text-sm text-emerald-900"
                : tone === "warn"
                  ? "rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  : "rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
            }
          >
            <p className="font-bold">
              {tone === "ok" ? "✅ جاهز" : tone === "warn" ? "⚠️ يحتاج ضبطاً" : "❌ مشكلة في الويبهوك"}
            </p>
            {notes.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 ps-5">
                {notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-sm font-bold text-emerald-800">✅ البوت فعّال: @{b.username}</p>
          <ul className="space-y-1 text-sm text-slate-700">
            <li>الاسم: {b.firstName || "—"}</li>
            {(b.botFatherName || b.botFatherNameAr) && (
              <li>اسم BotFather: {b.botFatherNameAr || b.botFatherName}</li>
            )}
            {b.id != null && <li>المعرّف: {b.id}</li>}
            <li>صور الملف الشخصي: {b.profilePhotoCount ?? 0}</li>
            <li>الأوامر: {b.commands?.length ?? 0} — عربي: {b.commandsAr?.length ?? 0} — خاص: {b.commandsPrivate?.length ?? 0} — مجموعات: {b.commandsGroups?.length ?? 0}</li>
            {slugs ? <li className="font-mono text-xs">أوامر BotFather: {slugs}</li> : null}
            <li>قائمة المرفقات: {yn(b.addedToAttachmentMenu)}</li>
            <li>الوصف: {b.description?.trim() || "غير مضبوط"}</li>
            {b.descriptionAr?.trim() && <li>الوصف العربي: {b.descriptionAr}</li>}
            {b.shortDescription?.trim() && <li>وصف قصير: {b.shortDescription}</li>}
            {b.shortDescriptionAr?.trim() && <li>وصف قصير عربي: {b.shortDescriptionAr}</li>}
            <li>ينضم للمجموعات: {yn(b.canJoinGroups)}</li>
            <li>يقرأ كل رسائل المجموعة: {yn(b.canReadAllGroupMessages)}</li>
            <li>إنلاين: {yn(b.supportsInlineQueries)}</li>
            <li>بوابة الأعمال: {yn(b.canConnectToBusiness)}</li>
            <li>Web App رئيسي: {yn(b.hasMainWebApp)}</li>
            {b.menuButton?.type && (
              <li>
                زر القائمة: {b.menuButton.type}
                {b.menuButton.text ? ` — ${b.menuButton.text}` : ""}
              </li>
            )}
            {b.menuButton?.webAppUrl ? (
              <li className="break-all font-mono text-xs">Web App: {b.menuButton.webAppUrl}</li>
            ) : null}
            {groupRights.length > 0 && <li>صلاحيات مجموعة افتراضية: {groupRights.length}</li>}
            {channelRights.length > 0 && <li>صلاحيات قناة افتراضية: {channelRights.length}</li>}
            <li>الويبهوك: {w?.url ? "مفعّل" : "غير مفعّل"}</li>
            {w?.host && <li>المضيف: {w.host}</li>}
            {w?.hostIsPrivate ? (
              <li className="text-rose-700">مضيف خاص/محلي — تليجرام لا يصل إليه</li>
            ) : null}
            {w?.ipAddress ? <li className="font-mono text-xs">IP الويبهوك: {w.ipAddress}</li> : null}
            {w?.url && <li className="break-all font-mono text-xs">{w.url}</li>}
            {w?.url && (
              <li>شهادة TLS مخصصة: {yn(!!w.hasCustomCertificate)}</li>
            )}
            {w?.maxConnections != null && <li>أقصى اتصالات: {w.maxConnections}</li>}
            <li>
              أنواع التحديثات: {allowedList.length === 0 ? "الكل (افتراضي)" : allowedList.join(", ")}
            </li>
            <li>تحديثات معلّقة: {w?.pendingUpdateCount ?? 0}</li>
            {w?.lastErrorMessage && <li className="text-rose-700">آخر خطأ: {w.lastErrorMessage}</li>}
            {w?.lastErrorDate && (
              <li className="text-rose-700">تاريخ آخر خطأ ويبهوك: {fmtDate(w.lastErrorDate)}</li>
            )}
            {w?.lastSyncErrorDate && (
              <li className="text-rose-700">آخر خطأ مزامنة: {fmtDate(w.lastSyncErrorDate)}</li>
            )}
          </ul>
          <div className="flex flex-wrap gap-2">
            {b.username ? (
              <a
                href={`https://t.me/${b.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-800"
              >
                افتح @{b.username}
              </a>
            ) : null}
            <button
              type="button"
              onClick={copyReport}
              className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-bold text-indigo-800"
            >
              {copied ? "تم نسخ التقرير" : "نسخ ملخص الفحص"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
