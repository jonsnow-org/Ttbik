import type { Metadata } from "next";
import MonetagInPagePush from "@/components/MonetagInPagePush";
import { headers } from "next/headers";
import "./globals.css";
import Logo from "@/components/Logo";
import { isOwnerServer } from "@/lib/isOwner";
import AdServiceWorker from "@/components/AdServiceWorker";
import AdSlot from "@/components/AdSlot";
import AnalyticsTracker from "@/components/AnalyticsTracker";
import MobileNav from "@/components/MobileNav";
import MarketTickers from "@/components/MarketTickers";
import EnMarketTickers from "@/components/EnMarketTickers";
import { fetchMarkets } from "@/lib/markets";
import { fetchEnMarkets } from "@/lib/autoFeeds";
import { withinMs } from "@/lib/lastGood";
import PaidBanner from "@/components/PaidBanner";
import StickyBottomAd from "@/components/StickyBottomAd";
import TelegramSwipeLock from "@/components/TelegramSwipeLock";
import { LIVE_BOTS } from "@/lib/liveBots";

import { SITE_URL } from "@/lib/siteUrl";
const SITE_TITLE = "شام AI — Sham AI | الذكاء الاصطناعي والتقنية والخدمات الرقمية المتكاملة";
const SITE_DESCRIPTION =
  "مشروع شام للذكاء الاصطناعي والتقنية والخدمات الرقمية المتكاملة: خدمات وأدوات رقمية جاهزة (بوتات، أدوات ذكاء اصطناعي، أتمتة) بأسعار رمزية وتسليم فوري، بالإضافة لأدوات مجانية حقيقية تعمل مباشرة في متصفحك.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: "%s | شام AI" },
  description: SITE_DESCRIPTION,
  keywords: ["شام AI", "Sham AI", "خدمات رقمية", "أدوات مجانية", "بوت تليجرام", "أدوات ذكاء اصطناعي", "متجر خدمات مصغرة"],
  // "./" = this page's own URL (resolved against metadataBase). A fixed "/" told Google every page without its own canonical was a copy of the homepage.
  alternates: { canonical: "./" },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || "L8vGbLXr7dgW6fI-Z17Ahc85aCfxZP4JMLwyGMNhr_g",
    yandex: process.env.YANDEX_SITE_VERIFICATION || undefined,
    other: {
      ...{ "msvalidate.01": process.env.BING_SITE_VERIFICATION || "500FCBAE2506B455C22D3676A5315E2F" },
      ...(process.env.PINTEREST_SITE_VERIFICATION ? { "p:domain_verify": process.env.PINTEREST_SITE_VERIFICATION } : {}),
      ...(process.env.BAIDU_SITE_VERIFICATION ? { "baidu-site-verification": process.env.BAIDU_SITE_VERIFICATION } : {}),
      ...(process.env.NAVER_SITE_VERIFICATION ? { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION } : {}),
      // Any other engine: SITE_VERIFICATION_TAGS="name1=content1;name2=content2"
      ...Object.fromEntries(
        (process.env.SITE_VERIFICATION_TAGS || "")
          .split(";")
          .map((p) => p.split("="))
          .filter((p) => p.length === 2 && p[0].trim() && p[1].trim())
          .map((p) => [p[0].trim(), p[1].trim()]),
      ),
    },
  },
  openGraph: {
    type: "website",
    locale: "ar_AR",
    url: "/",
    siteName: "شام AI",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  other: {
    // two verification tags: the first for ttbik.vercel.app, the second for the gate address (ttbik-gate.jonsnowx1r.workers.dev); public/sw.js is the gate site's Monetag push worker
    monetag: ["36da4061f0ef04286fa5040bef5547dc", "af3ca743d204313f459c35df00b83322"],
  },
};

