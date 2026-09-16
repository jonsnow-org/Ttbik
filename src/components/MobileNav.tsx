"use client";

import { useState } from "react";
import Logo from "@/components/Logo";

/**
 * Mobile-only hamburger + slide-in drawer for the site header's nav
 * links. The header's horizontal nav row was a single scrolling line
 * (overflow-x-auto) that, combined with the logo and the owner's
 * "لوحة التحكم" button sharing the same row, looked cramped/cut-off on
 * narrow phones and had no real way to see every link at once — a real,
 * reported UX problem, not a style nitpick. This mirrors the exact
 * drawer pattern already used by StorefrontBrowser's category sidebar,
 * so it feels consistent with the rest of the site instead of a new
 * pattern.
 */
export default function MobileNav({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);

  const links = [
    { href: "/#categories", label: "الأقسام" },
    { href: "/free-tools", label: "🎁 أدوات مجانية" },
    { href: "/bots", label: "🤖 منشئ البوتات" },
    { href: "/tools", label: "🎬 أدوات الاستوديو" },
    { href: "/how-it-works", label: "كيف يعمل الموقع؟" },
    { href: "/order/lookup", label: "تتبع طلبي" },
  ];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="فتح القائمة"
        className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
      >
        <span aria-hidden className="text-xl">☰</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-72 max-w-[80vw] overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 text-base font-extrabold text-brand-800">
                <Logo className="h-6 w-6" /> سوق تولز
              </span>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                aria-label="إغلاق"
              >
                ✕
              </button>
            </div>
            <nav className="space-y-1">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand-700"
                >
                  {link.label}
                </a>
              ))}
              {isOwner && (
                <a
                  href="/admin"
                  onClick={() => setOpen(false)}
                  className="mt-2 block rounded-xl bg-brand-700 px-3 py-2.5 text-center text-sm font-bold text-white transition hover:bg-brand-800"
                >
                  لوحة التحكم
                </a>
              )}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
