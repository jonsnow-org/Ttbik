"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

type BotCommand = { command: string; description: string };
type MenuButton = { type?: string; text?: string; webAppUrl?: string };
type Result = {
  bot?: {
    id?: number;
    username: string;
    firstName: string;
    canJoinGroups: boolean;
    canReadAllGroupMessages: boolean;
    supportsInlineQueries?: boolean;
    hasMainWebApp?: boolean;
    canConnectToBusiness?: boolean;
    addedToAttachmentMenu?: boolean;
    profilePhotoCount?: number;
    commands?: BotCommand[];
    commandsAr?: BotCommand[];
    commandsPrivate?: BotCommand[];
    commandsGroups?: BotCommand[];
    commandsAdmins?: BotCommand[];
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
    port?: number | null;
    portAllowed?: boolean;
    maxConnections?: number | null;
    isHttps?: boolean;
    hostIsIp?: boolean;
    hostIsPrivate?: boolean;
    tokenEmbeddedInUrl?: boolean;
    hasCustomCertificate?: boolean;
    host?: string | null;
    ipAddress?: string | null;
    allowedUpdates?: string[];
  };
  error?: string;
};

function rightsTrue(rights?: Record<string, boolean>): string[] {
  if (!rights) return [];
  return Object.entries(rights)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function collectNotes(result: Result): string[] {
  const notes: string[] = [];
  const w = result.webhook;
  const b = result.bot;
  if (!w?.url) notes.push("لا يوجد ويبهوك — البوت لن يستقبل تحديثات إلا عبر getUpdates.");
  if (w?.url && w.isHttps === false) notes.push("رابط الويبهوك ليس HTTPS — تليجرام يرفض الاستقبال غالباً.");
  if (w?.hostIsPrivate) notes.push(`مضيف الويبهوك خاص/محلي (${w.host ?? "—"}) ولن يصل من تليجرام.`);
  if (w?.hostIsIp) notes.push(`الويبهوك يشير إلى IP مباشر (${w.host ?? "—"}) — يفضّل نطاقاً.`);
  if (w?.tokenEmbeddedInUrl) notes.push("التوكن مضمّن في رابط الويبهوك — انقله لمسار آمن.");
  if (w?.hasCustomCertificate) notes.push("شهادة مخصّصة على الويبهوك — تأكد أنها ما زالت صالحة.");
  if (w?.lastErrorMessage) notes.push(`آخر خطأ ويبهوك: ${w.lastErrorMessage}`);
  if (w?.lastErrorDate) notes.push(`وقت آخر خطأ ويبهوك: ${w.lastErrorDate}`);
  if (w?.lastSyncErrorDate) notes.push(`آخر خطأ مزامنة ويبهوك: ${w.lastSyncErrorDate}`);
  if ((w?.pendingUpdateCount ?? 0) > 100) {
    notes.push(`تحديثات معلّقة مرتفعة (${w?.pendingUpdateCount}) — الويبهوك قد يكون متوقفاً أو بطيئاً.`);
  } else if ((w?.pendingUpdateCount ?? 0) > 0) {
    notes.push(`تحديثات معلّقة: ${w?.pendingUpdateCount} — ليست حرجة بعد.`);
  }
  if (w?.url && w.portAllowed === false) {
    notes.push(`منفذ الويبهوك غير مسموح (${w.port}). المسموح: 443 / 80 / 88 / 8443.`);
  }
  if ((w?.maxConnections ?? 0) > 100) {
    notes.push(`maxConnections=${w?.maxConnections} أعلى من حد تليجرام الشائع (100).`);
  }
  const au = w?.allowedUpdates ?? [];
  if (w?.url && au.length > 0) {
    if (!au.includes("message")) notes.push("allowed_updates لا يتضمن message — الرسائل العادية قد لا تصل.");
    if (!au.includes("callback_query")) notes.push("allowed_updates لا يتضمن callback_query — أزرار الإنلاين قد لا تعمل.");
  }
  if ((b?.commands?.length ?? 0) === 0) notes.push("قائمة الأوامر فارغة في BotFather.");
  const allCmds = [
    ...(b?.commands ?? []),
    ...(b?.commandsAr ?? []),
    ...(b?.commandsPrivate ?? []),
    ...(b?.commandsGroups ?? []),
    ...(b?.commandsAdmins ?? []),
  ];
  const emptyDesc = [...new Set(allCmds.filter((c) => !c.description?.trim()).map((c) => `/${c.command}`))];
  if (emptyDesc.length) notes.push(`أوامر بلا وصف: ${emptyDesc.slice(0, 6).join(" ")}`);
  const longDesc = [...new Set(allCmds.filter((c) => (c.description?.trim().length ?? 0) > 256).map((c) => `/${c.command}`))];
  if (longDesc.length) notes.push(`وصف أمر أطول من 256: ${longDesc.slice(0, 6).join(" ")}`);
  const badSlug = [...new Set(allCmds.filter((c) => !/^[a-z0-9_]{1,32}$/.test(c.command)).map((c) => `/${c.command}`))];
  if (badSlug.length) notes.push(`صيغة أمر غير صالحة: ${badSlug.slice(0, 6).join(" ")}`);
  const full = b?.description?.trim() ?? "";
  const shortD = b?.shortDescription?.trim() ?? "";
  if (full && !shortD) notes.push("وصف كامل موجود بلا وصف قصير في BotFather.");
  if (!full && shortD) notes.push("وصف قصير موجود بلا وصف كامل في BotFather.");
  if ((full.length ?? 0) > 512) notes.push("الوصف الكامل أطول من 512 حرفاً.");
  if ((shortD.length ?? 0) > 120) notes.push("الوصف القصير أطول من 120 حرفاً.");
  const fullAr = b?.descriptionAr?.trim() ?? "";
  const shortAr = b?.shortDescriptionAr?.trim() ?? "";
  if (fullAr && !shortAr) notes.push("وصف عربي كامل موجود بلا وصف عربي قصير.");
  if (!fullAr && shortAr) notes.push("وصف عربي قصير موجود بلا وصف عربي كامل.");
  if (b?.canJoinGroups === false) notes.push("البوت لا يستطيع الانضمام للمجموعات (can_join_groups=false).");
  if (b?.canJoinGroups && b?.canReadAllGroupMessages === false) {
    notes.push("ينضم للمجموعات لكن لا يقرأ كل الرسائل — وضع الخصوصية مفعّل.");
  }
  if ((b?.commandsGroups?.length ?? 0) > 0 && b?.canJoinGroups === false) {
    notes.push("أوامر مجموعات معرّفة بينما البوت لا يستطيع الانضمام للمجموعات.");
  }
  if (b?.supportsInlineQueries === false) notes.push("الاستعلامات المضمّنة غير مفعّلة في BotFather.");
  const uname = (b?.username ?? "").toLowerCase();
  if (uname && !uname.endsWith("bot")) notes.push(`المعرّف @${b?.username} لا ينتهي بـ bot — شرط تليجرام للبوتات العامة.`);
  if ((b?.profilePhotoCount ?? 0) === 0) notes.push("لا توجد صورة بروفايل للبوت في BotFather.");
  if (b?.hasMainWebApp) notes.push("ويب آب رئيسي مفعّل (has_main_web_app).");
  if (b?.canConnectToBusiness) notes.push("البوت يمكنه الاتصال بحسابات Telegram Business.");
  if (b?.addedToAttachmentMenu) notes.push("البوت مضاف لقائمة المرفقات.");
  const menu = b?.menuButton;
  if (menu?.type === "web_app" && !menu.webAppUrl) {
    notes.push("زر القائمة من نوع web_app بلا رابط.");
  }
  if (menu?.type === "web_app" && menu.webAppUrl && !menu.webAppUrl.startsWith("https://")) {
    notes.push("رابط ويب آب زر القائمة ليس HTTPS.");
  }
  if ((b?.commandsAdmins?.length ?? 0) > 0 && rightsTrue(b?.groupAdminRights).length === 0) {
    notes.push("أوامر للمشرفين معرّفة بينما صلاحيات الأدمن الافتراضية للمجموعات فارغة.");
  }
  return notes;
}

function buildReport(result: Result, notes: string[]): string {
  const b = result.bot;
  const w = result.webhook;
  const au = w?.allowedUpdates ?? [];
  const menu = b?.menuButton;
  const gRights = rightsTrue(b?.groupAdminRights);
  const cRights = rightsTrue(b?.channelAdminRights);
  const lines = [
    `تقرير فحص @${b?.username ?? "—"} — ${b?.firstName ?? ""}`,
    b?.id != null ? `المعرّف: ${b.id}` : "",
    `الويبهوك: ${w?.url ? "مفعّل" : "غير مفعّل"}`,
    w?.url && w.port != null ? `المنفذ: ${w.port}` : "",
    w?.host ? `المضيف: ${w.host}` : "",
    w?.ipAddress ? `IP الويبهوك: ${w.ipAddress}` : "",
    au.length ? `allowed_updates: ${au.join(", ")}` : "allowed_updates: الكل (افتراضي)",
    w?.lastErrorDate ? `آخر خطأ: ${w.lastErrorDate}` : "",
    w?.lastErrorMessage ? `نص الخطأ: ${w.lastErrorMessage}` : "",
    w?.lastSyncErrorDate ? `آخر خطأ مزامنة: ${w.lastSyncErrorDate}` : "",
    `تحديثات معلّقة: ${w?.pendingUpdateCount ?? 0}`,
    `المجموعات: ${b?.canJoinGroups ? "يمكنه الانضمام" : "لا ينضم"}`,
    `قراءة كل رسائل المجموعة: ${b?.canReadAllGroupMessages ? "نعم" : "لا"}`,
    `إنلاين: ${b?.supportsInlineQueries ? "مدعوم" : "غير مدعوم"}`,
    `ويب آب رئيسي: ${b?.hasMainWebApp ? "نعم" : "لا"}`,
    `Telegram Business: ${b?.canConnectToBusiness ? "مدعوم" : "غير مدعوم"}`,
    `قائمة المرفقات: ${b?.addedToAttachmentMenu ? "مضاف" : "غير مضاف"}`,
    `صور البروفايل: ${b?.profilePhotoCount ?? 0}`,
    `زر القائمة: ${menu?.type ?? "افتراضي"}${menu?.text ? ` — ${menu.text}` : ""}`,
    menu?.webAppUrl ? `ويب آب القائمة: ${menu.webAppUrl}` : "",
    gRights.length ? `صلاحيات مجموعة: ${gRights.join(", ")}` : "صلاحيات مجموعة: لا شيء مفعّل",
    cRights.length ? `صلاحيات قناة: ${cRights.join(", ")}` : "صلاحيات قناة: لا شيء مفعّل",
    `أوامر: ${b?.commands?.length ?? 0} / عربي ${b?.commandsAr?.length ?? 0}`,
    notes.length ? "ملاحظات:" : "لا ملاحظات.",
    ...notes.map((n) => `- ${n}`),
  ].filter(Boolean);
  return lines.join("\n");
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
    setCopied(false);
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

  const b = result?.bot;
  const w = result?.webhook;
  const notes = result?.bot ? collectNotes(result) : [];
  const au = w?.allowedUpdates ?? [];
  const menu = b?.menuButton;
  const gRights = rightsTrue(b?.groupAdminRights);
  const cRights = rightsTrue(b?.channelAdminRights);

  async function copyReport() {
    if (!result?.bot) return;
    try {
      await navigator.clipboard.writeText(buildReport(result, notes));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="relative mx-auto max-w-lg px-4 py-10">
      <SectionBackdrop tone="bots" />
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">تحقق من حالة بوت تليجرام</h1>
      <p className="mb-6 text-sm text-slate-600">الصق التوكن فقط. لا نحفظه. بعد فحص ناجح يُمسح الحقل.</p>
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
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 pe-20 font-mono text-sm"
          />
          <button type="button" onClick={() => setShowToken((v) => !v)} className="absolute inset-y-0 end-2 text-xs font-bold text-indigo-700">
            {showToken ? "إخفاء" : "إظهار"}
          </button>
        </div>
        {localError && <p className="text-sm text-rose-700">{localError}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-xl bg-indigo-700 py-2.5 font-bold text-white disabled:opacity-50">
          {loading ? "جاري الفحص..." : "افحص الآن"}
        </button>
      </form>
      {result?.error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{result.error}</div>}
      {b && (
        <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          {notes.length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5 text-sm text-amber-900">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-sm font-bold text-emerald-800">✅ @{b.username} — {b.firstName}</p>
          <ul className="space-y-1 text-sm text-slate-700">
            {b.id != null && <li>المعرّف: {b.id}</li>}
            <li>الويبهوك: {w?.url ? "مفعّل" : "غير مفعّل"}</li>
            {w?.host ? <li>المضيف: {w.host}</li> : null}
            {w?.ipAddress ? <li>IP الويبهوك: {w.ipAddress}</li> : null}
            {w?.url && w.port != null && <li>منفذ: {w.port}{w.portAllowed === false ? " — غير مسموح" : ""}</li>}
            {w?.maxConnections != null && <li>أقصى اتصالات: {w.maxConnections}</li>}
            <li>allowed_updates: {au.length ? au.join(", ") : "الكل (افتراضي تليجرام)"}</li>
            {w?.lastErrorDate ? <li>آخر خطأ ويبهوك: {w.lastErrorDate}</li> : null}
            {w?.lastErrorMessage ? <li>نص آخر خطأ: {w.lastErrorMessage}</li> : null}
            {w?.lastSyncErrorDate ? <li>آخر خطأ مزامنة: {w.lastSyncErrorDate}</li> : null}
            <li>تحديثات معلّقة: {w?.pendingUpdateCount ?? 0}</li>
            <li>المجموعات: {b.canJoinGroups ? "يمكنه الانضمام" : "لا ينضم"}</li>
            <li>قراءة كل رسائل المجموعة: {b.canReadAllGroupMessages ? "نعم" : "لا"}</li>
            <li>استعلامات إنلاين: {b.supportsInlineQueries ? "مدعومة" : "غير مدعومة"}</li>
            <li>ويب آب رئيسي: {b.hasMainWebApp ? "نعم" : "لا"}</li>
            <li>Telegram Business: {b.canConnectToBusiness ? "مدعوم" : "غير مدعوم"}</li>
            <li>قائمة المرفقات: {b.addedToAttachmentMenu ? "مضاف" : "غير مضاف"}</li>
            <li>صور البروفايل: {b.profilePhotoCount ?? 0}</li>
            <li>زر القائمة: {menu?.type ?? "افتراضي"}{menu?.text ? ` — ${menu.text}` : ""}</li>
            {menu?.webAppUrl ? <li>ويب آب القائمة: {menu.webAppUrl}</li> : null}
            <li>صلاحيات مجموعة: {gRights.length ? gRights.join(", ") : "لا شيء مفعّل"}</li>
            <li>صلاحيات قناة: {cRights.length ? cRights.join(", ") : "لا شيء مفعّل"}</li>
            <li>أوامر: {b.commands?.length ?? 0} / عربي {b.commandsAr?.length ?? 0}</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            {b.username ? (
              <a href={`https://t.me/${b.username}`} target="_blank" rel="noopener noreferrer" className="inline-block rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white">
                افتح @{b.username}
              </a>
            ) : null}
            <button type="button" onClick={copyReport} className="rounded-xl border border-indigo-300 bg-white px-4 py-2 text-sm font-bold text-indigo-800">
              {copied ? "نُسخ التقرير" : "نسخ التقرير"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
