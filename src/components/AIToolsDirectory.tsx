"use client";

import { useMemo, useState } from "react";
import {
  AI_TOOL_CATEGORIES,
  AI_TOOLS,
  type AiToolCategoryId,
} from "@/lib/aiToolsDirectory";

type Props = {
  lang: "ar" | "en";
};

export default function AIToolsDirectory({ lang }: Props) {
  const isArabic = lang === "ar";
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<AiToolCategoryId | "all">("all");

  const copy = isArabic
    ? {
        search: "ابحث باسم الأداة أو وظيفتها…",
        all: "كل الفئات",
        results: "أداة",
        resultsPlural: "أدوات",
        visit: "زيارة الموقع الرسمي",
        noResults: "لم نعثر على أدوات تطابق بحثك.",
        reset: "مسح البحث",
        curated: "اختيارات منتقاة",
        thirdParty: "خدمات مستقلة",
      }
    : {
        search: "Search by tool name or purpose…",
        all: "All categories",
        results: "tool",
        resultsPlural: "tools",
        visit: "Visit official website",
        noResults: "No tools matched your search.",
        reset: "Clear search",
        curated: "Curated selection",
        thirdParty: "Independent services",
      };

  const visibleTools = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(isArabic ? "ar" : "en");
    return AI_TOOLS.filter((tool) => {
      const matchesCategory = activeCategory === "all" || tool.category === activeCategory;
      if (!matchesCategory) return false;
      if (!normalizedQuery) return true;

      const category = AI_TOOL_CATEGORIES.find((item) => item.id === tool.category);
      const searchText = [
        tool.name,
        tool.ar,
        tool.en,
        category?.ar ?? "",
        category?.en ?? "",
      ].join(" ").toLocaleLowerCase(isArabic ? "ar" : "en");
      return searchText.includes(normalizedQuery);
    });
  }, [activeCategory, isArabic, query]);

  return (
    <section dir={isArabic ? "rtl" : "ltr"} aria-label={isArabic ? "دليل أدوات الذكاء الاصطناعي" : "AI tools directory"}>
      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <label htmlFor="ai-tools-search" className="mb-2 block text-sm font-bold text-slate-800">
          {isArabic ? "ابحث في الدليل" : "Search the directory"}
        </label>
        <input
          id="ai-tools-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={copy.search}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
        />
        <div className="mt-3 flex flex-wrap gap-2" aria-label={isArabic ? "تصفية حسب الفئة" : "Filter by category"}>
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            aria-pressed={activeCategory === "all"}
            className={
              activeCategory === "all"
                ? "rounded-full bg-slate-900 px-3 py-2 text-xs font-bold text-white"
                : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-slate-400"
            }
          >
            {copy.all}
          </button>
          {AI_TOOL_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setActiveCategory(category.id)}
              aria-pressed={activeCategory === category.id}
              className={
                activeCategory === category.id
                  ? "rounded-full bg-indigo-600 px-3 py-2 text-xs font-bold text-white"
                  : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
              }
            >
              <span aria-hidden="true">{category.icon} </span>
              {category[lang]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500" aria-live="polite">
        <span>
          {visibleTools.length} {visibleTools.length === 1 ? copy.results : copy.resultsPlural}
        </span>
        <span>{copy.curated} · {copy.thirdParty}</span>
      </div>

      {visibleTools.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTools.map((tool) => {
            const category = AI_TOOL_CATEGORIES.find((item) => item.id === tool.category);
            return (
              <article
                key={tool.id}
                className="group flex min-h-44 flex-col rounded-2xl border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md sm:p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-extrabold leading-6 text-slate-950">{tool.name}</h2>
                  <span className="shrink-0 rounded-lg bg-indigo-50 px-2 py-1 text-lg" aria-hidden="true">
                    {category?.icon ?? "✨"}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{tool[lang]}</p>
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <span className="text-[11px] font-semibold text-slate-500">{category?.[lang]}</span>
                  <a
                    href={tool.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
                  >
                    {copy.visit}
                    <span aria-hidden="true">↗</span>
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
          <p className="font-bold text-slate-800">{copy.noResults}</p>
          <button
            type="button"
            className="mt-3 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setQuery("");
              setActiveCategory("all");
            }}
          >
            {copy.reset}
          </button>
        </div>
      )}
    </section>
  );
}
