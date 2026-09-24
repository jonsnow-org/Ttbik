import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import Logo from "@/components/Logo";
import { isOwnerServer } from "@/lib/isOwner";
import AdServiceWorker from "@/components/AdServiceWorker";
import AdSlot from "@/components/AdSlot";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import MobileNav from "@/components/MobileNav";
import StickyBottomAd from "@/components/StickyBottomAd";
import { LIVE_BOTS } from "@/lib/liveBots";

import { SITE_URL } from "@/lib/siteUrl";
const SITE_TITLE = "سوق تولز — سوق الخدمات الرقمية المصغّرة";
const SITE_DESCRIPTION =
  "سوق تولز: منصة لبيع خدمات وأدوات رقمية جاهزة (بوتات، أدوات ذكاء اصطناعي، أتمتة) بأسعار رمزية وتسليم فوري، بالإضافة لأدوات مجانية حقيقية تعمل مباشرة في متصفحك.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s | سوق تولز" },
  description: SITE_DESCRIPTION,
  keywords: ["سوق تولز", "خدمات رقمية", "أدوات مجانية", "بوت تليجرام", "أدوات ذكاء اصطناعي", "متجر خدمات مصغرة"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ar_AR",
    url: "/",
    siteName: "سوق تولز",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  other: {
    monetag: "36da4061f0ef04286fa5040bef5547dc",
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "سوق تولز",
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  sameAs: LIVE_BOTS.map((b) => b.href),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = headers().get("x-pathname") || "";
  const isMiniApp = pathname.startsWith("/mini-app");

  // Embeddable widgets (/embed/*) are shown inside other sites' iframes:
  // no header, ads or footer — just the widget.
  if (pathname.startsWith("/embed")) {
    return (
      <html lang="ar" dir="rtl">
        <body className="bg-transparent font-sans text-slate-800 antialiased">{children}</body>
      </html>
    );
  }

  if (isMiniApp) {
    return (
      <html lang="ar" dir="rtl">
        <body className="min-h-screen bg-[#e3f2fd] font-sans text-slate-800 antialiased">
          {children}
        </body>
      </html>
    );
  }

  const isOwner = isOwnerServer();

  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }} />
        {/* Unconditional, for every visitor including the owner -- this now
            only unregisters any stale service worker + clears Cache Storage
            (see AdServiceWorker.tsx's own comment for why it stopped
            registering the ad network's service worker at all). Anyone who
            got it installed on a previous visit, owner included, needs it
            actively removed, not just skipped going forward. */}
        <AdServiceWorker />
        {/* Intrusive ad formats removed site-wide (owner directive
            2026-09-24): Monetag In-Page Push (notification-style popups)
            and Multitag (popunder / new-window / interstitial bundle).
            Only non-intrusive placements remain: AdSlot banners and the
            dismissible StickyBottomAd. Don't re-add push/popunder scripts. */}
        <AnalyticsTracker isOwner={isOwner} />
        {isOwner && (
          <div className="bg-emerald-600 py-1.5 text-center text-xs font-bold text-white">
            🔑 وضع المالك مفعّل — لديك وصول كامل لكل الخدمات والأدوات
          </div>
        )}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5">
            <a href="/" className="flex shrink-0 items-center gap-2 text-lg font-extrabold text-brand-800">
              <Logo className="h-7 w-7" /> سوق تولز
            </a>
            <nav className="hidden min-w-0 flex-1 items-center gap-1 whitespace-nowrap text-sm font-semibold text-slate-600 lg:flex">
              <a href="/#categories" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                الأقسام
              </a>
              <a
                href="/#free-tools"
                className="rounded-full px-3 py-1.5 text-emerald-600 transition hover:bg-emerald-50 hover:text-emerald-700"
              >
                🎁 أدوات مجانية
              </a>
              <a href="/bots" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                🤖 منشئ البوتات
              </a>
              <a href="/prayer-times" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                🕌 المواقيت
              </a>
              <a href="/news" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                📰 الأخبار
              </a>
              <a href="/watch-and-earn" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                💰 اربح من الإعلانات
              </a>
              <a href="/how-it-works" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                كيف يعمل الموقع؟
              </a>
              <a href="/order/lookup" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                تتبع طلبي
              </a>
            </nav>
            <div className="flex-1 lg:hidden" />
            <MobileNav isOwner={isOwner} />
            {isOwner && (
              <a
                href="/admin"
                className="hidden shrink-0 rounded-full bg-brand-700 px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-brand-800 lg:inline-block"
              >
                لوحة التحكم
              </a>
            )}
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 py-2">
          <AdSlot position="header-banner" label="أعلى الصفحة" />
        </div>
        <main>{children}</main>
        <div className="mx-auto max-w-6xl px-4 py-2">
          <AdSlot position="footer-banner" label="أسفل الصفحة قبل الفوتر" />
        </div>
        <footer className="mt-20 border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-right">
              <a href="/" className="flex items-center gap-2 text-base font-extrabold text-brand-800">
                <Logo className="h-6 w-6" /> سوق تولز
              </a>
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-500">
                <a href="/prayer-times" className="hover:text-brand-700">مواقيت الصلاة</a>
                <a href="/news" className="hover:text-brand-700">الأخبار</a>
                <a href="/events" className="hover:text-brand-700">الأحداث</a>
                <a href="/bots" className="hover:text-brand-700">منشئ البوتات</a>
                <a href="/how-it-works" className="hover:text-brand-700">كيف يعمل الموقع؟</a>
                <a href="/#free-tools" className="hover:text-brand-700">أدوات مجانية</a>
                <a href="/order/lookup" className="hover:text-brand-700">تتبع طلبي</a>
              </p>
            </div>
            <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-6 text-xs text-slate-400 sm:flex-row">
              <p>© {new Date().getFullYear()} سوق تولز — جميع الحقوق محفوظة.</p>
              <p className="flex items-center gap-4">
                <a href="/terms" className="hover:text-brand-700">الشروط وسياسة الاسترجاع</a>
                <a href="/privacy" className="hover:text-brand-700">سياسة الخصوصية</a>
              </p>
            </div>
          </div>
        </footer>
        <StickyBottomAd isOwner={isOwner} />
      </body>
    </html>
  );
}
