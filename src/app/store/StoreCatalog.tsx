"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function hasListedPrice(p: StoreProduct): boolean {
  return Number.isFinite(priceNum(p)) && priceNum(p) !== Number.POSITIVE_INFINITY;
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (/[<>\s]/.test(trimmed)) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function merchantHost(url: string | null | undefined): string | null {
  if (!isHttpUrl(url)) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    if (!host || host.length > 48) return null;
    return host;
  } catch {
    return null;
  }
}

type SortKey = "default" | "price-asc" | "price-desc" | "title";
type PriceFilter = "all" | "priced";

const SORTS: SortKey[] = ["default", "price-asc", "price-desc", "title"];

function readQuery(): { q: string; sort: SortKey; cat: string; shop: string; priced: PriceFilter } {
  if (typeof window === "undefined") return { q: "", sort: "default", cat: "all", shop: "all", priced: "all" };
  const sp = new URLSearchParams(window.location.search);
  const sortRaw = sp.get("sort") || "default";
  const sort = (SORTS as string[]).includes(sortRaw) ? (sortRaw as SortKey) : "default";
  const pricedRaw = sp.get("price") || "all";
  const priced: PriceFilter = pricedRaw === "priced" ? "priced" : "all";
  return {
    q: (sp.get("q") || "").slice(0, 80),
    sort,
    cat: (sp.get("cat") || "all").slice(0, 60),
    shop: (sp.get("shop") || "all").slice(0, 60),
    priced,
  };
}

function writeQuery(q: string, sort: SortKey, cat: string, shop: string, priced: PriceFilter) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (q.trim()) url.searchParams.set("q", q.trim());
  else url.searchParams.delete("q");
  if (sort !== "default") url.searchParams.set("sort", sort);
  else url.searchParams.delete("sort");
  if (cat !== "all") url.searchParams.set("cat", cat);
  else url.searchParams.delete("cat");
  if (shop !== "all") url.searchParams.set("shop", shop);
  else url.searchParams.delete("shop");
  if (priced === "priced") url.searchParams.set("price", "priced");
  else url.searchParams.delete("price");
  const next = url.pathname + (url.search || "") + url.hash;
  const curr = window.location.pathname + window.location.search + window.location.hash;
  if (next !== curr) window.history.replaceState(null, "", next);
}

