"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FREE_TOOLS } from "@/lib/freeTools";

export default function RelatedTools() {
  const path = usePathname() || "";
  const current = FREE_TOOLS.find((tool) => path === tool.href || path.startsWith(`${tool.href}/`));
  if (!current) return null;
  const related = FREE_TOOLS.filter((tool) => tool.cat === current.cat && tool.href !== current.href).slice(0, 3);
  if (!related.length) return null;
  return (
    <section className="mx-auto max-w-4xl px-4 pt-6" aria-label="أدوات قريبة">
      <h2 className="text-sm font-extrabold text-slate-800">أدوات من تصنيف {current.cat}</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {related.map((tool) => (
          <Link key={tool.href} href={tool.href} className="rounded-xl bg-white p-3 text-sm font-bold leading-6 text-slate-900 ring-1 ring-slate-200">
            {tool.title}
          </Link>
        ))}
      </div>
    </section>
  );
}
