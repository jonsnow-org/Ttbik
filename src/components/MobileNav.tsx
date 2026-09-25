"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Logo from "@/components/Logo";

/**
 * Mobile-only hamburger + slide-in drawer. The per-tool admin shortcuts
 * (أدوات الأدمن / منشئ بوتات كلود) deliberately do NOT live here (owner
 * directive, 2026-09-20): they already exist as cards inside /admin's own
 * dashboard, so duplicating them here is clutter. That directive did NOT
 * cover the /admin link itself, though -- removing it too left the owner
 * with zero way to reach /admin on mobile at all (the desktop header's
 * link is `hidden lg:inline-block`), a real regression she hit directly
 * (owner-reported, 2026-09-21). The single canonical /admin entry point
 * is restored below, owner-only, not a duplicate of anything in /admin.
 */
export default function MobileNav({ isOwner }: { isOwner?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  // No background-scroll-lock (no `body.style.overflow = "hidden"`):
  // real, reported bug (2026-09-20) in Telegram's in-app browser -- some
  // mobile WebViews route ALL touch-scroll gestures through whatever
  // `overflow` the page's own <body> has, so locking it also silently
  // breaks scrolling *inside* this drawer, not just the page behind it.
  // Losing the "background can't scroll while the drawer is open" nicety
  // is a much smaller cost than a menu the owner can't scroll at all.

  const groups: { label: string; badge?: string; links: { href: string; label: string }[] }[] = [
    {
      label: "الرئيسية",
      links: [
        { href: "/", label: "🏠 الصفحة الرئيسية" },
        { href: "/bashar", label: "💬 بَشَر — يجيبك إنسان لا ذكاء اصطناعي" },
        { href: "/guess-word", label: "🔤 خمّن الكلمة — لغز يومي" },
      ],
    },
    {
      label: "الأدوات",
      links: [
        { href: "/#free-tools", label: "🎁 الأدوات المجانية" },
      ],
    },
    {
      label: "اليوم",
      links: [
        { href: "/prayer-times", label: "🕌 مواقيت الصلاة" },
        { href: "/news", label: "📰 الأخبار" },
        { href: "/events", label: "🗓️ أحداث ومقالات" },
      ],
    },
    {
      label: "قسم البوتات",
      links: [
        { href: "/bots", label: "🤖 منشئ البوتات" },
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
    ...(isOwner
      ? [{ label: "المالك", links: [{ href: "/admin", label: "🔑 لوحة التحكم" }] }]
      : []),
  ];

  const drawer = open && (
    <div className="fixed inset-0 z-[100] lg:hidden">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div
        className="absolute inset-y-0 right-0 flex h-full w-72 max-w-[80vw] flex-col overflow-y-auto overscroll-contain bg-white p-4 shadow-xl"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
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
