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

const CATEGORY_VISUALS: Record<
  AiToolCategoryId,
  { cover: string; cardTint: string; coverGradient: string; iconTint: string }
> = {
  writing: {
    cover: "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-violet-50",
    coverGradient: "from-violet-950 via-purple-900 to-indigo-900",
    iconTint: "bg-violet-100 text-violet-950",
  },
  images: {
    cover: "https://images.unsplash.com/photo-1541961017774-22349e4a1262?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-fuchsia-50",
    coverGradient: "from-fuchsia-950 via-pink-900 to-rose-900",
    iconTint: "bg-fuchsia-100 text-fuchsia-950",
  },
  video: {
    cover: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-rose-50",
    coverGradient: "from-rose-950 via-red-900 to-orange-900",
    iconTint: "bg-rose-100 text-rose-950",
  },
  coding: {
    cover: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-sky-50",
    coverGradient: "from-sky-950 via-blue-900 to-cyan-900",
    iconTint: "bg-sky-100 text-sky-950",
  },
  research: {
    cover: "https://images.unsplash.com/photo-1456324504439-367cee3b3c32?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-emerald-50",
    coverGradient: "from-emerald-950 via-teal-900 to-cyan-900",
    iconTint: "bg-emerald-100 text-emerald-950",
  },
  productivity: {
    cover: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-amber-50",
    coverGradient: "from-amber-950 via-orange-900 to-yellow-900",
    iconTint: "bg-amber-100 text-amber-950",
  },
  design: {
    cover: "https://images.unsplash.com/photo-1558655146-d09347e92766?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-indigo-50",
    coverGradient: "from-indigo-950 via-violet-900 to-purple-900",
    iconTint: "bg-indigo-100 text-indigo-950",
  },
  marketing: {
    cover: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=900&q=78",
    cardTint: "bg-teal-50",
    coverGradient: "from-teal-950 via-cyan-900 to-sky-900",
    iconTint: "bg-teal-100 text-teal-950",
  },
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
        visit: "الموقع الرسمي",
        noResults: "لم نعثر على أدوات تطابق بحثك.",
        reset: "مسح البحث",
        curated: "أدوات منتقاة",
        thirdParty: "روابط رسمية",
        filter: "تصفية حسب الفئة",
      }
    : {
        search: "Search by tool name or purpose…",
        all: "All categories",
        results: "tool",
        resultsPlural: "tools",
        visit: "Official website",
        noResults: "No tools matched your search.",
        reset: "Clear search",
        curated: "Curated tools",
        thirdParty: "Official links",
        filter: "Filter by category",
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
        tool.id,
        tool.ar,
        tool.en,
        category?.ar ?? "",
        category?.en ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase(isArabic ? "ar" : "en");
      return searchText.includes(normalizedQuery);
    });
  }, [activeCategory, isArabic, query]);

  return (
    <section
      dir={isArabic ? "rtl" : "ltr"}
      aria-label={isArabic ? "دليل أدوات الذكاء الاصطناعي" : "AI tools directory"}
    >
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
        <div className="mt-3 flex flex-wrap gap-2" aria-label={copy.filter}>
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            aria-pressed={activeCategory === "all"}
            className={
              activeCategory === "all"
                ? "rounded-full bg-slate-900 px-3 py-2 text-xs font-bold text-white shadow-sm"
                : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-slate-400"
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
                  ? "rounded-full bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm"
                  : "rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
              }
            >
              <span aria-hidden="true">{category.icon} </span>
              {category[lang]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-500" aria-live="polite">
        <span className="font-bold text-slate-700">
          {visibleTools.length} {visibleTools.length === 1 ? copy.results : copy.resultsPlural}
        </span>
        <span>{copy.curated} · {copy.thirdParty}</span>
      </div>

      {visibleTools.length > 0 ? (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTools.map((tool) => {
            const category = AI_TOOL_CATEGORIES.find((item) => item.id === tool.category);
            const visual = CATEGORY_VISUALS[tool.category];
            return (
              <article
                key={tool.id}
                className={[
                  "group flex min-h-64 flex-col overflow-hidden rounded-2xl border border-white/80 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl focus-within:ring-2 focus-within:ring-indigo-400",
                  visual.cardTint,
                ].join(" ")}
              >
                <div
                  className={[
                    "relative flex h-28 items-end justify-between overflow-hidden bg-gradient-to-br p-3",
                    visual.coverGradient,
                  ].join(" ")}
                  style={{
                    backgroundImage:
                      "linear-gradient(115deg, rgba(15,23,42,.18), rgba(15,23,42,.70)), url('" +
                      visual.cover +
                      "')",
                    backgroundPosition: "center",
                    backgroundSize: "cover",
                  }}
                  aria-hidden="true"
                >
                  <span className="rounded-full border border-white/30 bg-slate-950/35 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
                    {category?.[lang]}
                  </span>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/70 bg-white/90 text-2xl shadow-lg">
                    {category?.icon ?? "✨"}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-4 sm:p-5">
                  <h2 className="text-base font-extrabold leading-6 text-slate-950">{tool.name}</h2>
                  <p className="mt-2 flex-1 text-sm leading-6 text-slate-700">{tool[lang]}</p>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-900/10 pt-3">
                    <span className="text-[11px] font-semibold text-slate-600">{category?.[lang]}</span>
                    <a
                      href={tool.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={(isArabic ? "زيارة الموقع الرسمي لـ " : "Visit the official website for ") + tool.name}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2"
                    >
                      {copy.visit}
                      <span aria-hidden="true">↗</span>
                    </a>
                  </div>
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
