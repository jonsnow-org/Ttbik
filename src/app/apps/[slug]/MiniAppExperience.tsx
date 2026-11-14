"use client";

import { useMemo, useState } from "react";
import type { AppConfig, AppItem, AppPalette } from "@/lib/hub/appConfig";
import QuizApp from "./QuizApp";

type Page = "home" | "catalog" | "contact";

function contactHref(contact?: string, message?: string): string | null {
  if (!contact) return null;
  const body = encodeURIComponent(message || "مرحباً");
  if (contact.startsWith("@")) return "https://t.me/" + contact.slice(1);
  if (/^\\+?\\d{7,15}$/.test(contact)) return "https://wa.me/" + contact.replace(/\\D/g, "") + "?text=" + body;
  if (/^https:\\/\\//.test(contact)) return contact;
  return null;
}

function itemHref(config: AppConfig, item: AppItem): string | null {
  if (config.template === "booking") {
    return contactHref(config.contact, "مرحباً، أود حجز: " + item.title) || item.url || null;
  }
  return item.url || null;
}

export default function MiniAppExperience({
  config,
  palette,
  views,
}: {
  config: AppConfig;
  palette: AppPalette;
  views: number;
}) {
  const [page, setPage] = useState<Page>("home");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [copied, setCopied] = useState(false);
  const commerce = config.template === "store" || config.template === "menu";
  const contentLabel = config.template === "quiz" ? "الاختبار" : config.template === "links" ? "روابطي" : config.template === "portfolio" ? "الأعمال" : config.template === "booking" ? "الخدمات" : "المنتجات";
  const cartCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const orderMessage = useMemo(() => {
    const lines = config.items
      .map((item, index) => cart[index] ? "• " + item.title + " × " + cart[index] + (item.price ? " — " + item.price : "") : "")
      .filter(Boolean);
    return "مرحباً، أود طلب:\n" + lines.join("\n");
  }, [cart, config.items]);
  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return config.items;
    return config.items.filter((item) => (item.title + " " + (item.desc || "")).toLocaleLowerCase().includes(query));
  }, [config.items, search]);
  const pages = [
    { id: "home" as const, label: "الرئيسية", icon: "⌂" },
    { id: "catalog" as const, label: contentLabel, icon: config.template === "quiz" ? "?" : config.template === "links" ? "↗" : "▦" },
    { id: "contact" as const, label: "تواصل", icon: "✉" },
  ];
  const contactUrl = contactHref(config.contact, "مرحباً، أود الاستفسار عن " + config.title);

  function addToCart(index: number) {
    setCart((current) => ({ ...current, [index]: (current[index] || 0) + 1 }));
  }

  function changeQuantity(index: number, delta: number) {
    setCart((current) => {
      const next = { ...current };
      const quantity = (next[index] || 0) + delta;
      if (quantity <= 0) delete next[index];
      else next[index] = quantity;
      return next;
    });
  }

  async function copyOrder() {
    try {
      await navigator.clipboard.writeText(orderMessage);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  function openOrder() {
    const url = contactHref(config.contact, orderMessage);
    if (!url) {
      setPage("contact");
      return;
    }
    if (config.contact?.startsWith("@")) void copyOrder();
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function renderItem(item: AppItem, index: number) {
    const href = itemHref(config, item);
    const quantity = cart[index] || 0;
    return (
      <article key={index} className={"user-created-app__item user-created-app__item--" + config.template}>
        <div className="user-created-app__item-top">
          <div className="user-created-app__item-copy">
            <span className="user-created-app__item-kicker">
              {config.template === "portfolio" ? "عمل رقم " + String(index + 1).padStart(2, "0") : config.template === "booking" ? "خدمة متاحة" : config.template === "menu" ? "من القائمة" : "اختيار مميز"}
            </span>
            <h3 className="user-created-app__item-title">{item.title}</h3>
            {item.desc && <p className="user-created-app__item-desc">{item.desc}</p>}
          </div>
          {item.price && item.price !== "—" && <span className="user-created-app__price">{item.price}</span>}
        </div>
        {commerce && config.contact ? (
          <div className="user-created-app__item-actions">
            <button type="button" className="user-created-app__action" onClick={() => addToCart(index)}>
              <span>أضف إلى الطلب</span><span aria-hidden="true">＋</span>
            </button>
            {quantity > 0 && (
              <div className="user-created-app__quantity" aria-label={"الكمية: " + quantity}>
                <button type="button" onClick={() => changeQuantity(index, -1)} aria-label="تقليل الكمية">−</button>
                <strong>{quantity}</strong>
                <button type="button" onClick={() => changeQuantity(index, 1)} aria-label="زيادة الكمية">＋</button>
              </div>
            )}
          </div>
        ) : href ? (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="user-created-app__action">
            <span>{config.template === "booking" ? "احجز هذه الخدمة" : config.template === "links" ? "فتح الرابط" : config.template === "portfolio" ? "عرض العمل" : "عرض التفاصيل"}</span>
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <button type="button" className="user-created-app__action user-created-app__action--soft" onClick={() => setPage("contact")}>
            <span>{config.template === "booking" ? "استفسر عن الحجز" : "اسأل عن التفاصيل"}</span><span aria-hidden="true">←</span>
          </button>
        )}
      </article>
    );
  }

  return (
    <div dir="rtl" className="user-created-app" data-template={config.template} data-page={page}>
      <header className="user-created-app__hero">
        <div className="user-created-app__hero-inner">
          <div className="user-created-app__topline">
            <span className="user-created-app__type">{config.template === "store" ? "🛍️ متجر إلكتروني" : config.template === "booking" ? "📅 حجوزات" : config.template === "menu" ? "🍽️ قائمة" : config.template === "portfolio" ? "🎨 معرض أعمال" : config.template === "links" ? "🔗 روابط" : "✨ اختبار تفاعلي"}</span>
            <span className="user-created-app__views">{views} مشاهدة</span>
          </div>
          <h1>{config.title}</h1>
          {config.tagline && <p className="user-created-app__tagline">{config.tagline}</p>}
        </div>
      </header>

      <main className="user-created-app__content">
        {page === "home" && (
          <section className="user-created-app__home">
            <div className="user-created-app__welcome">
              <span className="user-created-app__eyebrow">مرحباً بك</span>
              <h2>{config.title}</h2>
              <p>{config.tagline || (config.template === "store" ? "تصفّح المنتجات واختر ما يناسبك." : config.template === "booking" ? "اختر الخدمة المناسبة وتواصل لتأكيد موعدك." : config.template === "menu" ? "اكتشف القائمة واختر ما تشتهي." : config.template === "portfolio" ? "تعرّف على الأعمال والخدمات المعروضة." : config.template === "links" ? "كل الروابط المهمة في مكان واحد." : "اختبر معلوماتك واكتشف نتيجتك.")}</p>
              <button type="button" className="user-created-app__primary" onClick={() => setPage("catalog")}>
                {config.template === "quiz" ? "ابدأ الاختبار" : "استكشف " + contentLabel}<span aria-hidden="true"> ←</span>
              </button>
            </div>
            <div className="user-created-app__stats">
              <div><strong>{config.items.length}</strong><span>{config.template === "quiz" ? "سؤال" : config.template === "links" ? "رابط" : config.template === "portfolio" ? "عمل" : "عنصر"}</span></div>
              <div><strong>{views}</strong><span>زيارة</span></div>
              <div><strong>24/7</strong><span>متاح للتصفح</span></div>
            </div>
            {config.items.length > 0 && config.template !== "quiz" && (
              <div className="user-created-app__featured">
                <div className="user-created-app__section-heading">
                  <div><span className="user-created-app__eyebrow">مختارات</span><h2>{config.template === "links" ? "روابط مهمة" : config.template === "portfolio" ? "أعمال مميزة" : "اكتشف المحتوى"}</h2></div>
                  <button type="button" className="user-created-app__text-link" onClick={() => setPage("catalog")}>عرض الكل</button>
                </div>
                <div className="user-created-app__featured-list">
                  {config.items.slice(0, 2).map((item, index) => (
                    <div className="user-created-app__featured-item" key={index}>
                      <span className="user-created-app__featured-icon">{config.template === "links" ? "↗" : config.template === "portfolio" ? "✦" : config.template === "booking" ? "◷" : "✧"}</span>
                      <div><strong>{item.title}</strong>{item.price && <small>{item.price}</small>}</div>
                      <button type="button" onClick={() => setPage("catalog")} aria-label={"عرض " + item.title}>←</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="user-created-app__home-contact">
              <div><strong>هل تحتاج إلى مساعدة؟</strong><span>تواصل مباشرة مع صاحب التطبيق.</span></div>
              <button type="button" onClick={() => setPage("contact")}>تواصل معنا</button>
            </div>
          </section>
        )}

        {page === "catalog" && (
          <section className="user-created-app__catalog">
            <div className="user-created-app__section-heading">
              <div><span className="user-created-app__eyebrow">{config.template === "quiz" ? "تحدّ نفسك" : "تصفّح بسهولة"}</span><h2>{contentLabel}</h2></div>
              <span className="user-created-app__count">{config.items.length} عنصر</span>
            </div>
            {config.template !== "quiz" && (
              <label className="user-created-app__search">
                <span aria-hidden="true">⌕</span>
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={"ابحث في " + contentLabel + "…"} aria-label={"ابحث في " + contentLabel} />
                {search && <button type="button" onClick={() => setSearch("")} aria-label="مسح البحث">×</button>}
              </label>
            )}
            {config.template === "quiz" ? (
              config.items.length ? <QuizApp items={config.items} color={palette.brand} onColor={palette.onBrand} /> : <div className="user-created-app__empty">لم يضف صاحب التطبيق أسئلة بعد.</div>
            ) : filteredItems.length ? (
              <div className="user-created-app__items" data-template={config.template}>
                {filteredItems.map((item) => renderItem(item, config.items.indexOf(item)))}
              </div>
            ) : (
              <div className="user-created-app__empty"><span>⌕</span><p>لا توجد نتائج مطابقة لبحثك.</p><button type="button" onClick={() => setSearch("")}>إظهار الكل</button></div>
            )}
            {commerce && !config.contact && <p className="user-created-app__hint">أضف وسيلة تواصل في إعدادات التطبيق لتفعيل استقبال الطلبات.</p>}
            {commerce && cartCount > 0 && config.contact && (
              <aside className="user-created-app__cart" aria-live="polite">
                <div className="user-created-app__cart-top"><div><strong>طلبك جاهز</strong><span>{cartCount} قطعة في السلة</span></div><b>{cartCount}</b></div>
                <div className="user-created-app__cart-lines">
                  {config.items.map((item, index) => cart[index] ? <div key={index}><span>{item.title} × {cart[index]}</span><strong>{item.price || ""}</strong></div> : null)}
                </div>
                <div className="user-created-app__cart-actions">
                  <button type="button" className="user-created-app__primary" onClick={openOrder}>متابعة الطلب <span aria-hidden="true">↗</span></button>
                  <button type="button" className="user-created-app__secondary" onClick={copyOrder}>{copied ? "نُسخ الطلب ✓" : "نسخ التفاصيل"}</button>
                </div>
                {config.contact.startsWith("@") && <small>انسخ تفاصيل الطلب وأرسلها في محادثة تيليجرام التي ستُفتح.</small>}
              </aside>
            )}
          </section>
        )}

        {page === "contact" && (
          <section className="user-created-app__contact">
            <div className="user-created-app__contact-card">
              <span className="user-created-app__contact-icon">✉</span>
              <span className="user-created-app__eyebrow">نحن هنا لمساعدتك</span>
              <h2>تواصل مع صاحب التطبيق</h2>
              <p>للاستفسارات أو الطلبات أو حجز موعد، استخدم وسيلة التواصل المحددة لهذا التطبيق.</p>
              {contactUrl ? (
                <a href={contactUrl} target="_blank" rel="noopener noreferrer" className="user-created-app__primary">ابدأ المحادثة <span aria-hidden="true">↗</span></a>
              ) : (
                <div className="user-created-app__empty">لم يضف صاحب التطبيق وسيلة تواصل بعد.</div>
              )}
            </div>
            {commerce && <div className="user-created-app__contact-note"><strong>تريد تقديم طلب؟</strong><p>ارجع إلى {contentLabel} وأضف المنتجات إلى طلبك، ثم تابع التواصل لإرسال التفاصيل.</p><button type="button" onClick={() => setPage("catalog")}>العودة إلى {contentLabel}</button></div>}
          </section>
        )}

        <p className="user-created-app__footer">صُنع عبر <a href="/create">منشئ شام AI</a> · {views} مشاهدة</p>
      </main>

      <nav className="user-created-app__nav" aria-label="التنقل داخل التطبيق">
        {pages.map((entry) => (
          <button key={entry.id} type="button" className={page === entry.id ? "is-active" : ""} onClick={() => setPage(entry.id)} aria-current={page === entry.id ? "page" : undefined}>
            <span className="user-created-app__nav-icon" aria-hidden="true">{entry.icon}</span>
            <span>{entry.label}</span>
            {entry.id === "catalog" && commerce && cartCount > 0 && <i>{cartCount}</i>}
          </button>
        ))}
      </nav>
    </div>
  );
}
