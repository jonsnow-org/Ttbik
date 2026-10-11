"use client";

import { useState } from "react";

export default function EmbedCode({ slug, title, height, origin }: { slug: string; title: string; height: number; origin: string }) {
  const [copied, setCopied] = useState(false);
  const code =
    `<iframe src="${origin}/embed/tools/${slug}" title="${title}" width="100%" height="${height}" style="border:0;max-width:640px" loading="lazy"></iframe>\n` +
    `<p style="font-size:12px">تم التطوير بواسطة <a href="${origin}/free-tools/${slug}" target="_blank" rel="noopener">شام AI</a></p>`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-extrabold text-slate-900">🧩 ضمّن هذه الأداة في موقعك مجانًا</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">
        انسخ الكود التالي والصقه في صفحتك أو مدونتك. الشرط الوحيد إبقاء عبارة «تم التطوير بواسطة شام AI» مع رابطها.
      </p>
      <textarea readOnly dir="ltr" value={code} rows={4} className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-2 font-mono text-[11px]" onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={copy} className="mt-2 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-bold text-white">
        {copied ? "✅ نُسخ" : "نسخ الكود"}
      </button>
    </div>
  );
}
