"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FREE_TOOLS, TOOL_CATS, type ToolCat } from "@/lib/freeTools";

const KEY = "sham_recent_tools";

function remember(href: string) {
  try {
    const prev = JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
    const next = [href, ...prev.filter((item) => item !== href)].slice(0, 4);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export default function ToolsStudio() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ToolCat | "الكل">("الكل");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "[]") as string[];
      setRecent(saved.filter((href) => FREE_TOOLS.some((tool) => tool.href === href)).slice(0, 4));
    } catch {
      setRecent([]);
    }
  }, []);

  const list = useMemo(() => {
    const query = q.trim();
    return FREE_TOOLS.filter((tool) => {
      if (cat !== "الكل" && tool.cat !== cat) return false;
      if (!query) return true;
      return `${tool.title} ${tool.desc} ${tool.cat}`.includes(query);
    });
  }, [q, cat]);

  const recentTools = recent
    .map((href) => FREE_TOOLS.find((tool) => tool.href === href))
    .filter((tool): tool is (typeof FREE_TOOLS)[number] => Boolean(tool));

  return (
    <div>
      <label className="block text-sm font-bold text-slate-800" htmlFor="tool-search">
        ابحث عن أداة
        <input
          id="tool-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="زكاة، تاريخ، صورة..."
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600"
        />
      </label>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="تصنيف الأدوات">
        {(["الكل", ...TOOL_CATS] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCat(item)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-bold ${cat === item ? "bg-[#12110e] text-[#f4efe6]" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
          >
            {item}
          </button>
        ))}
      </div>
      {recentTools.length > 0 && !q && cat === "الكل" && (
        <div className="mt-4">
          <p className="text-xs font-bold text-slate-500">آخر ما استخدمته</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {recentTools.map((tool) => (
              <Link key={tool.href} href={tool.href} onClick={() => remember(tool.href)} className="rounded-xl bg-white p-3 text-sm font-bold text-slate-900 ring-1 ring-slate-200">
                {tool.title}
              </Link>
            ))}
          </div>
        </div>
      )}
      {list.length === 0 ? (
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">لا توجد أداة بهذا الاسم. جرّب كلمة أقصر أو تصنيف «الكل».</p>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {list.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              onClick={() => remember(tool.href)}
              className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-emerald-600"
            >
              <p className="text-[11px] font-bold text-emerald-700">{tool.cat}</p>
              <h2 className="mt-1 text-base font-extrabold text-slate-900">{tool.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">{tool.desc}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
