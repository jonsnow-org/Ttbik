"use client";

import { useState } from "react";
import type { StoreProduct } from "@/types";
import { getCategoryTheme } from "@/lib/categoryTheme";

const CATEGORY_FALLBACK: Record<string, { emoji: string; gradient: string }> = {
  "أجهزة": { emoji: "💻", gradient: "from-sky-100 to-indigo-100" },
  "اشتراكات": { emoji: "🔑", gradient: "from-amber-100 to-orange-100" },
  "مكتبية": { emoji: "🗂️", gradient: "from-emerald-100 to-teal-100" },
  "كتب": { emoji: "📚", gradient: "from-violet-100 to-fuchsia-100" },
};

function categoryFallback(category: string) {
  return CATEGORY_FALLBACK[category] || { emoji: "🛝", gradient: "from-slate-100 to-slate-200" };
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

export default function StoreProductCard({ p }: { p: StoreProduct }) {
  const theme = getCategoryTheme(p.category);
  const fallback = categoryFallback(p.category);
  const linkOk = isHttpUrl(p.affiliate_url);
  const [imgFailed, setImgFailed] = useState(false);
  const imageOk = isHttpUrl(p.image_url) && !imgFailed;

  const inner = (
    <>
      <div className={`aspect-square w-full overflow-hidden bg-gradient-to-br ${fallback.gradient}`}>
        {imageOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.image_url!}
            alt={p.title_ar}
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <span className="text-5xl" aria-hidden>
              {fallback.emoji}
            </span>
            <span className="text-xs font-bold text-slate-500">{p.category}</span>
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="font-bold text-slate-900">{p.title_ar}</h3>
        {p.description_ar && <p className="line-clamp-2 text-xs text-slate-500">{p.description_ar}</p>}
        <div className="mt-auto flex items-center justify-between pt-2">
          {p.price_display && <span className="font-extrabold text-slate-900">{p.price_display}</span>}
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${theme.badgeBg} ${theme.badgeText}`}>
            {linkOk ? "عرض المنتج ←" : "قريباً"}
          </span>
        </div>
      </div>
    </>
  );

  const className = `group flex flex-col overflow-hidden rounded-2xl border ${theme.border} bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg`;

  if (!linkOk) {
    return <div className={className}>{inner}</div>;
  }

  return (
    <a
      href={p.affiliate_url}
      target="_blank"
      rel="sponsored nofollow noopener"
      className={className}
    >
      {inner}
    </a>
  );
}