const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "شام AI",
  alternateName: ["Sham AI"],
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  sameAs: LIVE_BOTS.map((b) => b.href),
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-pathname") || "";
  const isMiniApp = pathname.startsWith("/mini-app") || pathname.startsWith("/fadaa") || pathname.startsWith("/match-app");

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
          <TelegramSwipeLock />
          {children}
        </body>
      </html>
    );
  }

  const isOwner = await isOwnerServer();

  // The tickers are rendered with data on the server (the providers answer through Next's 5-minute data cache), so crawlers, slow phones and
  // the first paint see numbers instead of dashes; the browser then refreshes them. A slow provider never holds the page: 2.5 s at most.
  const isEnDesk = pathname === "/en" || pathname.startsWith("/en/");
  const marketsAr = isEnDesk ? null : await withinMs(fetchMarkets(), 2500);
  const marketsEn = isEnDesk ? await withinMs(fetchEnMarkets(), 2500) : null;

  // English desk (/en/*): its own header, ticker and footer in English, LTR,
  // with the global-markets ticker (the Arabic chrome below stays for everything else).
  if (pathname === "/en" || pathname.startsWith("/en/")) {
    return (
      <html lang="en" dir="ltr">
        <body className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
          <TelegramSwipeLock />
          <AdServiceWorker />
          <AnalyticsTracker isOwner={isOwner} />
        {/* In-Page Push for the gate address only, never on money/private/owner pages (lib/monetagGate.ts) */}
        {!isOwner && <MonetagInPagePush />}
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5">
              <a href="/en" className="flex shrink-0 items-center gap-2 text-lg font-extrabold text-brand-800">
                <Logo className="h-7 w-7" /> Sham AI
              </a>
              <nav className="hidden items-center gap-1 text-sm font-semibold text-slate-600 md:flex" aria-label="Main">
                <a href="/en/news" className="rounded-full px-3 py-1.5 hover:bg-brand-50">News</a>
                <a href="/en/markets" className="rounded-full px-3 py-1.5 hover:bg-brand-50">Markets</a>
                <a href="/en/free-tools" className="rounded-full px-3 py-1.5 text-emerald-600 hover:bg-emerald-50">Free tools</a>
                <a href="/en/articles" className="rounded-full px-3 py-1.5 hover:bg-brand-50">Guides</a>
                <a href="/en/events" className="rounded-full px-3 py-1.5 hover:bg-brand-50">Dates</a>
              </nav>
              <div className="flex items-center gap-2">
                <a href="/en/advertise" className="rounded-full bg-amber-400 px-3 py-1 text-xs font-extrabold text-slate-950">Advertise</a>
                <a href="/" hrefLang="ar" className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">Arabic</a>
              </div>
            </div>
          </header>
          <div className="relative z-20 bg-white">
            <EnMarketTickers initial={marketsEn} />
            <PaidBanner lang="en" />
          </div>
          <div className="mx-auto max-w-6xl px-4 py-2">
            <AdSlot position="header-banner" label="Top of page" isOwner={isOwner} />
          </div>
          <main>{children}</main>
          <div className="mx-auto max-w-6xl px-4 py-2">
            <AdSlot position="footer-banner" label="Above footer" isOwner={isOwner} />
          </div>
          <footer className="mt-20 border-t border-slate-200 bg-white">
            <div className="mx-auto max-w-6xl px-4 py-10">
              <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
                <a href="/en" className="flex items-center gap-2 text-base font-extrabold text-brand-800">
                  <Logo className="h-6 w-6" /> Sham AI
                </a>
                <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-500">
                  <a href="/en/news" className="hover:text-brand-700">News</a>
                  <a href="/en/markets" className="hover:text-brand-700">Markets</a>
                  <a href="/en/free-tools" className="hover:text-brand-700">Free tools</a>
                  <a href="/en/articles" className="hover:text-brand-700">Guides</a>
                  <a href="/en/events" className="hover:text-brand-700">Dates</a>
                  <a href="/en/advertise" className="hover:text-brand-700">Advertise</a>
                  <a href="/" className="hover:text-brand-700">Arabic site</a>
                </p>
              </div>
              <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-6 text-xs text-slate-400 sm:flex-row">
                <p>© {new Date().getFullYear()} Sham AI. All rights reserved.</p>
                <p className="flex items-center gap-4">
                  <a href="/terms" className="hover:text-brand-700">Terms</a>
                  <a href="/privacy" className="hover:text-brand-700">Privacy</a>
                </p>
              </div>
            </div>
          </footer>
          <StickyBottomAd isOwner={isOwner} lang="en" />
        </body>
      </html>
    );
  }

  return (
    <html lang="ar" dir="rtl">
            <body className="min-h-screen bg-slate-50 font-sans text-slate-800 antialiased">
        <script src="https://telegram.org/js/telegram-web-app.js" async />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }} />
        {/* Unconditional, for every visitor including the owner -- this now
            only unregisters any stale service worker + clears Cache Storage
            (see AdServiceWorker.tsx's own comment for why it stopped
            registering the ad network's service worker at all). Anyone who
            got it installed on a previous visit, owner included, needs it
            actively removed, not just skipped going forward. */}
        <TelegramSwipeLock />
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
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5">
            <a href="/" className="flex shrink-0 items-center gap-2 text-lg font-extrabold text-brand-800">
              <Logo className="h-7 w-7" /> شام AI
            </a>
            <a href="/advertise" className="rounded-full bg-amber-400 px-3 py-1 text-xs font-extrabold text-slate-950">أعلن Advertise</a>
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
              <a href="/bashar" className="rounded-full px-3 py-1.5 font-extrabold text-indigo-700 transition hover:bg-indigo-50">
                💬 بَشَر
              </a>
              <a href="/guess-word" className="rounded-full px-3 py-1.5 transition hover:bg-brand-50 hover:text-brand-700">
                🔤 خمّن الكلمة
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
        <div className="relative z-20 bg-white">
          <MarketTickers initial={marketsAr} />
          <PaidBanner />
        </div>
        <div className="mx-auto max-w-6xl px-4 py-2">
          <AdSlot position="header-banner" label="أعلى الصفحة" isOwner={isOwner} />
        </div>
        <main>{children}</main>
        <div className="mx-auto max-w-6xl px-4 py-2">
          <AdSlot position="footer-banner" label="أسفل الصفحة قبل الفوتر" isOwner={isOwner} />
        </div>
        <footer className="mt-20 border-t border-slate-200 bg-white">
          <a href="https://t.me/Admen10bot?startapp=site" className="block bg-slate-950 px-4 py-3 text-center text-sm font-extrabold text-white">تطبيق @Admen10bot — افتح الموقع من البوت</a>
          <div className="mx-auto max-w-6xl px-4 py-10">
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-right">
              <a href="/" className="flex items-center gap-2 text-base font-extrabold text-brand-800">
                <Logo className="h-6 w-6" /> شام AI
              </a>
              <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-slate-500">
                <a href="/prayer-times" className="hover:text-brand-700">مواقيت الصلاة</a>
                <a href="/news" className="hover:text-brand-700">الأخبار</a>
                <a href="/advertise" className="hover:text-brand-700">الإعلان على الموقع</a>
                <a href="/en/advertise" className="hover:text-brand-700">Advertise</a>
                <a href="/events" className="hover:text-brand-700">الأحداث</a>
                <a href="/bots" className="hover:text-brand-700">منشئ البوتات</a>
                <a href="/how-it-works" className="hover:text-brand-700">كيف يعمل الموقع؟</a>
                <a href="/#free-tools" className="hover:text-brand-700">أدوات مجانية</a>
                <a href="/order/lookup" className="hover:text-brand-700">تتبع طلبي</a>
              </p>
            </div>
            <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-6 text-xs text-slate-400 sm:flex-row">
              <p>© {new Date().getFullYear()} شام AI — جميع الحقوق محفوظة.</p>
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
