"use client";

import { useEffect, useState } from "react";
import { getCategoryTheme } from "@/lib/categoryTheme";
import SectionBackdrop from "@/components/SectionBackdrop";
import { LIVE_BOTS } from "@/lib/liveBots";

const theme = getCategoryTheme("bots");

/** Extract bot token if user pastes full BotFather message (e.g. "Done! Congratulations... token is 123:ABC") */
function extractBotToken(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(trimmed)) return trimmed;
  const m =
    trimmed.match(
      /(?:token is|Use this token to access the HTTP API:|API Token:|Your bot token is|التوكن هو|رمز البوت|التوكن)\s*[:：]?\s*([\d]{6,12}:[A-Za-z0-9_-]{30,})/i
    ) ||
    trimmed.match(/\b(\d{6,12}:[A-Za-z0-9_-]{30,})\b/);
  return m ? m[1] : trimmed;
}

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
      <span className="mx-auto mb-3 block w-fit rounded-full bg-indigo-50 px-4 py-1.5 text-xs font-bold text-indigo-700">
        🤖 منشئ بوتات كلود
      </span>
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">تفعيل بوت تليجرام</h1>
      <p className="mb-6 text-sm text-slate-600">
        هذا منشئ قوالب كلود (إعلانات، زواج، وظائف...). منشئ بوت الوسائط الخاص بجروك موجود في أدوات الأدمن.
      </p>

      {LIVE_BOTS[0] && (
        <a
          href={LIVE_BOTS[0].href}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-6 flex items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-sky-600 to-indigo-700 p-4 text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <span className="text-sm font-bold">🤖 تريد تجربة بوت حقيقي فوراً بدل تفعيل واحد بنفسك؟</span>
          <span className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold backdrop-blur">
            جرّب البوت ←
          </span>
        </a>
      )}

      <form onSubmit={handleDeploy} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium">Bot Token من BotFather</label>
          <input
            type="text"
            required
            value={token}
            onChange={(e) => setToken(extractBotToken(e.target.value))}
            placeholder="الصق التوكن أو رسالة BotFather كاملة"
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            احصل عليه مجاناً من{" "}
            <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              @userinfobot
            </a>{" "}
            أو{" "}
            <a href="https://t.me/getidsbot" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              @getidsbot
            </a>
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">اختر قالب البوت</label>
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="AD_BOT">بوت الإعلانات والمهام</option>
            {isOwner && <option value="MARRIAGE_BOT">بوت التعارف والزواج الشرعي</option>}
            {isOwner && <option value="JOBS_BOT">بوت فرص العمل والمتجر</option>}
            {isOwner && <option value="MEDICAL_BOT">البوت الطبي (عيادات ومشافي وصيدليات)</option>}
            {isOwner && <option value="NOVA_BOT">Nova AI (مساعد ذكاء اصطناعي مجاني)</option>}
          </select>
          {!isOwner && (
            <p className="mt-2 text-xs text-slate-500">
              🔒 هذا هو القالب العام الوحيد المتاح للجميع. القوالب الخاصة تظهر بعد تسجيل الدخول من{" "}
              <a href="/admin" className="font-bold text-indigo-700 underline">
                لوحة التحكم /admin
              </a>
              .
            </p>
          )}
        </div>
        {template === "MARRIAGE_BOT" || template === "JOBS_BOT" || template === "MEDICAL_BOT" || template === "NOVA_BOT" ? (
          <div>
            <label className="mb-1 block text-sm font-medium">كلمة السر</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
              className="w-full rounded-xl border border-slate-300 bg-white p-2.5 font-mono text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}
        <button type="submit" disabled={loading} className={`w-full rounded-xl py-2.5 font-bold text-white shadow-sm transition disabled:opacity-50 ${theme.button}`}>
          {loading ? "جاري ربط وتفعيل البوت..." : "تفعيل البوت على تلجرام فوراً"}
        </button>
      </form>
      {status && (
        <div className="mt-4 space-y-3">
          <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{status}</div>
          {botUsername && (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <a
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700"
              >
                افتح @{botUsername} على تليجرام
              </a>
              <button
                type="button"
                onClick={copyLink}
                className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-800 transition hover:bg-emerald-100"
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
