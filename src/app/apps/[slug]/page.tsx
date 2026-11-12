import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import Script from "next/script";
import { appPalette, APP_TEMPLATES, validateAppConfig } from "@/lib/hub/appConfig";
import { bumpViews, getApp } from "@/lib/hub/hubDb";
import QuizApp from "./QuizApp";
import "./mini-app.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

// A mini app built in /create (no-code builder). Rendered from its stored JSON config on every request, so edits made by chat
// show up instantly. Works in a normal browser and as a Telegram Mini App (telegram-web-app.js); "Add to home screen" installs it.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const app = await getApp(slug).catch(() => null);
  return { title: app ? `${app.config.title} | صُنع بشام AI` : "تطبيق غير موجود", robots: { index: false } };
}

function contactHref(contact?: string, item?: string): string | null {
  if (!contact) return null;
  const msg = encodeURIComponent(item ? `مرحباً، أريد: ${item}` : "مرحباً");
  if (contact.startsWith("@")) return `https://t.me/${contact.slice(1)}`;
  if (/^\+?\d{7,15}$/.test(contact)) return `https://wa.me/${contact.replace(/\D/g, "")}?text=${msg}`;
  if (/^https:\/\//.test(contact)) return contact;
  return null;
}

export default async function MiniAppPage(props: Props) {
  const { slug } = await props.params;
  const row = await getApp(slug).catch(() => null);
  if (!row) notFound();
  const v = validateAppConfig(row.config);
  if (!v.ok) notFound();
  const c = v.config;
  const palette = appPalette(c.color);
  void bumpViews(slug);
  const t = APP_TEMPLATES[c.template];
  const action = c.template === "booking" ? "احجز" : c.template === "store" || c.template === "menu" ? "اطلب" : null;
  const themeStyle = {
    "--user-app-accent": palette.brand,
    "--user-app-on-accent": palette.onBrand,
    "--user-app-text-accent": palette.text,
    "--user-app-accent-soft": palette.soft,
  } as CSSProperties;
  return (
    <div dir="rtl" className="user-created-app" style={themeStyle} data-template={c.template}>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <header className="user-created-app__hero">
        <div className="user-created-app__hero-inner">
          <span className="user-created-app__type"><span aria-hidden="true">{t.icon}</span>{t.label}</span>
          <h1 className="mt-3 text-2xl font-extrabold">{c.title}</h1>
          {c.tagline && <p className="mt-2 max-w-prose text-sm leading-6 opacity-95">{c.tagline}</p>}
        </div>
      </header>
      <main className="user-created-app__content">
        {c.template === "quiz" ? (
          <QuizApp items={c.items} color={palette.brand} onColor={palette.onBrand} />
        ) : c.items.length ? (
          <div className="user-created-app__items" data-template={c.template}>
            {c.items.map((it, i) => {
              const href = c.template === "links" ? it.url : action ? (contactHref(c.contact, it.title) || it.url) : it.url;
              return (
                <article key={i} className={`user-created-app__item user-created-app__item--${c.template}`}>
                  <div className="user-created-app__item-top">
                    <div className="user-created-app__item-copy">
                      {c.template === "portfolio" && <span className="user-created-app__item-kicker">مشروع {String(i + 1).padStart(2, "0")}</span>}
                      {c.template === "booking" && <span className="user-created-app__item-kicker">خدمة متاحة</span>}
                      <h2 className="user-created-app__item-title">{it.title}</h2>
                      {it.desc && <p className="user-created-app__item-desc">{it.desc}</p>}
                    </div>
                    {it.price && it.price !== "—" && <span className="user-created-app__price">{it.price}</span>}
                  </div>
                  {href && (
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={`user-created-app__action${c.template === "links" ? " user-created-app__action--link" : ""}`}>
                      <span>{c.template === "links" ? "فتح الرابط" : action || "عرض التفاصيل"}</span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="user-created-app__empty">
            <span aria-hidden="true">{t.icon}</span>
            <p>لم يضف صاحب التطبيق عناصر بعد.</p>
          </div>
        )}
        {action && !c.contact && <p className="user-created-app__hint">لم يضف صاحب التطبيق وسيلة تواصل بعد.</p>}
        <p className="user-created-app__footer">
          صُنع مجاناً عبر <a href="/create">منشئ شام AI</a> · {row.views} مشاهدة
        </p>
      </main>
    </div>
  );
}
