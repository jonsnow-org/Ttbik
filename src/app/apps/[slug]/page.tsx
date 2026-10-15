import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Script from "next/script";
import { bumpViews, getApp } from "@/lib/hub/hubDb";
import { APP_TEMPLATES, validateAppConfig } from "@/lib/hub/appConfig";
import QuizApp from "./QuizApp";

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
  void bumpViews(slug);
  const t = APP_TEMPLATES[c.template];
  const action = c.template === "booking" ? "احجز" : c.template === "store" || c.template === "menu" ? "اطلب" : null;
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <header className="px-5 pb-8 pt-10 text-white" style={{ background: c.color }}>
        <div className="mx-auto max-w-lg">
          <div className="text-3xl">{t.icon}</div>
          <h1 className="mt-2 text-2xl font-extrabold">{c.title}</h1>
          {c.tagline && <p className="mt-1 text-sm opacity-90">{c.tagline}</p>}
        </div>
      </header>
      <main className="mx-auto -mt-4 max-w-lg space-y-3 px-4 pb-16">
        {c.template === "quiz" ? (
          <QuizApp items={c.items} color={c.color} />
        ) : (
          c.items.map((it, i) => {
            const href = c.template === "links" ? it.url : action ? contactHref(c.contact, it.title) : it.url;
            return (
              <div key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-slate-900">{it.title}</div>
                    {it.desc && <div className="mt-1 text-sm text-slate-600">{it.desc}</div>}
                  </div>
                  {it.price && it.price !== "—" && <div className="shrink-0 font-extrabold" style={{ color: c.color }}>{it.price}</div>}
                </div>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-block rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ background: c.color }}>
                    {c.template === "links" ? "فتح" : action || "عرض"}
                  </a>
                )}
              </div>
            );
          })
        )}
        {action && !c.contact && <p className="text-center text-xs text-slate-500">لم يضف صاحب التطبيق وسيلة تواصل بعد.</p>}
        <p className="pt-6 text-center text-xs text-slate-400">
          صُنع مجاناً عبر <a href="/create" className="underline">منشئ شام AI</a> · {row.views} مشاهدة
        </p>
      </main>
    </div>
  );
}
