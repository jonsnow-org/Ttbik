"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

const MODE_LABELS: Record<string, string> = {
  caption: "منشورات السوشيال ميديا",
  blog: "مسودة المقالة",
  "product-desc": "وصف المنتج",
  translate: "الترجمة",
};

export default function ResultView() {
  const params = useSearchParams();
  const output = params.get("output") || "";
  const mode = params.get("mode") || "";
  const [copied, setCopied] = useState(false);

  if (!output) {
    return <p className="text-slate-500">لا توجد نتيجة — عد للأداة وجرّب مجدداً.</p>;
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      {MODE_LABELS[mode] && <p className="mb-2 text-xs font-bold text-rose-700">{MODE_LABELS[mode]}</p>}
      <div className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700">{output}</div>
      <button
        type="button"
        onClick={copyResult}
        className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
      >
        {copied ? "تم النسخ ✓" : "نسخ النتيجة"}
      </button>
    </div>
  );
}
