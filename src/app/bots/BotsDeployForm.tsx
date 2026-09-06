"use client";

import { useEffect, useState } from "react";
import { getCategoryTheme } from "@/lib/categoryTheme";
import SectionBackdrop from "@/components/SectionBackdrop";

const theme = getCategoryTheme("bots");

/** Extract bot token if user pastes full BotFather message (e.g. "Done! Congratulations... token is 123:ABC") */
function extractBotToken(raw: string): string {
  const trimmed = raw.trim();
  // Already looks like a pure token
  if (/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(trimmed)) return trimmed;
  // BotFather EN / AR variants + any standalone token in the paste
  const m =
    trimmed.match(
      /(?:token is|Use this token to access the HTTP API:|API Token:|Your bot token is|التوكن هو|رمز البوت|التوكن)\s*[:：]?\s*([\d]{6,12}:[A-Za-z0-9_-]{30,})/i
    ) ||
    trimmed.match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/);
  return m ? m[1] : trimmed;
}

// AdSlot is a Server Component (reads cookies via next/headers) — a
// Client Component like this one can't import it directly, only receive
// it already-rendered as a prop from the Server Component that renders
// this one (src/app/bots/page.tsx).
export default function BotsDeployForm({ isOwner, adSlot }: { isOwner: boolean; adSlot: React.ReactNode }) {
  const [token, setToken] = useState("");
  const [template, setTemplate] = useState("AD_BOT");
  const [ownerId, setOwnerId] = useState("");
  const [activationCode, setActivationCode] = useState("");
  const [password, setPassword] = useState("");
  const [ref, setRef] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get("ref");
    if (r) setRef(r.replace(/\D/g, ""));
    // Auto-fill paid activation / order code from common query keys (one-order-one-bot flow)
    const code = params.get("code") || params.get("order") || params.get("activation") || params.get("activationCode");
    if (code) setActivationCode(code.trim().toUpperCase());
    const oid = params.get("ownerId") || params.get("owner");
    if (oid) setOwnerId(oid.replace(/\D/g, ""));
  }, []);

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    setBotUsername(null);
    setCopied(false);

    // Client-side guards — avoid round-trip for obvious bad input
    // Re-run extract in case state lagged behind a long paste
    const trimmedToken = extractBotToken(token);
    if (trimmedToken !== token.trim()) setToken(trimmedToken);
    if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(trimmedToken)) {
      setStatus("❌ صيغة التوكن غير صحيحة. الصق التوكن فقط أو رسالة BotFather كاملة (Done! … token is …).");
      return;
    }
    if (!ownerId || ownerId.length < 5 || ownerId.length > 15) {
      setStatus("❌ معرّف المالك (Telegram User ID) غير صالح.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/bots/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: trimmedToken,
          template,
          ownerId,
          ref: ref || undefined,
          activationCode: activationCode || undefined,
          password: password || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setStatus(`✅ ${data.message}`);
        // Extract @username from message like "Bot @MyBot activated successfully!"
        const match = String(data.message || "").match(/@([A-Za-z0-9_]+)/);
        if (match) setBotUsername(match[1]);
      } else {
        setStatus(`❌ خطأ: ${data.error}`);
      }
    } catch (err: any) {
      setStatus(`❌ فشل الاتصال بالخادم: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!botUsername) return;
    const url = `https://t.me/${botUsername}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <main className="relative mx-auto max-w-lg px-4 py-10">
      <SectionBackdrop tone="bots" />
      <h1 className="mb-2 text-2xl font-bold">تفعيل بوت تليجرام</h1>
      <p className="mb-6 text-sm text-gray-600">
        الصق توكن البوت من @BotFather (أو الرسالة كاملة)، أدخل آيدي تيليجرامك، واختر القالب. البوت يُفعَّل فوراً على توكنك.
      </p>

      <form onSubmit={handleDeploy} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Bot Token من BotFather</label>
          <input
            type="text"
            required
            value={token}
            onChange={(e) => setToken(extractBotToken(e.target.value))}
            placeholder="الصق التوكن أو رسالة BotFather كاملة"
            className="w-full rounded border p-2 font-mono text-sm text-black"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">معرّف المالك (Telegram User ID)</label>
          <input
            type="text"
            required
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value.replace(/\D/g, ""))}
            placeholder="مثال: 987654321"
            className="w-full rounded border p-2 font-mono text-sm text-black"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">اختر قالب البوت</label>
          <select value={template} onChange={(e) => setTemplate(e.target.value)} className="w-full rounded border bg-white p-2 text-black">
            <option value="AD_BOT">بوت الإعلانات والمهام</option>
            {/* بوت التعارف والزواج الشرعي، بوت فرص العمل/المتجر، والبوت
                الطبي مخفية عن أي زائر عادي عمداً — كلها خاصة بمالك المنصة
                فقط وليست متاحة للتفعيل أو البيع لأي طرف آخر إطلاقاً (راجع
                docs/AGENT_BUS.md، توضيح المالك 2026-09-03 و2026-09-05
                و2026-09-04)؛ الخيارات تظهر فقط لك أنت (isOwner). STORE و
                HOSPITAL أُخفيا أيضاً — القالبان لا يزالان قيد الإعداد فعلياً
                (راجع docs/claude-feature-backlog.md). NOVA_BOT (2026-09-05)
                نفس القيد على التفعيل (نشر المالك فقط)، لكن البوت بعد نشره
                منتج عام لمستخدمين خارجيين حقيقيين — راجع novaBotLogic.ts. */}
            {isOwner && <option value="MARRIAGE_BOT">بوت التعارف والزواج الشرعي</option>}
            {isOwner && <option value="JOBS_BOT">بوت فرص العمل والمتجر</option>}
            {isOwner && <option value="MEDICAL_BOT">البوت الطبي (عيادات ومشافي وصيدليات)</option>}
            {isOwner && <option value="NOVA_BOT">Nova AI (مساعد ذكاء اصطناعي مجاني)</option>}
          </select>
        </div>
        {template === "MARRIAGE_BOT" || template === "JOBS_BOT" || template === "MEDICAL_BOT" || template === "NOVA_BOT" ? (
          <div>
            <label className="mb-1 block text-sm font-medium">كلمة السر</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border p-2 font-mono text-sm text-black"
            />
          </div>
        ) : (
          <div>
            <label className="mb-1 block text-sm font-medium">كود التفعيل</label>
            <input
              type="text"
              required
              value={activationCode}
              onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
              placeholder="احصل عليه من داخل أي بوت على المنصة عبر زر «أريد بوتاً مماثلاً»"
              className="w-full rounded border p-2 font-mono text-sm text-black"
            />
            <p className="mt-1 text-xs text-gray-500">مرتبط بآيدي المالك الذي أدخلته أعلاه تحديداً — لا يعمل مع آيدي آخر.</p>
          </div>
        )}
        <button type="submit" disabled={loading} className={`w-full rounded py-2 font-bold text-white disabled:opacity-50 ${theme.button}`}>
          {loading ? "جاري ربط وتفعيل البوت..." : "تفعيل البوت على تلجرام فوراً"}
        </button>
      </form>
      {status && (
        <div className="mt-4 space-y-3">
          <div className="whitespace-pre-wrap rounded bg-gray-100 p-3 text-sm">{status}</div>
          {botUsername && (
            <div className="flex flex-col gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
              >
                افتح @{botUsername} على تليجرام
              </a>
              <button
                type="button"
                onClick={copyLink}
                className="rounded border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100"
              >
                {copied ? "تم النسخ ✓" : "نسخ الرابط"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-8">{adSlot}</div>
    </main>
  );
}
