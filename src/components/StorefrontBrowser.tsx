"use client";

import { useState } from "react";
import Link from "next/link";
import type { Category, Service } from "@/types";
import { formatUsd } from "@/lib/utils";
import { getDeliveryKind } from "@/lib/deliveryKind";
import CategoryBanner, { CategoryIcon } from "@/components/CategoryBanner";
import SectionBackdrop from "@/components/SectionBackdrop";
import { getCategoryTheme } from "@/lib/categoryTheme";

/**
 * Sidebar-driven category browser: only the selected category's services
 * render at a time. A real vertical list — persistent on desktop, a
 * slide-in drawer (opened via a ☰ button) on mobile — rather than a
 * horizontal pill row, which people don't read as "a sidebar".
 */
export default function StorefrontBrowser({
  categories,
  services,
}: {
  categories: Category[];
  services: Service[];
}) {
  const [activeId, setActiveId] = useState(categories[0]?.id);
  const active = categories.find((c) => c.id === activeId) ?? categories[0];

  if (!active) return null;

  // Flat grid, no subcategory headers -- grouping services into labeled
  // "sections" (e.g. "الإعلانات والتسويق" for a single ad-slot bot, "الرد
  // والدعم" for two small free bots) read as full categories to a visitor
  // even though each held only 1-2 items (owner feedback, 2026-09-20).
  // `subcategory` stays a real DB column (still usable for search/filtering
  // elsewhere) -- it's just not rendered as a visual section boundary here.
  // Order preserved from the query's own `sort_order`.
  const activeServices = services.filter((s) => s.category_id === active.id);
  const theme = getCategoryTheme(active.slug);

  function selectCategory(id: string) {
    setActiveId(id);
  }

  return (
    <section id="categories" className="relative mx-auto max-w-6xl px-4 pb-20">
      <SectionBackdrop tone={active.slug} />

      {/* One category switcher, not two: a horizontal pill row on mobile
          (always visible, no second hamburger/drawer competing with the
          site's own main ☰ menu) and a persistent sidebar on desktop. */}
      <nav className="mb-6 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
        {categories.map((cat) => {
          const catTheme = getCategoryTheme(cat.slug);
          return (
            <button
              key={cat.id}
              onClick={() => selectCategory(cat.id)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
                cat.id === active.id
                  ? `${catTheme.activeTab} border-transparent`
                  : "border-slate-200 bg-white text-slate-600"
              }`}
            >
              <CategoryIcon slug={cat.slug} className="h-4 w-4 shrink-0" />
              {cat.name_ar}
            </button>
          );
        })}
      </nav>

      <div className="lg:flex lg:items-start lg:gap-8">
        {/* Desktop: persistent sidebar */}
        <aside className="hidden shrink-0 lg:block lg:w-60">
          <nav className="sticky top-24 space-y-1">
            {categories.map((cat) => {
              const catTheme = getCategoryTheme(cat.slug);
              return (
                <button
                  key={cat.id}
                  onClick={() => selectCategory(cat.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                    cat.id === active.id ? catTheme.activeTab : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <CategoryIcon slug={cat.slug} className="h-5 w-5 shrink-0" />
                  <span className="flex-1 text-right">{cat.name_ar}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Active category content */}
        <div className="min-w-0 flex-1">
          <CategoryBanner slug={active.slug} />
          <div className="mb-6 mt-4">
            <h2 className="text-xl font-bold text-slate-900">{active.name_ar}</h2>
            {active.description_ar && <p className="mt-1 text-sm text-slate-500">{active.description_ar}</p>}
          </div>

          {activeServices.length === 0 && (
            <p className="text-sm text-slate-400">لا توجد خدمات في هذا القسم حالياً.</p>
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {activeServices.map((s) => (
              <Link
                key={s.id}
                href={`/service/${s.slug}`}
                className={`group relative flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br ${theme.gradient} p-5 text-white shadow-md transition hover:-translate-y-1 hover:shadow-xl`}
              >
                <div className="pointer-events-none absolute -left-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
                <div>
                  <div className="flex items-center justify-between">
                    <CategoryIcon slug={active.slug} className="h-7 w-7 text-white/90" />
                    <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-white backdrop-blur">
                      {getDeliveryKind(s).label}
                    </span>
                  </div>
                  <h3 className="mt-3 font-extrabold text-white">{s.name_ar}</h3>
                  <p className="mt-2 text-sm text-white/80">{s.short_desc_ar}</p>
                </div>
                <div className="relative mt-4 flex items-center justify-between">
                  <span className="text-lg font-extrabold text-white">{formatUsd(s.price_usd)}</span>
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white backdrop-blur transition group-hover:bg-white group-hover:text-slate-900">
                    {s.price_usd === 0 ? "احصل عليه الآن" : "جرّب النسخة المحدودة"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
