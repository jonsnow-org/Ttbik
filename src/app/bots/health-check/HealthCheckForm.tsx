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
    ipAddress?: string | null;
    maxConnections?: number | null;
    allowedUpdates?: string[];
    hasCustomCertificate?: boolean;
    isHttps?: boolean;
    host?: string | null;
    tokenEmbeddedInUrl?: boolean;
    hostIsIp?: boolean;
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

function omittedCoreUpdates(allowed?: string[]) {
  if (!allowed || allowed.length === 0) return [];
  const set = new Set(allowed);
  const core = ["message", "callback_query"];
  return core.filter((t) => !set.has(t));
}

function isPrivateWebhookHost(host?: string | null) {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h.endsWith(".local") ||
    h.startsWith("192.168.") ||
    h.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

function isRawIpHost(host?: string | null, flagged?: boolean) {
  if (flagged) return true;
  if (!host) return false;
  const h = host.split(":")[0];
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h);
}

function hoursSince(iso?: string | null) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 36e5;
}

function isTelegramApiHost(host?: string | null) {
  if (!host) return false;
  const h = host.split(":")[0].toLowerCase();
  return h === "api.telegram.org" || h.endsWith(".telegram.org") || h === "telegram.org";
}

function commandsMissingDescriptions(cmds?: BotCommand[]) {
  if (!cmds || cmds.length === 0) return false;
  return cmds.every((c) => !c.description?.trim());
}

const CMD_NAME_RE = /^[a-z0-9_]{1,32}$/;

function invalidCommandNames(cmds?: BotCommand[]) {
  return (cmds ?? []).filter((c) => !CMD_NAME_RE.test(c.command));
}

