"use client";

import { useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";
import {
  TOKEN_RE,
  collectNotes,
  buildReport,
  rightsTrue,
  maskWebhookUrl,
  type Result,
} from "./HealthCheckForm.helpers";

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
        signal: AbortSignal.timeout(30_000),
      });
      const data: Result = await res.json().catch(() => ({ error: "تعذّر قراءة رد الخادم." }));
      setResult(data);
      if (data.bot && !data.error) {
        setToken("");
        setShowToken(false);
      }
    } catch (err: unknown) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
      const timedOut = name === "TimeoutError" || name === "AbortError";
      setResult({
        error: timedOut
          ? "انتهت مهلة الفحص — حاول مجدداً."
          : "تعذّر الفحص، حاول مجدداً.",
      });
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
  const shortD = (b?.shortDescription ?? "").trim();
  const shortArUi = (b?.shortDescriptionAr ?? "").trim();
  const fullD = (b?.description ?? "").trim();
  const fullAr = (b?.descriptionAr ?? "").trim();

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
            disabled={loading}
            onChange={(e) => {
              setToken(e.target.value);
              setLocalError(null);
            }}
            placeholder="الصق توكن البوت هنا"
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 pe-20 font-mono text-sm disabled:opacity-60"
          />
          <button type="button" disabled={loading} onClick={() => setShowToken((v) => !v)} className="absolute inset-y-0 end-2 text-xs font-bold text-indigo-700 disabled:opacity-50">
            {showToken ? "إخفاء" : "إظهار"}
          </button>
        </div>
        {localError && <p className="text-sm text-rose-700" role="alert">{localError}</p>}
        <button type="submit" disabled={loading} aria-busy={loading} className="w-full rounded-xl bg-indigo-700 py-2.5 font-bold text-white disabled:opacity-50">
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
            {b.botFatherName ? <li>اسم BotFather: {b.botFatherName}</li> : null}
            {b.botFatherNameAr ? <li>اسم BotFather عربي: {b.botFatherNameAr}</li> : null}
            {shortD ? <li>وصف قصير: {shortD.slice(0, 120)}</li> : null}
            {shortArUi ? <li>وصف عربي قصير: {shortArUi.slice(0, 120)}</li> : null}
            {fullD ? <li>وصف كامل: {fullD.slice(0, 160)}</li> : null}
            {fullAr ? <li>وصف عربي كامل: {fullAr.slice(0, 160)}</li> : null}
            <li>الويبهوك: {w?.url ? "مفعّل" : "غير مفعّل"}</li>
            {w?.url ? <li>رابط الويبهوك (مقنّع): {maskWebhookUrl(w.url)}</li> : null}
            {w?.host ? <li>المضيف: {w.host}</li> : null}
            {w?.ipAddress ? <li>IP الويبهوك: {w.ipAddress}</li> : null}
            {w?.url && w.port != null && <li>منفذ: {w.port}{w.portAllowed === false ? " — غير مسموح" : ""}</li>}
            {w?.url ? <li>HTTPS: {w.isHttps === false ? "لا" : "نعم"}</li> : null}
            {w?.url ? <li>شهادة مخصّصة: {w.hasCustomCertificate ? "نعم" : "لا"}</li> : null}
            {w?.url ? <li>توكن في الرابط: {w.tokenEmbeddedInUrl ? "نعم" : "لا"}</li> : null}
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
            <li>أوامر عامة: {b.commands?.length ?? 0} / عربي {b.commandsAr?.length ?? 0}</li>
            {(b.commands?.length ?? 0) > 0 ? (
              <li>عيّنة أوامر عامة: {(b.commands ?? []).slice(0, 8).map((c) => `/${c.command}`).join(" ")}</li>
            ) : null}
            <li>أوامر خاصة/مجموعات/مشرفين: {b.commandsPrivate?.length ?? 0} / {b.commandsGroups?.length ?? 0} / {b.commandsAdmins?.length ?? 0}</li>
            {(b.commandsPrivate?.length ?? 0) > 0 ? (
              <li>عيّنة خاصة: {(b.commandsPrivate ?? []).slice(0, 6).map((c) => `/${c.command}`).join(" ")}</li>
            ) : null}
            {(b.commandsGroups?.length ?? 0) > 0 ? (
              <li>عيّنة مجموعات: {(b.commandsGroups ?? []).slice(0, 6).map((c) => `/${c.command}`).join(" ")}</li>
            ) : null}
            {(b.commandsAdmins?.length ?? 0) > 0 ? (
              <li>عيّنة مشرفين: {(b.commandsAdmins ?? []).slice(0, 6).map((c) => `/${c.command}`).join(" ")}</li>
            ) : null}
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
