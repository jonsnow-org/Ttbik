"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export default function EnToolList({ tools }: { tools: { href: string; title: string; text: string }[] }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return tools;
    return tools.filter((tool) => `${tool.title} ${tool.text}`.toLowerCase().includes(query));
  }, [q, tools]);
  return (
    <div>
      <label className="block text-sm font-bold text-slate-800" htmlFor="en-tool-search">
        Search tools
        <input
          id="en-tool-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="QR, VAT, BMI..."
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base outline-none focus:border-emerald-600"
        />
      </label>
      {list.length === 0 ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">No tool matches that search.</p>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {list.map((tool) => (
            <Link key={tool.href} href={tool.href} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 hover:ring-emerald-600">
              <h2 className="text-lg font-bold text-slate-900">{tool.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">{tool.text}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