function readiness(result: Result): { tone: "ok" | "warn" | "bad"; title: string; notes: string[] } {
  const notes: string[] = [];
  const w = result.webhook;
  const b = result.bot;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates اليدوي.");
  const pending = w?.pendingUpdateCount ?? 0;
  if (pending > 10) notes.push(`تراكم تحديثات معلّق (${pending}) — الويبهوك قد يكون متوقفاً أو بطيئاً.`);
  else if (pending > 0) notes.push(`يوجد تحديثات معلّقة (${pending}) — الويبهوك ربما متأخر قليلاً.`);
  if (w?.lastErrorMessage) {
    const when = fmtDate(w.lastErrorDate);
    notes.push(when ? `آخر خطأ ويبهوك (${when}): ${w.lastErrorMessage}` : `آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  } else if (w?.lastErrorDate) {
    notes.push(`يوجد تاريخ خطأ ويبهوك بدون نص: ${fmtDate(w.lastErrorDate)}`);
  }
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS — تليجرام يرفض الاستقبال غالباً.");
  if (w?.lastSyncErrorDate) {
    const h = hoursSince(w.lastSyncErrorDate);
    notes.push(
      h != null && h <= 24
        ? `خطأ مزامنة ويبهوك خلال آخر 24 ساعة (${fmtDate(w.lastSyncErrorDate)}).`
        : "يوجد خطأ مزامنة أخير على الويبهوك.",
    );
  }
  const lastErrHours = hoursSince(w?.lastErrorDate);
  if (w?.url && lastErrHours != null && lastErrHours <= 24) {
    notes.push(`خطأ ويبهوك حديث خلال آخر 24 ساعة (${fmtDate(w.lastErrorDate)}).`);
  }
  if (w?.url && isTelegramApiHost(w.host)) {
    notes.push("مضيف الويبهوك يشير إلى api.telegram.org — هذا ليس خادمك؛ التسليم لن يعمل.");
  }
  if (!b?.username?.trim()) {
    notes.push("البوت بلا معرف @username — لا يمكن فتحه من رابط عام حتى يُعيَّن في BotFather.");
  }
  if (w?.url && isPrivateWebhookHost(w.host)) {
    notes.push("مضيف الويبهوك محلي/خاص — خوادم تليجرام على الإنترنت لن تصله.");
  }
  if (w?.url && isRawIpHost(w.host, w.hostIsIp) && !isPrivateWebhookHost(w.host)) {
    notes.push("مضيف الويبهوك عنوان IP خام — شهادات TLS على IP غالباً تفشل؛ استخدم نطاقاً.");
  }
  if (w?.url && w.maxConnections != null && w.maxConnections < 10) {
    notes.push(`أقصى اتصالات منخفض (${w.maxConnections}) — قد يتراكم الطابور تحت الحمل.`);
  }
  const omitted = omittedCoreUpdates(w?.allowedUpdates);
  if (w?.url && omitted.length) {
    notes.push(`allowedUpdates تستبعد أنواعاً أساسية (${omitted.join(", ")}) — البوت قد لا يستقبل رسائل أو أزرار.`);
  }
  if (b?.canJoinGroups === false) notes.push("البوت ممنوع من الانضمام للمجموعات في BotFather.");
  if (b?.canJoinGroups && enabledRights(b.groupAdminRights).length === 0) {
    notes.push("الانضمام للمجموعات مسموح لكن لا توجد صلاحيات أدمن افتراضية للمجموعات.");
  }
  if (b?.canJoinGroups && b.canReadAllGroupMessages === false) {
    notes.push("وضع الخصوصية مفعّل: البوت لا يقرأ رسائل المجموعة إلا إذا ذُكر أو رُدّ عليه — عطّله من BotFather إن كان البوت يعتمد على كل الرسائل.");
  }
  if ((b?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  if (commandsMissingDescriptions(b?.commands)) {
    notes.push("الأوامر مسجلة بدون وصف في BotFather — القائمة تظهر ناقصة للزبون.");
  }
  const badCmds = invalidCommandNames(b?.commands);
  if (badCmds.length) {
    notes.push(
      `أسماء أوامر غير صالحة في BotFather (${badCmds
        .slice(0, 5)
        .map((c) => `/${c.command}`)
        .join("، ")}${badCmds.length > 5 ? "…" : ""}) — المسموح: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية حتى 32 حرفاً.`,
    );
  }
  if ((b?.commands?.length ?? 0) > 100) {
    notes.push(`عدد الأوامر (${b?.commands?.length}) يتجاوز حد تليجرام 100 — القائمة قد تُرفض أو تُقصّ.`);
  }
  if (b?.description?.trim() && !b?.shortDescription?.trim()) {
    notes.push("يوجد وصف طويل لكن الوصف المختصر فارغ — قائمة الدردشات تعرض الموجز فقط.");
  }
  if (!b?.description?.trim() && !b?.shortDescription?.trim()) notes.push("لا يوجد وصف مسجل في BotFather.");
  if ((b?.commands?.length ?? 0) > 0 && (b?.commandsAr?.length ?? 0) === 0) notes.push("لا توجد قائمة أوامر عربية (لغة ar) في BotFather.");
  if ((b?.commands?.length ?? 0) === 0 && ((b?.commandsPrivate?.length ?? 0) > 0 || (b?.commandsGroups?.length ?? 0) > 0)) {
    notes.push("الأوامر الافتراضية فارغة لكن توجد أوامر لنطاق المحادثات الخاصة أو المجموعات.");
  }
  if (w?.tokenEmbeddedInUrl) notes.push("رابط الويبهوك يحتوي التوكن نفسه — أي سجل خادم يحتفظ بالرابط يعرّض التوكن للتسريب.");
  if ((b?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة ملف شخصي في BotFather.");
  if ((b?.description?.trim() || b?.shortDescription?.trim()) && !b?.descriptionAr?.trim() && !b?.shortDescriptionAr?.trim()) {
    notes.push("لا يوجد وصف عربي (لغة ar) في BotFather.");
  }
  if (b?.botFatherName?.trim() && b.firstName && b.botFatherName.trim() !== b.firstName) {
    notes.push(`اسم BotFather («${b.botFatherName.trim()}») يختلف عن first_name («${b.firstName}»).`);
  }
  const menuUrl = b?.menuButton?.webAppUrl?.trim() || "";
  if (b?.menuButton?.type === "web_app" && !menuUrl) {
    notes.push("زر القائمة مضبوط كويب آب بلا رابط — الزر لن يفتح شيئاً.");
  }
  if (menuUrl && !menuUrl.startsWith("https://")) {
    notes.push("رابط ويب آب زر القائمة ليس HTTPS — تليجرام يرفض فتحه.");
  }
  if (b?.hasMainWebApp && b?.menuButton?.type !== "web_app") {
    notes.push("للبوت ويب آب رئيسي لكن زر قائمة الدردشة ليس ويب آب — الزبون قد لا يجد الواجهة.");
  }
  if (w?.url && w.hasCustomCertificate) {
    notes.push("الويبهوك يستخدم شهادة TLS مخصصة — إن لم تكن موقّعة من جهة معروفة قد يفشل التسليم.");
  }
  if (notes.some((n) => n.startsWith("آخر خطأ") || n.startsWith("تراكم") || n.includes("ليس HTTPS") || n.startsWith("يوجد تاريخ خطأ") || n.startsWith("allowedUpdates") || n.startsWith("مضيف الويبهوك محلي") || n.startsWith("مضيف الويبهوك عنوان IP") || n.startsWith("مضيف الويبهوك يشير") || n.startsWith("رابط الويبهوك يحتوي التوكن") || n.startsWith("رابط ويب آب") || n.startsWith("خطأ ويبهوك حديث") || n.startsWith("خطأ مزامنة ويبهوك خلال"))) {
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
    const omitted = omittedCoreUpdates(w?.allowedUpdates);
    const cmdLines = (b.commands ?? []).slice(0, 12).map((c) => `/${c.command}${c.description?.trim() ? ` — ${c.description.trim()}` : " — بدون وصف"}`);
    const lines = [
      `تقرير فحص بوت — سوق تولز`,
      `الخلاصة: ${verdict.title}`,
      ...verdict.notes.map((n) => `- ${n}`),
      `@${b.username} (المعرّف: ${b.id ?? "—"})`,
      `الاسم: ${b.firstName}`,
      b.botFatherName?.trim() ? `اسم BotFather: ${b.botFatherName.trim()}` : "",
      b.botFatherNameAr?.trim() ? `اسم BotFather عربي: ${b.botFatherNameAr.trim()}` : "",
      b.description?.trim() ? `الوصف: ${b.description.trim()}` : "",
      `ينضم للمجموعات: ${yn(b.canJoinGroups)}`,
      `يقرأ كل رسائل المجموعة: ${yn(b.canReadAllGroupMessages)}`,
      b.canJoinGroups && b.canReadAllGroupMessages === false ? "وضع الخصوصية: مفعّل (لا يقرأ كل رسائل المجموعة)" : "",
      `إنلاين: ${yn(b.supportsInlineQueries)}`,
      `اتصال Telegram Business: ${yn(b.canConnectToBusiness)}`,
      `قائمة المرفقات: ${yn(b.addedToAttachmentMenu)}`,
      cmdLines.length ? `أوامر:` : "",
      ...cmdLines,
      invalidCommandNames(b.commands).length
        ? `أوامر بأسماء غير صالحة: ${invalidCommandNames(b.commands)
            .slice(0, 8)
            .map((c) => `/${c.command}`)
            .join("، ")}`
        : "",
      (b.commands?.length ?? 0) > 100 ? `عدد الأوامر يتجاوز 100: ${b.commands!.length}` : "",
      b.description?.trim() && !b.shortDescription?.trim() ? "الوصف المختصر فارغ مع وجود وصف طويل" : "",
      `الويبهوك: ${w?.url ? "مفعّل" : "غير مفعّل"}`,
      w?.host ? `مضيف الويبهوك: ${w.host}` : "",
      w?.url && isPrivateWebhookHost(w.host) ? "مضيف محلي/خاص: نعم" : "",
      w?.url && isRawIpHost(w.host, w.hostIsIp) ? "مضيف IP خام: نعم" : "",
      w?.url && isTelegramApiHost(w.host) ? "مضيف الويبهوك هو api.telegram.org: نعم" : "",
      hoursSince(w?.lastErrorDate) != null && hoursSince(w?.lastErrorDate)! <= 24 ? `خطأ ويبهوك خلال 24 ساعة: ${fmtDate(w?.lastErrorDate)}` : "",
      !b.username?.trim() ? "بلا @username" : "",
      w?.maxConnections != null && w.maxConnections < 10 ? `أقصى اتصالات منخفض: ${w.maxConnections}` : "",
      w?.ipAddress ? `عنوان IP: ${w.ipAddress}` : "",
      w?.maxConnections != null ? `أقصى اتصالات: ${w.maxConnections}` : "",
      w?.url ? `HTTPS: ${w.isHttps === false ? "لا" : "نعم"}` : "",
      w?.url ? `شهادة TLS مخصصة: ${yn(w.hasCustomCertificate)}` : "",
      `التحديثات المسموحة: ${(w?.allowedUpdates?.length ?? 0) > 0 ? w!.allowedUpdates!.join(", ") : "كل الأنواع (الافتراضي)"}`,
      omitted.length ? `أنواع مستبعدة أساسية: ${omitted.join(", ")}` : "",
      w?.lastErrorDate ? `وقت آخر خطأ ويبهوك: ${fmtDate(w.lastErrorDate)}` : "",
      (b.commandsPrivate?.length ?? 0) > 0 ? `أوامر المحادثات الخاصة: ${b.commandsPrivate!.length}` : "",
      (b.commandsGroups?.length ?? 0) > 0 ? `أوامر المجموعات: ${b.commandsGroups!.length}` : "",
      w?.tokenEmbeddedInUrl ? "التوكن مضمّن في رابط الويبهوك: نعم" : "",
      b.menuButton?.type === "web_app" && !(b.menuButton.webAppUrl || "").startsWith("https://") ? "ويب آب زر القائمة بدون HTTPS" : "",
      b.hasMainWebApp && b.menuButton?.type !== "web_app" ? "ويب آب رئيسي بدون زر قائمة ويب آب" : "",
      w?.url && w.hasCustomCertificate ? "شهادة TLS مخصصة على الويبهوك: نعم" : "",
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
  const omitted = omittedCoreUpdates(w?.allowedUpdates);
  const privateHost = isPrivateWebhookHost(w?.host);
  const commandPreview = (b?.commands ?? []).slice(0, 12);

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
            {b.botFatherName?.trim() && <li>اسم BotFather: {b.botFatherName.trim()}</li>}
            {b.botFatherNameAr?.trim() && <li>اسم BotFather عربي: {b.botFatherNameAr.trim()}</li>}
            {b.id != null && <li>المعرّف: {b.id}</li>}
            <li>صورة الملف: {(b.profilePhotoCount ?? 0) > 0 ? `${b.profilePhotoCount} صورة` : "غير مضبوطة"}</li>
            <li>الوصف: {b.description?.trim() || "غير مضبوط"}</li>
            <li>الانضمام للمجموعات: {yn(b.canJoinGroups)}</li>
            <li>قراءة كل رسائل المجموعة: {yn(b.canReadAllGroupMessages)}</li>
            {b.canJoinGroups && b.canReadAllGroupMessages === false && (
              <li className="text-amber-800">وضع الخصوصية مفعّل — البوت لا يرى رسائل المجموعة إلا عند الذكر أو الرد</li>
            )}
            <li>استعلامات إنلاين: {yn(b.supportsInlineQueries)}</li>
            <li>ويب آب رئيسي: {yn(b.hasMainWebApp)}</li>
            <li>اتصال Telegram Business: {yn(b.canConnectToBusiness)}</li>
            <li>قائمة المرفقات: {yn(b.addedToAttachmentMenu)}</li>
            <li>الوصف المختصر: {b.shortDescription?.trim() || "غير مضبوط"}</li>
            <li>الوصف المختصر العربي: {b.shortDescriptionAr?.trim() || "غير مضبوط"}</li>
            <li>الوصف العربي (ar): {b.descriptionAr?.trim() || "غير مضبوط"}</li>
            <li>أوامر: {b.commands?.length ?? 0} — عربي: {b.commandsAr?.length ?? 0}</li>
            {invalidCommandNames(b.commands).length > 0 && (
              <li className="text-amber-800">
                أوامر بأسماء غير صالحة: {invalidCommandNames(b.commands).slice(0, 6).map((c) => `/${c.command}`).join("، ")}
              </li>
            )}
            {(b.commands?.length ?? 0) > 100 && (
              <li className="text-amber-800">عدد الأوامر يتجاوز حد تليجرام 100</li>
            )}
            {!!b.description?.trim() && !b.shortDescription?.trim() && (
              <li className="text-amber-800">الوصف المختصر فارغ — قائمة الدردشات لن تعرض موجزاً</li>
            )}
            {commandPreview.length > 0 && (
              <li>
                أوامر BotFather:
                <ul className="mt-1 list-disc space-y-0.5 ps-5 text-xs">
                  {commandPreview.map((c) => (
                    <li key={c.command}>
                      /{c.command} — {c.description?.trim() || "بدون وصف"}
                    </li>
                  ))}
                  {(b.commands?.length ?? 0) > commandPreview.length && <li>…</li>}
                </ul>
              </li>
            )}
            <li>زر القائمة: {menuLabel(b.menuButton)}</li>
            {b.menuButton?.type === "web_app" && !(b.menuButton.webAppUrl || "").startsWith("https://") && (
              <li className="text-rose-700">رابط ويب آب زر القائمة مفقود أو ليس HTTPS</li>
            )}
            {b.hasMainWebApp && b.menuButton?.type !== "web_app" && (
              <li className="text-amber-800">ويب آب رئيسي موجود لكن زر القائمة ليس ويب آب</li>
            )}
            {w?.url && w.hasCustomCertificate && (
              <li className="text-amber-800">شهادة TLS مخصصة على الويبهوك — تحقق أنها مقبولة من تليجرام</li>
            )}
            {(b.commandsPrivate?.length ?? 0) > 0 && (
              <li>أوامر المحادثات الخاصة: {b.commandsPrivate!.length}</li>
            )}
            {(b.commandsGroups?.length ?? 0) > 0 && (
              <li>أوامر المجموعات: {b.commandsGroups!.length}</li>
            )}
            {w?.tokenEmbeddedInUrl && (
              <li className="text-rose-700">رابط الويبهوك يحتوي التوكن — خطر تسريب عبر السجلات</li>
            )}
            <li>صلاحيات مجموعات: {enabledRights(b.groupAdminRights).join(", ") || "لا شيء"}</li>
            <li>صلاحيات قنوات: {enabledRights(b.channelAdminRights).join(", ") || "لا شيء"}</li>
            {w?.url ? (
              <>
                <li>الويبهوك: مفعّل</li>
                <li className="break-all font-mono text-xs">{w.url}</li>
                {w.host && <li>المضيف: {w.host}</li>}
                {privateHost && <li className="text-rose-700">مضيف محلي/خاص — تليجرام العلني لن يصل إليه</li>}
                {isRawIpHost(w.host, w.hostIsIp) && !privateHost && (
                  <li className="text-rose-700">مضيف IP خام — فضّل نطاقاً بشهادة TLS صحيحة</li>
                )}
                {isTelegramApiHost(w.host) && (
                  <li className="text-rose-700">المضيف هو خادم تليجرام نفسه — عيّن رابط خادمك</li>
                )}
                {hoursSince(w.lastErrorDate) != null && hoursSince(w.lastErrorDate)! <= 24 && (
                  <li className="text-rose-700">خطأ ويبهوك خلال آخر 24 ساعة</li>
                )}
                {w.ipAddress && <li>عنوان IP: {w.ipAddress}</li>}
                {w.maxConnections != null && (
                  <li className={w.maxConnections < 10 ? "text-amber-800" : undefined}>أقصى اتصالات: {w.maxConnections}</li>
                )}
                <li>HTTPS: {w.isHttps === false ? "لا" : "نعم"}</li>
                <li>شهادة TLS مخصصة: {yn(w.hasCustomCertificate)}</li>
                <li>التحديثات المسموحة: {(w.allowedUpdates?.length ?? 0) > 0 ? w.allowedUpdates!.join(", ") : "كل الأنواع (الافتراضي)"}</li>
                {omitted.length > 0 && <li className="text-rose-700">أنواع أساسية مستبعدة: {omitted.join(", ")}</li>}
                <li>تحديثات معلّقة: {w.pendingUpdateCount}</li>
                {w.lastErrorMessage && <li className="text-rose-700">آخر خطأ: {w.lastErrorMessage}</li>}
                {w.lastErrorDate && <li className="text-rose-700">وقت آخر خطأ: {fmtDate(w.lastErrorDate)}</li>}
                {w.lastSyncErrorDate && <li className="text-amber-800">خطأ مزامنة: {fmtDate(w.lastSyncErrorDate)}</li>}
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
