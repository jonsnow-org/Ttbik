"use client";

import { useState } from "react";
import { PRAYER_CITIES } from "@/lib/prayerCities";

export default function WidgetBuilder({ site }: { site: string }) {
  const [city, setCity] = useState("makkah");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [copied, setCopied] = useState(false);
  const src = `${site}/embed/prayer/${city}${theme === "dark" ? "?theme=dark" : ""}`;
  const code = `<iframe src="${src}" width="340" height="360" style="border:0;max-width:100%" loading="lazy" title="مواقيت الصلاة"></iframe>`;

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <div className="space-y-3">
        <label className="block text-sm font-bold text-slate-700">
          المدينة
          <select value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 text-sm">
            {PRAYER_CITIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nameAr} — {c.countryAr}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 text-sm">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`flex-1 rounded-xl border px-3 py-1.5 font-bold ${theme === t ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600"}`}
            >
              {t === "light" ? "فاتح" : "داكن"}
            </button>
          ))}
        </div>
        <textarea readOnly value={code} dir="ltr" rows={4} className="w-full rounded-xl border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] text-slate-700" />
        <button type="button" onClick={copy} className="w-full rounded-xl bg-indigo-700 py-2 text-sm font-bold text-white hover:bg-indigo-800">
          {copied ? "✅ نُسخ الكود" : "📋 انسخ الكود"}
        </button>
      </div>
      <div className={`flex justify-center rounded-xl p-2 ${theme === "dark" ? "bg-slate-800" : "bg-slate-50"}`}>
        <iframe key={src} src={src.replace(site, "")} width={340} height={360} style={{ border: 0, maxWidth: "100%" }} title="معاينة الودجت" />
      </div>
    </div>
  );
}