export default function StoreCatalog({ products }: { products: StoreProduct[] }) {
  const initial = readQuery();
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<SortKey>(initial.sort);
  const [cat, setCat] = useState<string>(initial.cat);
  const [shop, setShop] = useState<string>(initial.shop);
  const [priced, setPriced] = useState<PriceFilter>(initial.priced);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  function applyQuery(next: ReturnType<typeof readQuery>) {
    setQ(next.q);
    setSort(next.sort);
    setCat(next.cat);
    setShop(next.shop);
    setPriced(next.priced);
  }

  useEffect(() => {
    applyQuery(readQuery());
    setReady(true);
    setCanNativeShare(typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    function onPop() {
      applyQuery(readQuery());
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeQuery(q, sort, cat, shop, priced);
  }, [q, sort, cat, shop, priced, ready]);

  useEffect(() => {
    if (!ready || cat === "all") return;
    const el = document.getElementById(categoryAnchor(cat));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [cat, ready]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        if (typing && searchRef.current && document.activeElement === searchRef.current && q.trim()) {
          setQ("");
          return;
        }
        if (!typing) {
          setQ("");
          setCat("all");
          setShop("all");
          setSort("default");
          setPriced("all");
          setCopied(false);
          setShared(false);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q]);

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const p of products) {
      if (!seen.includes(p.category)) seen.push(p.category);
    }
    return seen;
  }, [products]);

  const shops = useMemo(() => {
    const seen: string[] = [];
    for (const p of products) {
      const host = merchantHost(p.affiliate_url);
      if (host && !seen.includes(host)) seen.push(host);
    }
    return seen.sort((a, b) => a.localeCompare(b));
  }, [products]);

  const pricedCount = useMemo(() => products.filter(hasListedPrice).length, [products]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = products;
    if (cat !== "all") list = list.filter((p) => p.category === cat);
    if (shop !== "all") list = list.filter((p) => merchantHost(p.affiliate_url) === shop);
    if (priced === "priced") list = list.filter(hasListedPrice);
    if (needle) {
      list = list.filter((p) => {
        const host = merchantHost(p.affiliate_url) || "";
        const hay = `${p.title_ar} ${p.description_ar || ""} ${p.category} ${host}`.toLowerCase();
        return hay.includes(needle);
      });
    }
    if (sort === "price-asc") list = [...list].sort((a, b) => priceNum(a) - priceNum(b));
    else if (sort === "price-desc") list = [...list].sort((a, b) => priceNum(b) - priceNum(a));
    else if (sort === "title") list = [...list].sort((a, b) => a.title_ar.localeCompare(b.title_ar, "ar"));
    return list;
  }, [products, q, sort, cat, shop, priced]);

  const groups = useMemo(() => {
    const out: { category: string; items: StoreProduct[] }[] = [];
    for (const p of filtered) {
      const g = out.find((x) => x.category === p.category);
      if (g) g.items.push(p);
      else out.push({ category: p.category, items: [p] });
    }
    return out;
  }, [filtered]);

  const filtering = Boolean(q.trim()) || cat !== "all" || shop !== "all" || sort !== "default" || priced === "priced";

  function resetAll() {
    setQ("");
    setCat("all");
    setShop("all");
    setSort("default");
    setPriced("all");
    setCopied(false);
    setShared(false);
  }

  async function copyFilterLink() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  async function shareFilterLink() {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "متجر سوق تولز", url });
        setShared(true);
        window.setTimeout(() => setShared(false), 1800);
        return;
      }
      await copyFilterLink();
    } catch {
      /* user cancelled share sheet */
    }
  }

  return (
    <>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block flex-1">
          <span className="sr-only">بحث في المتجر</span>
          <input
            ref={searchRef}
            type="search"
            value={q}
            dir="rtl"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
            }}
            placeholder="ابحث باسم المنتج أو القسم أو المتجر المصدر…  ( / )"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400"
          />
          {q.trim() ? (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-0.5 text-xs font-bold text-slate-500 hover:text-slate-800"
              aria-label="مسح البحث"
            >
              مسح
            </button>
          ) : null}
        </label>
        <div className="flex items-center gap-2">
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
          <button
            type="button"
            onClick={copyFilterLink}
            aria-label="نسخ رابط التصفية الحالي"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-slate-400"
          >
            {copied ? "تم النسخ" : "نسخ الرابط"}
          </button>
          {canNativeShare ? (
            <button
              type="button"
              onClick={shareFilterLink}
              aria-label="مشاركة رابط التصفية الحالي"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-slate-400"
            >
              {shared ? "تمت المشاركة" : "مشاركة"}
            </button>
          ) : null}
        </div>
      </div>

      {categories.length > 1 && (
        <nav className="mt-4 flex flex-wrap justify-center gap-2" aria-label="تصفية أقسام المتجر">
          <button
            type="button"
            aria-pressed={cat === "all"}
            onClick={() => setCat("all")}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              cat === "all"
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            الكل ({products.length})
          </button>
          {categories.map((c) => {
            const count = products.filter((p) => p.category === c).length;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={cat === c}
                onClick={() => setCat(c)}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  cat === c
                    ? "border-slate-800 bg-slate-800 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                {c} ({count})
              </button>
            );
          })}
        </nav>
      )}

      {shops.length > 1 && (
        <nav className="mt-3 flex flex-wrap justify-center gap-2" aria-label="تصفية المتجر المصدر">
          <button
            type="button"
            aria-pressed={shop === "all"}
            onClick={() => setShop("all")}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              shop === "all"
                ? "border-emerald-800 bg-emerald-800 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            كل المتاجر ({shops.length})
          </button>
          {shops.map((h) => {
            const count = products.filter((p) => merchantHost(p.affiliate_url) === h).length;
            return (
              <button
                key={h}
                type="button"
                aria-pressed={shop === h}
                onClick={() => setShop(h)}
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  shop === h
                    ? "border-emerald-800 bg-emerald-800 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                {h} ({count})
              </button>
            );
          })}
        </nav>
      )}

      {pricedCount > 0 && pricedCount < products.length && (
        <nav className="mt-3 flex flex-wrap justify-center gap-2" aria-label="تصفية السعر المعروض">
          <button
            type="button"
            aria-pressed={priced === "all"}
            onClick={() => setPriced("all")}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              priced === "all"
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            كل الأسعار ({products.length})
          </button>
          <button
            type="button"
            aria-pressed={priced === "priced"}
            onClick={() => setPriced("priced")}
            className={`rounded-full border px-3 py-1 text-xs font-bold ${
              priced === "priced"
                ? "border-slate-800 bg-slate-800 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            بسعر معروض ({pricedCount})
          </button>
        </nav>
      )}

      {filtering && filtered.length > 0 && (
        <p className="mt-4 text-center text-xs font-semibold text-slate-500" aria-live="polite">
          {filtered.length} نتيجة
          {q.trim() ? ` لـ «${q.trim()}»` : ""}
          {cat !== "all" ? ` في «${cat}»` : ""}
          {shop !== "all" ? ` من ${shop}` : ""}
          {priced === "priced" ? " · بسعر معروض فقط" : ""}
          <button type="button" className="mr-2 font-bold text-slate-800 underline" onClick={resetAll}>
            إعادة الضبط
          </button>
          <span className="mr-2 text-slate-400">Esc يصفّر الكل · / للبحث</span>
        </p>
      )}

      {filtered.length === 0 ? (
        <p className="mt-8 text-center text-sm text-slate-500">
          لا نتائج مطابقة.
          <button type="button" className="mr-2 font-bold text-slate-800 underline" onClick={resetAll}>
            إعادة الضبط
          </button>
        </p>
      ) : sort !== "default" ? (
        <section className="mt-10" aria-label="نتائج مرتّبة بدون تجميع الأقسام">
          <h2 className="mb-4 text-xl font-bold text-slate-900">
            نتائج مرتّبة
            <span className="mr-2 text-sm font-semibold text-slate-500">
              {sort === "price-asc" ? "من الأقل سعراً" : sort === "price-desc" ? "من الأعلى سعراً" : "حسب الاسم"}
            </span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <StoreProductCard key={p.id} p={p} />
            ))}
          </div>
        </section>
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
