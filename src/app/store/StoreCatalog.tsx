"use client";

import { useMemo, useState } from "react";
import type { StoreProduct } from "@/types";
import StoreProductCard from "./StoreProductCard";

function categoryAnchor(category: string) {
  return `cat-${encodeURIComponent(category).replace(/%/g, "")}`;
}

function priceNum(p: StoreProduct): number {
  const n = String(p.price_display || "").replace(/[^0-9.]/g, "");
  const v = parseFloat(n);
  return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

type SortKey = "default" | "price-asc" | "price-desc" | "title";

export default function StoreCatalog({ products }: { products: StoreProduct[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("default");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = products;
    if (needle) {
      list = products.filter((p) => {
        const hay = `${p.title_ar} ${p.description_ar || ""} ${p.category}`.toLowerCase();
        return hay.includes(needle);
      });
    }
    if (sort === "price-asc") list = [...list].sort((a, b) => priceNum(a) - priceNum(b));
    else if (sort === "price-desc") list = [...list].sort((a, b) => priceNum(b) - priceNum(a));
    else if (sort === "title") list = [...list].sort((a, b) => a.title_ar.localeCompare(b.title_ar, "ar"));
    return list;
  }, [products, q, sort]);

  const groups = useMemo(() => {
    const out: { category: string; items: StoreProduct[] }[] = [];
    for (const p of filtered) {
      const g = out.find((x) => x.category === p.category);
      if (g) g.items.push(p);
      else out.push({ category: p.category, items: [p] });
    }
    return out;
  }, [filtered]);

  return (
    <>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="block flex-1">
          <span className="sr-only">بحث في المتجر</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث باسم المنتج أو القسم…"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          ترتيب
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
          >
            <option value="default">الافتراضي</option>
            <option value="price-asc">السعر: الأقل</option>
            <option value="price-desc">السعر: الأعلى</option>
            <option value="title">الاسم</option>
          </select>
        </label>
      </div>

      {groups.length > 1 && !q.trim() && (
        <nav className="mt-4 flex flex-wrap justify-center gap-2" aria-label="أقسام المتجر">
          {groups.map((g) => (
            <a
              key={g.category}
              href={`#${categoryAnchor(g.category)}`}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:border-slate-400"
            >
              {g.category} ({g.items.length})
            </a>
          ))}
        </nav>
      )}

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">لا نتائج مطابقة لبحثك.</p>
      ) : (
        groups.map((group) => (
          <section key={group.category} id={categoryAnchor(group.category)} className="mt-10 scroll-mt-24">
            <h2 className="mb-4 text-xl font-bold text-slate-900">{group.category}</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((p) => (
                <StoreProductCard key={p.id} p={p} />
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
