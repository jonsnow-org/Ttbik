"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";

/**
 * Mobile-only hamburger + slide-in drawer for site-wide navigation.
 * Owner directive: keep sections high-level only.
 * Claude bots creator is clearly labeled to distinguish from Grok admin tools.
 */
export default function MobileNav({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const groups: { label: string; badge?: string; links: { href: string; label: string }[] }[] = [
    {
      label: "الرئيسية",
      links: [{ href: "/", label: "🏠 الصفحة الرئيسية" }],
    },
    {
      label: "الأدوات المجانية",
      badge: "G",
      links: [{ href: "/free-tools", label: "🎁 كل الأدوات المجانية" }],
    },
    {
      label: "الأدوات المدفوعة",
      links: [{ href: "/tools", label: "🎬 أدوات الاستوديو المتقدمة" }],
    },
    {
      label: "قسم البوتات",
      links: [
        { href: "/bots", label: "🤖 منشئ بوتات كلود" },
        { href: "/watch-and-earn", label: "💰 اربح من مشاهدة الإعلانات" },
        { href: "/bots/health-check", label: "🔍 فاحص صحة البوتات" },
        { href: "/bots/earnings-calculator", label: "📊 حاسبة أرباح تليجرام" },
        { href: "/#categories", label: "الأقسام والخدمات" },
      ],
    },
    {
      label: "عام",
      links: [
        { href: "/how-it-works", label: "كيف يعمل الموقع؟" },
        { href: "/order/lookup", label: "تتبع طلبي" },
      ],
    },
  ];

  const drawer = open && (
    <div className="fixed inset-0 z-[100] lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div className="absolute inset-y-0 right-0 flex w-72 max-w-[80vw] flex-col overflow-y-auto bg-white p-4 shadow-xl">
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
        <nav className="space-y-5">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mb-1.5 flex items-center gap-1.5 px-3 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {group.badge && (
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-emerald-600 text-[10px] font-black text-white">
                    {group.badge}
                  </span>
                )}
                {group.label}
              </div>
              <div className="space-y-1">
                {group.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand-700"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
          {isOwner && (
            <>
              <a
                href="/admin-tools"
                onClick={() => setOpen(false)}
                className="block rounded-xl bg-violet-600 px-3 py-2.5 text-center text-sm font-bold text-white transition hover:bg-violet-700"
              >
                🛠️ أدوات الأدمن (جروك)
              </a>
              <a
                href="/admin"
                onClick={() => setOpen(false)}
                className="block rounded-xl bg-brand-700 px-3 py-2.5 text-center text-sm font-bold text-white transition hover:bg-brand-800"
              >
                لوحة التحكم
              </a>
            </>
          )}
        </nav>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="فتح القائمة"
        className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 lg:hidden"
      >
        <span aria-hidden className="text-xl">☰</span>
      </button>
      {mounted && drawer ? createPortal(drawer, document.body) : null}
    </>
  );
}
