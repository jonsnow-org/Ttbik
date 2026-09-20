"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STORAGE_PREFIX = "sham_studio_free_uses:";

function readUsedCount(tool: string): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(STORAGE_PREFIX + tool) || "0") || 0;
  } catch {
    // Private browsing / blocked storage -- fail open to "0 used" so the
    // tool still works; it just won't remember across reloads for this
    // visitor, which is a fine, harmless degradation for a soft limit.
    return 0;
  }
}

export type StudioToolProps = {
  /** false once this visitor has used up their free tries and hasn't unlocked yet. */
  canGenerate: boolean;
  /** Call this exactly once, only after a generation actually succeeds. */
  onGenerated: () => void;
};

export default function StudioGate({
  tool,
  serviceHref,
  freeUses,
  initialOrderCode,
  isOwner,
  children,
}: {
  tool: string;
  /** Link to this tool's catalog/purchase page, e.g. /service/audio-visualizer. */
  serviceHref: string;
  freeUses: number;
  initialOrderCode: string;
  isOwner: boolean;
  children: (props: StudioToolProps) => React.ReactNode;
}) {
  const [orderCode, setOrderCode] = useState(initialOrderCode);
  const [unlocked, setUnlocked] = useState(isOwner);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [usedCount, setUsedCount] = useState(0);

  useEffect(() => {
    setUsedCount(readUsedCount(tool));
  }, [tool]);

  async function verify() {
    if (!orderCode.trim() || checking) return;
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/tools/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderCode: orderCode.trim().toUpperCase(), tool }),
      });
      const data = await res.json();
      if (!res.ok || !data.unlocked) throw new Error(data?.error || "رمز الطلب غير صالح");
      setUnlocked(true);
    } catch (e: any) {
      setError(e.message || "حدث خطأ غير متوقع");
    } finally {
      setChecking(false);
    }
  }

  function consumeFreeUse() {
    const next = readUsedCount(tool) + 1;
    setUsedCount(next);
    try {
      window.localStorage.setItem(STORAGE_PREFIX + tool, String(next));
    } catch {
      // Best-effort only -- see readUsedCount's fallback above.
    }
  }

  const remaining = Math.max(0, freeUses - usedCount);
  const canGenerate = unlocked || remaining > 0;

  return (
    <div>
      {!unlocked && (
        <p className="mb-4 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">
          {remaining > 0
            ? `🎁 جرّبها الآن مجاناً — لديك ${remaining} ${remaining === 1 ? "محاولة مجانية متبقية" : "محاولات مجانية متبقية"}`
            : "انتهت محاولاتك المجانية"}
        </p>
      )}

      {children({ canGenerate, onGenerated: unlocked ? () => {} : consumeFreeUse })}

      {!unlocked && remaining === 0 && (
        <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-6">
          <p className="mb-1 font-bold text-slate-900">أعجبتك النتيجة؟ افتح استخداماً غير محدود.</p>
          <p className="mb-4 text-sm text-slate-600">
            جرّبت الأداة {freeUses} {freeUses === 1 ? "مرة مجانية" : "مرات مجاناً"} بالفعل. اطلبها الآن للحصول على وصول
            دائم بلا حدود.
          </p>
          <Link
            href={serviceHref}
            className="mb-5 inline-block rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
          >
            اطلب الوصول الكامل ←
          </Link>

          <div className="border-t border-brand-200 pt-4">
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              طلبت الأداة سابقاً؟ أدخلي رمز طلبك هنا (مثال: ORD-A1B2C3D4)
            </label>
            <p className="mb-2 text-xs text-slate-400">
              يصلك هذا الرمز في صفحة تتبّع الطلب/على تيليجرام بعد موافقتنا على طلبك.
            </p>
            <input
              value={orderCode}
              onChange={(e) => setOrderCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && verify()}
              placeholder="ORD-XXXXXXXX"
              className="mb-3 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none"
            />
            <button
              onClick={verify}
              disabled={checking || !orderCode.trim()}
              className="rounded-xl bg-slate-800 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-900 disabled:opacity-50"
            >
              {checking ? "جارٍ التحقق..." : "فتح الوصول الكامل"}
            </button>
            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
