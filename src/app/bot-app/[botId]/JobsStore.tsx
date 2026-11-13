"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @next/next/no-img-element */
// 🛒 Store, 🛍 seller shops, 🏪 my shop and 📂 my orders of the jobs/store bot's Mini App. Same rules as the chat: selling and
// buy requests are for «تاجر» profiles, prices are negotiated through offers, escrow holds the buyer's balance until they confirm
// receipt (or 7 days pass without a dispute), and either side can open a dispute that the admins decide.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Btn, Chips, Copyable, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, inputCls, inputStyle, money, useApp } from "./ui";
import { ago, photoUrl, shareLink, useInit } from "./JobsMiniApp";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "info" | "neutral" }> = {
  ACTIVE: { label: "🟢 نشط", tone: "ok" }, PAUSED: { label: "⏸ متوقف", tone: "warn" }, SOLD: { label: "✅ مُباع", tone: "info" }, FULFILLED: { label: "✅ تم", tone: "info" },
  REMOVED: { label: "🗑 محذوف", tone: "bad" }, ESCROWED: { label: "🔒 محجوز", tone: "warn" }, RELEASED: { label: "✅ مكتمل", tone: "ok" }, REFUNDED: { label: "↩️ مُسترد", tone: "bad" },
  PENDING: { label: "⏳ بانتظار الرد", tone: "warn" }, ACCEPTED: { label: "✅ مقبول", tone: "ok" }, REJECTED: { label: "❌ مرفوض", tone: "bad" },
};
const StatusPill = ({ s }: { s: string }) => <Pill tone={STATUS[s]?.tone || "neutral"}>{STATUS[s]?.label || s}</Pill>;

export function Photo({ f, className = "", alt = "" }: { f: string | null | undefined; className?: string; alt?: string }) {
  const { botId } = useApp();
  const [bad, setBad] = useState(false);
  if (!f || bad) return <div className={`grid place-items-center text-3xl ${className}`} style={{ background: "color-mix(in srgb, var(--app-hint) 14%, transparent)" }}>📦</div>;
  return <img src={photoUrl(botId, f)} alt={alt} loading="lazy" onError={() => setBad(true)} className={`object-cover ${className}`} />;
}

function ProductCard({ l, onClick }: { l: any; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="overflow-hidden rounded-2xl text-start transition active:scale-[0.98]" style={{ background: "var(--app-card)" }}>
      <div className="relative">
        <Photo f={l.photos?.[0]} className="aspect-square w-full" alt={l.title} />
        {l.featured && <span className="absolute start-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-black" style={{ background: "#f59e0b", color: "#fff" }}>⭐ مميز</span>}
        {l.status && l.status !== "ACTIVE" && <span className="absolute end-2 top-2"><StatusPill s={l.status} /></span>}
      </div>
      <div className="p-2.5">
        <div className="line-clamp-2 min-h-[2.5rem] text-[13.5px] font-bold leading-5" style={{ color: "var(--app-text)" }}>{l.title}</div>
        <div className="mt-1 text-[15px] font-black" style={{ color: "var(--app-accent)" }}>{money(l.price)}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-[10.5px]" style={{ color: "var(--app-hint)" }}>
          {l.escrow ? <span>🔒 حجز آمن</span> : <span>🤝 يدوي</span>}<span>·</span><span>{l.shipping ? "🚚 شحن" : "📍 استلام"}</span>
        </div>
        {l.seller && <div className="mt-1 truncate text-[11px]" style={{ color: "var(--app-hint)" }}>{l.seller}</div>}
      </div>
    </button>
  );
}

function SearchBox({ value, onChange, onSubmit, placeholder }: { value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="mb-3 flex items-center gap-2 rounded-2xl px-3 py-2.5" style={{ background: "var(--app-card)" }}>
      <span>🔍</span>
      <input className={inputCls} style={inputStyle} value={value} placeholder={placeholder} enterKeyHint="search" onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" aria-label="مسح" onClick={() => { onChange(""); window.setTimeout(onSubmit, 0); }} className="text-sm" style={{ color: "var(--app-hint)" }}>✕</button>}
    </form>
  );
}

// ---------------------------------------------------------------- 🛒 store
export function StoreScreen({ tab: initialTab, otab }: { tab?: string; otab?: string }) {
  const { api, push, toast } = useApp();
  const { init } = useInit();
  const trader = init.profile?.roleType === "TRADER";
  const [tab, setTab] = useState<"sell" | "buy" | "orders" | "myshop">(initialTab === "buy" || initialTab === "orders" || initialTab === "myshop" ? initialTab : "sell");
  const browse = tab === "sell" || tab === "buy";
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<any>({ min: "", max: "", escrow: false, shipping: false, sort: "new" });
  const [showF, setShowF] = useState(false);
  const [items, setItems] = useState<any[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const qRef = useRef(q); qRef.current = q;
  const load = useCallback(async (offset = 0) => {
    if (tab !== "sell" && tab !== "buy") return; // «طلباتي» and «متجري» load themselves
    if (offset) setLoadingMore(true); else setItems(null);
    const r = await api<{ items: any[]; more: boolean }>("store_list", { tab, q: qRef.current, offset, filters: tab === "sell" ? filters : undefined });
    setLoadingMore(false);
    if (!r.ok) { toast(r.error || "", "err"); setItems((x) => x || []); return; }
    setItems((x) => (offset ? [...(x || []), ...r.items] : r.items));
    setMore(r.more);
  }, [api, tab, filters, toast]);
  useEffect(() => { void load(0); }, [load]);
  const fCount = (filters.min ? 1 : 0) + (filters.max ? 1 : 0) + (filters.escrow ? 1 : 0) + (filters.shipping ? 1 : 0) + (filters.sort !== "new" ? 1 : 0);
  return (
    <>
      <ScreenTitle icon="🛒" title="قسم المتجر" sub="تصفّح المنتجات وطلبات الشراء، وتفاوض على السعر بأمان." />
      <div className="mb-3"><Chips items={[{ id: "sell", label: "🛒 تصفح للبيع" }, { id: "buy", label: "🛍 تصفح للشراء" }, { id: "orders", label: "📂 طلباتي" }, { id: "myshop", label: "🏪 متجري" }]} value={tab} onChange={(v) => setTab(v)} /></div>
      {tab === "orders" && <OrdersScreen embedded tab={otab} />}
      {tab === "myshop" && <MyShopScreen embedded />}
      {browse && (<>
      <SearchBox value={q} onChange={setQ} onSubmit={() => void load(0)} placeholder={tab === "sell" ? "ابحث عن منتج…" : "ابحث في طلبات الشراء…"} />
      {tab === "sell" && (
        <div className="mb-3">
          <button type="button" onClick={() => setShowF((x) => !x)} className="rounded-full px-3 py-1.5 text-xs font-bold" style={{ background: "var(--app-card)", color: "var(--app-text)" }}>⚙️ تصفية وترتيب{fCount ? ` (${fCount})` : ""}</button>
          {showF && (
            <div className="mt-2 rounded-2xl p-3" style={{ background: "var(--app-card)" }}>
              <div className="mb-2 flex gap-2">
                <input className={`${inputCls} rounded-xl px-3 py-2`} style={{ ...inputStyle, background: "var(--app-bg)" }} inputMode="decimal" placeholder="أقل سعر $" value={filters.min} onChange={(e) => setFilters((f: any) => ({ ...f, min: e.target.value }))} />
                <input className={`${inputCls} rounded-xl px-3 py-2`} style={{ ...inputStyle, background: "var(--app-bg)" }} inputMode="decimal" placeholder="أعلى سعر $" value={filters.max} onChange={(e) => setFilters((f: any) => ({ ...f, max: e.target.value }))} />
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                <Btn small kind={filters.escrow ? "primary" : "soft"} onClick={() => setFilters((f: any) => ({ ...f, escrow: !f.escrow }))}>🔒 حجز آمن فقط</Btn>
                <Btn small kind={filters.shipping ? "primary" : "soft"} onClick={() => setFilters((f: any) => ({ ...f, shipping: !f.shipping }))}>🚚 يوجد شحن</Btn>
              </div>
              <Chips items={[{ id: "new", label: "الأحدث" }, { id: "price_asc", label: "الأرخص" }, { id: "price_desc", label: "الأغلى" }]} value={filters.sort} onChange={(v) => setFilters((f: any) => ({ ...f, sort: v }))} />
              {fCount > 0 && <button type="button" className="mt-2 text-xs font-bold" style={{ color: "var(--app-danger)" }} onClick={() => setFilters({ min: "", max: "", escrow: false, shipping: false, sort: "new" })}>مسح التصفية</button>}
            </div>
          )}
        </div>
      )}
      {items === null ? <Loading lines={4} /> : items.length === 0 ? (
        <Empty icon={tab === "sell" ? "📦" : "🛍"} title={q || fCount ? "لا توجد نتائج مطابقة" : tab === "sell" ? "لا توجد منتجات بعد" : "لا توجد طلبات شراء بعد"}
          sub={q || fCount ? "جرّب كلمة أخرى أو خفّف التصفية." : trader ? "كن أول من ينشر!" : undefined}
          action={trader ? <Btn onClick={() => push({ name: tab === "sell" ? "listing_form" : "wanted_form" })}>{tab === "sell" ? "➕ أضف منتجاً" : "➕ انشر طلب شراء"}</Btn> : undefined} />
      ) : tab === "sell" ? (
        <div className="grid grid-cols-2 gap-2.5">{items.map((l) => <ProductCard key={l.id} l={l} onClick={() => push({ name: "product", params: { id: l.id } })} />)}</div>
      ) : (
        <Section>{items.map((w) => <Row key={w.id} icon="🛍" title={w.title} sub={`${w.budget != null ? `الميزانية ${money(w.budget)} · ` : ""}${w.buyer || ""} · ${ago(w.at)}`} onClick={() => push({ name: "wanted", params: { id: w.id } })} />)}</Section>
      )}
      {more && <div className="mt-3"><Btn className="w-full" kind="soft" disabled={loadingMore} onClick={() => void load(items?.length || 0)}>{loadingMore ? "…" : "عرض المزيد"}</Btn></div>}
      {trader ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Btn onClick={() => push({ name: "listing_form" })}>💰 أمر بيع</Btn>
          <Btn kind="soft" onClick={() => push({ name: "wanted_form" })}>🛍 أمر شراء</Btn>
        </div>
      ) : <p className="mt-4 px-1 text-[11.5px] leading-5" style={{ color: "var(--app-hint)" }}>البيع ونشر طلبات الشراء متاحان لملفات «تاجر» فقط. يمكنك التصفح وتقديم العروض بحرية.</p>}
      </>)}
    </>
  );
}

function ShareRow({ url, text }: { url: string; text: string }) {
  const { open, copy } = useApp();
  return (
    <div className="grid grid-cols-2 gap-2">
      <Btn kind="soft" onClick={() => open(shareLink(url, text))}>📤 مشاركة</Btn>
      <Btn kind="soft" onClick={() => copy(url)}>🔗 نسخ الرابط</Btn>
    </div>
  );
}

function ReportBlock({ kind, target }: { kind: string; target: string }) {
  const { api, toast, confirm, back } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const send = async () => {
    const r = await api("report", { kind, target, reason });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    setOpen(false); setReason("");
    toast("✅ تم إرسال البلاغ للإدارة، شكراً لك.");
  };
  const block = async () => {
    if (!(await confirm("حظر هذا المستخدم؟ لن ترى منتجاته وطلباته ولن يرى منتجاتك."))) return;
    const r = await api("block", { target });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    toast("⛔ تم الحظر.");
    back();
  };
  return (
    <>
      <div className="mt-3 flex justify-center gap-4 text-xs font-bold" style={{ color: "var(--app-hint)" }}>
        <button type="button" onClick={() => setOpen((x) => !x)}>🚩 إبلاغ</button>
        <button type="button" onClick={block}>⛔ حظر</button>
      </div>
      {open && (
        <Section title="سبب البلاغ">
          <Field label="اكتب ما حدث باختصار"><textarea className={inputCls} style={inputStyle} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="p-3"><Btn className="w-full" kind="danger" disabled={!reason.trim()} onClick={send}>إرسال البلاغ</Btn></div>
        </Section>
      )}
    </>
  );
}

function OfferBox({ kind, id, suggested, cta, onDone }: { kind: "LISTING" | "WANTED"; id: string; suggested?: number | null; cta: string; onDone: () => void }) {
  const { api, toast, haptic } = useApp();
  const [price, setPrice] = useState(suggested != null ? String(suggested) : "");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const r = await api("offer_create", { kind, id, price });
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    haptic("success");
    toast("✅ تم إرسال عرضك، وسيصلك إشعار عند الرد.");
    onDone();
  };
  return (
    <Section title={cta} hint={kind === "LISTING" ? "يمكنك الطلب بالسعر المعروض أو اقتراح سعر آخر. يرد البائع بالقبول أو الرفض أو سعر مقابل." : "اقترح سعرك للمشتري، ويرد بالقبول أو الرفض أو سعر مقابل."}>
      <Field label="السعر بالدولار"><input className={inputCls} style={inputStyle} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="مثال: 25" /></Field>
      <div className="p-3"><Btn className="w-full" disabled={busy || !price} onClick={send}>{busy ? "…" : "📨 إرسال العرض"}</Btn></div>
    </Section>
  );
}

export function ProductScreen({ id }: { id: string }) {
  const { api, push, toast, confirm, back, replace } = useApp();
  const { init, reload } = useInit();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const load = useCallback(async () => { const r = await api("listing_get", { id }); if (r.ok) setD(r); else setErr(r.error || ""); }, [api, id]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <Empty icon="📦" title={err} action={<Btn onClick={() => replace({ name: "store" })}>تصفّح المتجر</Btn>} />;
  if (!d) return <Loading lines={5} />;
  const l = d.listing;
  const act = async (action: string, msg: string) => {
    const r = await api(action, { id: l.id });
    if (!r.ok) { toast(r.error || "", "err"); if (r.code === "balance") push({ name: "wallet" }); return; }
    toast(msg);
    if (action === "listing_delete") { back(); return; }
    await load(); void reload();
  };
  return (
    <>
      <div className="relative -mx-4 mb-3">
        <div className="flex snap-x snap-mandatory overflow-x-auto" onScroll={(e) => setIdx(Math.round(Math.abs(e.currentTarget.scrollLeft) / e.currentTarget.clientWidth))}>
          {(l.photos.length ? l.photos : [null]).map((f: string | null, i: number) => <div key={i} className="w-full shrink-0 snap-center"><Photo f={f} className="aspect-square w-full" alt={l.title} /></div>)}
        </div>
        {l.photos.length > 1 && <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1">{l.photos.map((_: string, i: number) => <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: i === idx ? "#fff" : "rgba(255,255,255,.5)" }} />)}</div>}
      </div>
      <div className="mb-1 flex flex-wrap items-center gap-1.5"><StatusPill s={l.status} />{l.featured && <Pill tone="warn">⭐ مميز</Pill>}</div>
      <h1 className="text-[20px] font-black leading-tight" style={{ color: "var(--app-text)" }}>{l.title}</h1>
      <div className="mt-1 text-[24px] font-black" style={{ color: "var(--app-accent)" }}>{money(l.price)}</div>
      <Section>
        <Row icon={l.escrow ? "🔒" : "⚠️"} title={l.escrow ? "دفع بحجز آمن" : "يلزم تفعيل الحجز الآمن"} sub={l.escrow ? `يُحجز كامل السعر من رصيد المشتري عند الاتفاق. عمولة المنصة ${d.listing.commissionPercent ?? 5}% تُخصم من مستحق البائع عند إتمام الصفقة؛ صافي البائع ${money(l.price * (1 - (d.listing.commissionPercent ?? 5) / 100))}.` : "هذا منتج قديم غير متاح للشراء حتى يعدّله البائع ويعيد نشره بالحجز الآمن."} />
        <Row icon={l.shipping ? "🚚" : "📍"} title={l.shipping ? "يوجد شحن" : "استلام يدوي من البائع"} />
        <Row icon="🏪" title={d.seller.name} sub={d.seller.place || undefined} onClick={d.seller.shop ? () => push({ name: "shop", params: { slug: d.seller.shop } }) : undefined} right={d.seller.shop ? <span className="text-xs font-bold" style={{ color: "var(--app-accent)" }}>المتجر ‹</span> : undefined} />
      </Section>
      {l.description && <Section title="الوصف"><p className="whitespace-pre-wrap px-4 py-3 text-[14px] leading-6" style={{ color: "var(--app-text)" }}>{l.description}</p></Section>}
      {l.mine ? (
        <>
          {l.featuredUntil && <p className="mb-2 px-1 text-xs font-bold" style={{ color: "#b45309" }}>⭐ مميز حتى {new Date(l.featuredUntil).toLocaleDateString("ar")}</p>}
          {(l.status === "ACTIVE" || l.status === "PAUSED") && (
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => push({ name: "listing_form", params: { id: l.id } })}>✏️ تعديل</Btn>
              <Btn kind="soft" onClick={() => act("listing_toggle", l.status === "ACTIVE" ? "⏸ تم إيقاف المنتج مؤقتاً." : "▶️ تم تفعيل المنتج.")}>{l.status === "ACTIVE" ? "⏸ إيقاف مؤقت" : "▶️ تفعيل"}</Btn>
              {l.status === "ACTIVE" && !l.featured && <Btn kind="soft" onClick={async () => { if (await confirm(`تمييز المنتج ${init.feature.days} أيام مقابل ${money(init.feature.price)} من رصيدك؟ يظهر أعلى نتائج البحث وفي متجرك.`)) void act("listing_feature", "⭐ تم تمييز المنتج."); }}>⭐ ميّز ({money(init.feature.price)})</Btn>}
              <Btn kind="danger" onClick={async () => { if (await confirm("حذف هذا المنتج نهائياً؟")) void act("listing_delete", "🗑 تم حذف المنتج."); }}>🗑 حذف</Btn>
            </div>
          )}
          {d.share && l.status === "ACTIVE" && <div className="mt-3"><ShareRow url={d.share} text={`🛒 ${l.title} — ${money(l.price)}`} /></div>}
        </>
      ) : l.status === "ACTIVE" ? (
        <>
          {d.myPendingOffers > 0 && <p className="mb-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: "#fef3c7", color: "#92400e" }}>⏳ لديك عرض قيد الانتظار على هذا المنتج. تابعه من «طلباتي».</p>}
          {l.escrow && <p className="mb-2 px-1 text-xs" style={{ color: "var(--app-hint)" }}>💰 رصيدك {money(init.balance)}{init.balance < l.price ? " — اشحن رصيدك قبل أن يقبل البائع حتى يُحجز المبلغ." : ""}</p>}
          <OfferBox kind="LISTING" id={l.id} suggested={l.price} cta="💬 اطلب المنتج أو اقترح سعراً" onDone={() => void load()} />
          {d.share && <ShareRow url={d.share} text={`🛒 ${l.title} — ${money(l.price)}`} />}
          {d.seller.id && <ReportBlock kind="listing" target={d.seller.id} />}
        </>
      ) : <Empty icon="✅" title="تم بيع هذا المنتج" />}
    </>
  );
}

export function WantedScreen({ id }: { id: string }) {
  const { api, push, toast, confirm, back, open, replace } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await api("wanted_get", { id }); if (r.ok) setD(r); else setErr(r.error || ""); }, [api, id]);
  useEffect(() => { void load(); }, [load]);
  if (err) return <Empty icon="🛍" title={err} action={<Btn onClick={() => replace({ name: "store", params: { tab: "buy" } })}>طلبات الشراء</Btn>} />;
  if (!d) return <Loading lines={4} />;
  const w = d.wanted;
  const act = async (action: string, msg: string) => {
    const r = await api(action, { id: w.id });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    toast(msg);
    if (action === "wanted_delete") back(); else void load();
  };
  return (
    <>
      <ScreenTitle icon="🛍" title={w.title} sub={`طلب شراء · ${ago(w.at)}`} />
      <div className="mb-2"><StatusPill s={w.status} /></div>
      <Section>
        <Row icon="💵" title={w.budget != null ? `الميزانية: ${money(w.budget)}` : "الميزانية: غير محددة"} />
        {!w.mine && <Row icon="👤" title={d.buyer.name} sub={d.buyer.place || undefined} />}
      </Section>
      {w.description && <Section title="التفاصيل"><p className="whitespace-pre-wrap px-4 py-3 text-[14px] leading-6" style={{ color: "var(--app-text)" }}>{w.description}</p></Section>}
      {w.mine ? (w.status === "ACTIVE" || w.status === "PAUSED") && (
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={() => push({ name: "wanted_form", params: { id: w.id } })}>✏️ تعديل</Btn>
          <Btn kind="soft" onClick={() => act("wanted_toggle", w.status === "ACTIVE" ? "⏸ تم إيقاف الطلب مؤقتاً." : "▶️ تم تفعيل الطلب.")}>{w.status === "ACTIVE" ? "⏸ إيقاف" : "▶️ تفعيل"}</Btn>
          <Btn kind="danger" className="col-span-2" onClick={async () => { if (await confirm("حذف هذا الطلب؟")) void act("wanted_delete", "🗑 تم حذف الطلب."); }}>🗑 حذف</Btn>
        </div>
      ) : (
        <>
          <OfferBox kind="WANTED" id={w.id} suggested={w.budget} cta="💬 لدي هذا المنتج — قدّم عرضك" onDone={() => void load()} />
          {d.buyer.id && <ReportBlock kind="wanted" target={d.buyer.id} />}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- ✏️ listing / wanted forms
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.86));
    return b && b.size < file.size ? b : file;
  } catch { return file; }
}
export function useUpload() {
  const { botId, tg } = useApp();
  return useCallback(async (file: File): Promise<{ ok: boolean; fileId?: string; error?: string }> => {
    const blob = await shrink(file);
    const fd = new FormData();
    fd.set("initData", tg?.initData || "");
    fd.set("file", new File([blob], "photo.jpg", { type: blob.type || "image/jpeg" }));
    const r = await fetch(`/api/bot-app/${encodeURIComponent(botId)}/upload`, { method: "POST", body: fd }).then((x) => x.json()).catch(() => null);
    return r?.ok ? { ok: true, fileId: r.fileId } : { ok: false, error: r?.error || "تعذّر رفع الصورة." };
  }, [botId, tg]);
}

export function ListingForm({ id }: { id?: string }) {
  const { api, toast, back, replace, setDirty } = useApp();
  const { reload, init } = useInit();
  const upload = useUpload();
  const [f, setF] = useState<any>(id ? null : { title: "", description: "", price: "", photoFileIds: [], deliveryMethod: "", paymentMethod: "ESCROW" });
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!id) return;
    void api("listing_get", { id }).then((r: any) => {
      if (!r.ok || !r.listing.mine) { toast(r.error || "غير مسموح.", "err"); back(); return; }
      const l = r.listing;
      setF({ title: l.title, description: l.description, price: String(l.price), photoFileIds: l.photos, deliveryMethod: l.shipping ? "SHIPPING" : "PICKUP_MANUAL", paymentMethod: "ESCROW" });
    });
  }, [api, id, toast, back]);
  if (!f) return <Loading lines={5} />;
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setDirty(true); };
  const pick = async (files: FileList | null) => {
    const list = Array.from(files || []).slice(0, 5 - f.photoFileIds.length);
    for (const file of list) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast("أرسل صورة JPG أو PNG أو WEBP.", "err"); continue; }
      setUploading((n) => n + 1);
      const r = await upload(file);
      setUploading((n) => n - 1);
      if (!r.ok || !r.fileId) { toast(r.error || "", "err"); continue; }
      const fid = r.fileId;
      setPreviews((p) => ({ ...p, [fid]: URL.createObjectURL(file) }));
      setF((x: any) => ({ ...x, photoFileIds: [...x.photoFileIds, fid].slice(0, 5) }));
      setDirty(true);
    }
    if (fileRef.current) fileRef.current.value = "";
  };
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await api<{ id: string; created: boolean }>("listing_save", { id: id || null, listing: f });
    setBusy(false);
    if (!r.ok) { setErr(r.error || ""); toast(r.error || "", "err"); return; }
    setDirty(false);
    toast(r.created ? "✅ تم نشر منتجك في المتجر." : "✅ تم حفظ التعديلات.");
    void reload();
    replace({ name: "product", params: { id: r.id } });
  };
  return (
    <>
      <ScreenTitle icon={id ? "✏️" : "💰"} title={id ? "تعديل المنتج" : "أمر بيع جديد"} sub="منتج واضح بصور جيدة وسعر محدد يُباع أسرع." />
      <Section title="الصور (حتى 5)" hint="أول صورة هي صورة الغلاف.">
        <div className="flex flex-wrap gap-2 p-3">
          {f.photoFileIds.map((fid: string, i: number) => (
            <div key={fid} className="relative h-20 w-20 overflow-hidden rounded-xl">
              {previews[fid] ? <img src={previews[fid]} alt="" className="h-full w-full object-cover" /> : <Photo f={fid} className="h-full w-full" />}
              <button type="button" aria-label="حذف الصورة" onClick={() => set("photoFileIds", f.photoFileIds.filter((x: string) => x !== fid))} className="absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-xs text-white">✕</button>
              {i === 0 && <span className="absolute inset-x-0 bottom-0 bg-black/50 text-center text-[10px] text-white">الغلاف</span>}
            </div>
          ))}
          {Array.from({ length: uploading }).map((_, i) => <div key={`u${i}`} className="h-20 w-20 animate-pulse rounded-xl" style={{ background: "var(--app-bg)" }} />)}
          {f.photoFileIds.length + uploading < 5 && (
            <button type="button" onClick={() => fileRef.current?.click()} className="grid h-20 w-20 place-items-center rounded-xl border-2 border-dashed text-2xl" style={{ borderColor: "var(--app-hint)", color: "var(--app-hint)" }}>＋</button>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => void pick(e.target.files)} />
        </div>
      </Section>
      <Section title="المنتج">
        <Field label="العنوان"><input className={inputCls} style={inputStyle} value={f.title} maxLength={100} onChange={(e) => set("title", e.target.value)} placeholder="مثال: هاتف سامسونج A54 مستعمل" /></Field>
        <Field label="الوصف"><textarea className={inputCls} style={inputStyle} rows={4} value={f.description} maxLength={1500} onChange={(e) => set("description", e.target.value)} placeholder="الحالة، المواصفات، ما يشمله…" /></Field>
        <Field label="السعر بالدولار"><input className={inputCls} style={inputStyle} inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="مثال: 120" /></Field>
      </Section>
      <Section title="طريقة التسليم">
        <div className="p-3"><Chips items={[{ id: "PICKUP_MANUAL", label: "📍 استلام يدوي" }, { id: "SHIPPING", label: "🚚 يوجد شحن" }]} value={f.deliveryMethod} onChange={(v) => set("deliveryMethod", v)} /></div>
      </Section>
      <Section title="الحجز الآمن والعمولة" hint={`الحجز الآمن إلزامي لحماية الطرفين. يُحجز كامل السعر حتى تأكيد الاستلام أو انقضاء 7 أيام دون نزاع. عمولة المنصة ${init.commissionPercent}% من البائع فقط؛ تقدير صافي البائع عند بيع هذا المنتج ${money((Number(f.price) || 0) * (1 - init.commissionPercent / 100))}.`}>
        <Row icon="🔒" title="الحجز الآمن مفعّل تلقائياً" sub={`لا نكشف بيانات التواصل قبل إتمام الحجز. عمولة ${init.commissionPercent}% تُحتسب عند تحرير المبلغ.`} />
      </Section>
      {err && <p className="mb-2 px-1 text-sm font-bold" style={{ color: "var(--app-danger)" }}>{err}</p>}
      <MainAction text={id ? "💾 حفظ التعديلات" : "📢 نشر المنتج"} onClick={save} busy={busy} disabled={uploading > 0} />
    </>
  );
}

export function WantedForm({ id }: { id?: string }) {
  const { api, toast, back, replace, setDirty } = useApp();
  const [f, setF] = useState<any>(id ? null : { title: "", description: "", budget: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    void api("wanted_get", { id }).then((r: any) => {
      if (!r.ok || !r.wanted.mine) { toast(r.error || "غير مسموح.", "err"); back(); return; }
      setF({ title: r.wanted.title, description: r.wanted.description, budget: r.wanted.budget != null ? String(r.wanted.budget) : "" });
    });
  }, [api, id, toast, back]);
  if (!f) return <Loading lines={3} />;
  const set = (k: string, v: any) => { setF((x: any) => ({ ...x, [k]: v })); setDirty(true); };
  const save = async () => {
    setBusy(true); setErr(null);
    const r = await api<{ id: string; created: boolean }>("wanted_save", { id: id || null, wanted: f });
    setBusy(false);
    if (!r.ok) { setErr(r.error || ""); return; }
    setDirty(false);
    toast(r.created ? "✅ تم نشر طلب الشراء، وستصلك عروض البائعين." : "✅ تم حفظ التعديلات.");
    replace({ name: "wanted", params: { id: r.id } });
  };
  return (
    <>
      <ScreenTitle icon="🛍" title={id ? "تعديل طلب الشراء" : "أمر شراء جديد"} sub="اكتب ما تبحث عنه، ويرسل لك البائعون عروضهم." />
      <Section>
        <Field label="ماذا تريد أن تشتري؟"><input className={inputCls} style={inputStyle} value={f.title} maxLength={100} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="التفاصيل (اختياري)"><textarea className={inputCls} style={inputStyle} rows={3} value={f.description} maxLength={1500} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label="الميزانية بالدولار (اختياري)"><input className={inputCls} style={inputStyle} inputMode="decimal" value={f.budget} onChange={(e) => set("budget", e.target.value)} /></Field>
      </Section>
      {err && <p className="mb-2 px-1 text-sm font-bold" style={{ color: "var(--app-danger)" }}>{err}</p>}
      <MainAction text={id ? "💾 حفظ" : "📢 نشر الطلب"} onClick={save} busy={busy} />
    </>
  );
}

// ---------------------------------------------------------------- 🛍 seller shops
export function ShopsScreen() {
  const { api, push, toast } = useApp();
  const [q, setQ] = useState("");
  const [shops, setShops] = useState<any[] | null>(null);
  const qRef = useRef(q); qRef.current = q;
  const load = useCallback(async () => {
    setShops(null);
    const r = await api<{ shops: any[] }>("shops", { q: qRef.current });
    if (!r.ok) { toast(r.error || "", "err"); setShops([]); return; }
    setShops(r.shops);
  }, [api, toast]);
  useEffect(() => { void load(); }, [load]);
  return (
    <>
      <ScreenTitle icon="🛍" title="متاجر البائعين" sub="كل متجر يعرض منتجات بائع واحد. اطلب مباشرة أو تفاوض على السعر." />
      <SearchBox value={q} onChange={setQ} onSubmit={() => void load()} placeholder="ابحث باسم المتجر أو المدينة…" />
      <button type="button" onClick={() => push({ name: "myshop" })} className="mb-3 flex w-full items-center gap-3 rounded-2xl p-4 text-start" style={{ background: "linear-gradient(135deg,#d97706,#b45309)", color: "#fff" }}>
        <span className="text-2xl">🏪</span><span className="flex-1"><b className="block">متجري</b><span className="text-xs opacity-90">افتح متجرك، أضف منتجاتك بالصور، وشارك رابطه</span></span><span>‹</span>
      </button>
      {shops === null ? <Loading lines={4} /> : shops.length === 0 ? <Empty icon="🏪" title={q ? "لا توجد متاجر مطابقة" : "لا توجد متاجر بعد"} sub="يظهر المتجر تلقائياً عندما ينشر البائع أول منتج." /> : (
        <Section>{shops.map((s) => <Row key={s.slug} icon="🏪" title={<>{s.name}{s.mine && <span className="ms-1 text-xs" style={{ color: "var(--app-accent)" }}>(متجري)</span>}</>} sub={`${s.count} منتج${s.place ? ` · ${s.place}` : ""}`} onClick={() => push({ name: "shop", params: { slug: s.slug } })} />)}</Section>
      )}
    </>
  );
}

export function ShopScreen({ slug }: { slug: string }) {
  const { api, push, replace } = useApp();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { void api("shop", { slug }).then((r: any) => (r.ok ? setD(r) : setErr(r.error || ""))); }, [api, slug]);
  if (err) return <Empty icon="🏪" title={err} action={<Btn onClick={() => replace({ name: "shops" })}>كل المتاجر</Btn>} />;
  if (!d) return <Loading lines={5} />;
  const items = d.items.filter((l: any) => !q || l.title.toLowerCase().includes(q.toLowerCase()) || l.description.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="mb-3 rounded-3xl p-5" style={{ background: "linear-gradient(135deg,#d97706,#92400e)", color: "#fff" }}>
        <div className="text-3xl">🏪</div>
        <div className="mt-1 text-[22px] font-black">{d.shop.name}</div>
        <div className="text-[12.5px] opacity-90">{d.shop.place ? `📍 ${d.shop.place} · ` : ""}{d.items.length} منتج</div>
      </div>
      {d.shop.share && <div className="mb-3"><ShareRow url={d.shop.share} text={`🏪 متجر ${d.shop.name} — ${d.items.length} منتج`} /></div>}
      {d.items.length > 4 && <SearchBox value={q} onChange={setQ} onSubmit={() => {}} placeholder="ابحث داخل المتجر…" />}
      {items.length === 0 ? <Empty icon="📦" title={q ? "لا توجد نتائج" : "لا توجد منتجات نشطة حالياً"} action={d.shop.mine ? <Btn onClick={() => push({ name: "listing_form" })}>➕ أضف منتجاً</Btn> : undefined} /> : (
        <div className="grid grid-cols-2 gap-2.5">{items.map((l: any) => <ProductCard key={l.id} l={l} onClick={() => push({ name: "product", params: { id: l.id } })} />)}</div>
      )}
    </>
  );
}

export function MyShopScreen({ embedded }: { embedded?: boolean } = {}) {
  const { api, push, toast } = useApp();
  const { init } = useInit();
  const [s, setS] = useState<any>(null);
  const [mine, setMine] = useState<any>(null);
  const [tab, setTab] = useState<"sell" | "buy">("sell");
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api("my_shop"), api("my_items")]);
    if (!a.ok) toast(a.error || "", "err");
    setS(a.ok ? a : { slug: null, count: 0, trader: false });
    setMine(b.ok ? b : { listings: [], wanted: [] });
  }, [api, toast]);
  useEffect(() => { void load(); }, [load]);
  if (!s || !mine) return <Loading lines={5} />;
  const trader = init.profile?.roleType === "TRADER";
  return (
    <>
      {!embedded && <ScreenTitle icon="🏪" title="متجري" sub="متجرك يجمع كل منتجاتك النشطة في رابط واحد تشاركه في أي مكان." />}
      {!trader ? (
        <Empty icon="🛒" title="المتجر متاح لملفات «تاجر»" sub="غيّر نوع ملفك إلى «تاجر» لتفتح متجرك وتبيع منتجاتك." action={<Btn onClick={() => push({ name: "profile_edit" })}>✏️ تعديل الملف</Btn>} />
      ) : s.slug ? (
        <Section title={`🏪 متجرك جاهز · ${s.count} منتج نشط`} hint="من يفتح الرابط يرى منتجاتك ويطلب مباشرة.">
          <Copyable value={s.deep} />
          <div className="p-3"><ShareRow url={s.deep} text={s.shareText} /></div>
          <div className="px-3 pb-3"><Btn className="w-full" kind="soft" onClick={() => push({ name: "shop", params: { slug: s.slug } })}>👁 عرض متجري كما يراه الزبائن</Btn></div>
        </Section>
      ) : (
        <Empty icon="🏪" title="افتح متجرك بأول منتج" sub="أضف منتجاً واحداً على الأقل ليصبح متجرك جاهزاً برابط خاص تشاركه." action={<Btn onClick={() => push({ name: "listing_form" })}>➕ أضف أول منتج</Btn>} />
      )}
      {trader && (
        <>
          <div className="mb-3 mt-2 flex items-center justify-between">
            <Chips items={[{ id: "sell", label: `💰 منتجاتي (${mine.listings.length})` }, { id: "buy", label: `🛍 طلبات الشراء (${mine.wanted.length})` }]} value={tab} onChange={setTab} />
          </div>
          {tab === "sell" ? (
            mine.listings.length === 0 ? <Empty icon="📦" title="لا توجد منتجات بعد" /> : (
              <div className="grid grid-cols-2 gap-2.5">{mine.listings.map((l: any) => <ProductCard key={l.id} l={l} onClick={() => push({ name: "product", params: { id: l.id } })} />)}</div>
            )
          ) : mine.wanted.length === 0 ? <Empty icon="🛍" title="لا توجد طلبات شراء" /> : (
            <Section>{mine.wanted.map((w: any) => <Row key={w.id} icon="🛍" title={w.title} sub={w.budget != null ? `الميزانية ${money(w.budget)}` : undefined} right={<StatusPill s={w.status} />} onClick={() => push({ name: "wanted", params: { id: w.id } })} />)}</Section>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Btn onClick={() => push({ name: "listing_form" })}>➕ منتج جديد</Btn>
            <Btn kind="soft" onClick={() => push({ name: "wanted_form" })}>➕ طلب شراء</Btn>
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 📂 my orders: offers, purchases, sales
export function OrdersScreen({ tab: initialTab, embedded }: { tab?: string; embedded?: boolean }) {
  const { api, toast } = useApp();
  const [tab, setTab] = useState<"offers" | "buy" | "sell">(initialTab === "buy" || initialTab === "sell" ? initialTab : "offers");
  const [offers, setOffers] = useState<any[] | null>(null);
  const [orders, setOrders] = useState<any[] | null>(null);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api<{ offers: any[] }>("offers"), api<{ orders: any[] }>("orders")]);
    if (!a.ok) toast(a.error || "", "err");
    setOffers(a.ok ? a.offers : []);
    setOrders(b.ok ? b.orders : []);
  }, [api, toast]);
  useEffect(() => { void load(); }, [load]);
  const turn = offers?.filter((o) => o.myTurn).length || 0;
  return (
    <>
      {!embedded && <ScreenTitle icon="📂" title="طلباتي" sub="عروض الأسعار، مشترياتك ومبيعاتك وحالة كل طلب." />}
      <div className="mb-3"><Chips items={[{ id: "offers", label: `💬 العروض${turn ? ` (${turn})` : ""}` }, { id: "buy", label: "🛍 مشترياتي" }, { id: "sell", label: "💰 مبيعاتي" }]} value={tab} onChange={setTab} /></div>
      {offers === null || orders === null ? <Loading lines={4} /> : tab === "offers" ? <OffersList offers={offers} reload={load} /> : <OrdersList orders={orders.filter((o) => o.role === (tab === "buy" ? "buyer" : "seller"))} buyer={tab === "buy"} reload={load} />}
    </>
  );
}

function OffersList({ offers, reload }: { offers: any[]; reload: () => Promise<void> }) {
  const { api, toast, confirm, push, haptic } = useApp();
  const { init, reload: reloadInit } = useInit();
  const [counter, setCounter] = useState<{ id: string; price: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const turn = offers.filter((o) => o.myTurn);
  const waiting = offers.filter((o) => o.status === "PENDING" && !o.myTurn);
  const closed = offers.filter((o) => o.status !== "PENDING").slice(0, 20);
  const accept = async (o: any) => {
    const holds = o.escrow && o.role === "buyer";
    const msg = o.escrow ? (o.role === "buyer" ? `قبول ${money(o.price)}؟ سيُحجز المبلغ من رصيدك (${money(init.balance)}) حتى تؤكد الاستلام.` : `قبول ${money(o.price)}؟ سيُحجز المبلغ من رصيد المشتري، ويصلك بعد تأكيده الاستلام.`) : `قبول ${money(o.price)}؟ ستتفقان على الدفع والتسليم مباشرة.`;
    if (!(await confirm(msg))) return;
    setBusy(o.id);
    const r = await api<{ mode: string }>("offer_accept", { id: o.id });
    setBusy(null);
    if (!r.ok) { toast(r.error || "", "err"); if (r.code === "balance" && holds) push({ name: "wallet" }); await reload(); return; }
    haptic("success");
    toast(r.mode === "escrow" ? "✅ تم الاتفاق وحجز المبلغ. تابع الطلب في «مشترياتي/مبيعاتي»." : "✅ تم قبول العرض. تواصلا لإتمام الدفع والتسليم.");
    await reload(); void reloadInit();
  };
  const reject = async (o: any) => {
    if (!(await confirm("رفض هذا العرض؟"))) return;
    const r = await api("offer_reject", { id: o.id });
    if (!r.ok) toast(r.error || "", "err"); else toast("❌ تم رفض العرض.");
    await reload(); void reloadInit();
  };
  const sendCounter = async () => {
    if (!counter) return;
    const r = await api("offer_counter", { id: counter.id, price: counter.price });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    toast("✅ تم إرسال سعرك المقابل.");
    setCounter(null);
    await reload(); void reloadInit();
  };
  const card = (o: any, actions: boolean) => (
    <div key={o.id} className="border-b p-3 last:border-0" style={{ borderColor: "color-mix(in srgb, var(--app-hint) 18%, transparent)" }}>
      <button type="button" className="flex w-full items-center gap-3 text-start" onClick={() => push({ name: o.kind === "LISTING" ? "product" : "wanted", params: { id: o.targetId } })}>
        <Photo f={o.photo} className="h-14 w-14 shrink-0 rounded-xl" />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px]" style={{ color: "var(--app-text)" }}>{o.title}</b>
          <span className="block text-xs" style={{ color: "var(--app-hint)" }}>{o.role === "buyer" ? "أنت المشتري" : "أنت البائع"}{o.other ? ` · ${o.other}` : ""} · {ago(o.at)}</span>
          <span className="mt-0.5 block text-[13px] font-black" style={{ color: "var(--app-accent)" }}>{money(o.price)}{o.asked != null && o.asked !== o.price ? <span className="ms-2 text-[11px] font-normal line-through" style={{ color: "var(--app-hint)" }}>{money(o.asked)}</span> : null}</span>
        </span>
        {!actions && <StatusPill s={o.status} />}
      </button>
      {actions && (
        counter?.id === o.id ? (
          <div className="mt-2 flex gap-2">
            <input autoFocus className={`${inputCls} rounded-xl px-3 py-2`} style={{ ...inputStyle, background: "var(--app-bg)" }} inputMode="decimal" placeholder="سعرك المقابل $" value={counter?.price ?? ""} onChange={(e) => setCounter({ id: o.id, price: e.target.value })} />
            <Btn small disabled={!counter?.price} onClick={sendCounter}>إرسال</Btn>
            <Btn small kind="ghost" onClick={() => setCounter(null)}>إلغاء</Btn>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Btn small disabled={busy === o.id} onClick={() => accept(o)}>✅ قبول</Btn>
            <Btn small kind="soft" onClick={() => setCounter({ id: o.id, price: "" })}>💬 سعر آخر</Btn>
            <Btn small kind="danger" onClick={() => reject(o)}>❌ رفض</Btn>
          </div>
        )
      )}
    </div>
  );
  if (!offers.length) return <Empty icon="💬" title="لا توجد عروض بعد" sub="عند طلب منتج أو تقديم عرض على طلب شراء يظهر هنا، ويصلك إشعار في المحادثة عند كل رد." />;
  return (
    <>
      {turn.length > 0 && <Section title={`🔔 بانتظار ردّك (${turn.length})`}>{turn.map((o) => card(o, true))}</Section>}
      {waiting.length > 0 && <Section title={`⏳ بانتظار الطرف الآخر (${waiting.length})`}>{waiting.map((o) => card(o, false))}</Section>}
      {closed.length > 0 && <Section title="السابقة">{closed.map((o) => card(o, false))}</Section>}
    </>
  );
}

function OrdersList({ orders, buyer, reload }: { orders: any[]; buyer: boolean; reload: () => Promise<void> }) {
  const { push } = useApp();
  if (!orders.length) return <Empty icon={buyer ? "🛍" : "💰"} title={buyer ? "لا توجد مشتريات بعد" : "لا توجد مبيعات بعد"} sub={buyer ? "عند الاتفاق على منتج بالحجز الآمن يظهر طلبك هنا." : "عند قبول عرض على أحد منتجاتك يظهر الطلب هنا."} action={<Btn onClick={() => push({ name: buyer ? "store" : "myshop" })}>{buyer ? "تصفّح المتجر" : "متجري"}</Btn>} />;
  return <>{orders.map((o) => <OrderCard key={o.id} o={o} reload={reload} />)}</>;
}

function OrderCard({ o, reload }: { o: any; reload: () => Promise<void> }) {
  const { api, toast, confirm, open, haptic } = useApp();
  const { reload: reloadInit } = useInit();
  const upload = useUpload();
  const [dispute, setDispute] = useState(false);
  const [statement, setStatement] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const daysLeft = o.escrowedAt ? Math.max(0, 7 - Math.floor((Date.now() - new Date(o.escrowedAt).getTime()) / 86_400_000)) : null;
  const received = async () => {
    if (!(await confirm(`تأكيد الاستلام؟ سيُحوَّل ${money(o.amount)} للبائع ولا يمكن التراجع.`))) return;
    setBusy(true);
    const r = await api("order_received", { id: o.id });
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    haptic("success");
    toast("✅ تم تأكيد الاستلام وتحويل المبلغ للبائع.");
    await reload(); void reloadInit();
  };
  const sendDispute = async () => {
    setBusy(true);
    const r = await api<{ bothIn: boolean }>("order_dispute", { id: o.id, statement, photo });
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    toast(r.bothIn ? "✅ تم استلام إفادتك. وصلت إفادتا الطرفين للإدارة للقرار." : "✅ تم استلام إفادتك. بانتظار إفادة الطرف الآخر ثم تقرر الإدارة.");
    setDispute(false); setStatement(""); setPhoto(null);
    await reload();
  };
  const pickPhoto = async (fl: FileList | null) => {
    const file = fl?.[0];
    if (!file) return;
    const r = await upload(file);
    if (!r.ok || !r.fileId) { toast(r.error || "", "err"); return; }
    setPhoto(r.fileId);
  };
  const d = o.dispute;
  const disputeOpen = d && d.status !== "RESOLVED";
  return (
    <div className="mb-3 overflow-hidden rounded-2xl" style={{ background: "var(--app-card)" }}>
      <div className="flex items-center gap-3 p-3">
        <Photo f={o.photo} className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[14px]" style={{ color: "var(--app-text)" }}>{o.title}</b>
          <span className="block text-xs" style={{ color: "var(--app-hint)" }}>#{o.short} · {ago(o.at)}{o.shipping ? " · 🚚 شحن" : " · 📍 استلام"}</span>
          <span className="block text-[14px] font-black" style={{ color: "var(--app-accent)" }}>{money(o.amount)}</span>
          <span className="block text-[10.5px]" style={{ color: "var(--app-hint)" }}>{o.status === "REFUNDED" ? `المبلغ المسترد للمشتري ${money(o.amount)}` : `عمولة المنصة ${money(o.platformFee)} · صافي البائع ${money(o.sellerNet)}`}</span>
        </div>
        <StatusPill s={o.status} />
      </div>
      {/* status timeline: agreed → held → delivered/released (or refunded) */}
      <div className="flex items-center gap-1 px-3 pb-2 text-[10.5px] font-bold" style={{ color: "var(--app-hint)" }}>
        <span style={{ color: "#059669" }}>● تم الاتفاق</span><span>—</span>
        <span style={{ color: "#059669" }}>● المبلغ محجوز</span><span>—</span>
        <span style={{ color: o.status === "RELEASED" ? "#059669" : o.status === "REFUNDED" ? "#dc2626" : undefined }}>● {o.status === "REFUNDED" ? "استُرد للمشتري" : "استُلم وحُوِّل للبائع"}</span>
      </div>
      {o.status === "ESCROWED" && (
        <div className="border-t px-3 py-2.5 text-[12.5px] leading-5" style={{ borderColor: "color-mix(in srgb, var(--app-hint) 18%, transparent)", color: "var(--app-text)" }}>
          {disputeOpen ? (
            <p>⚠️ يوجد نزاع مفتوح على هذا الطلب. {d.mine ? "إفادتك وصلت، بانتظار قرار الإدارة." : "أرسل إفادتك ليُحسم النزاع."}</p>
          ) : o.role === "buyer" ? (
            <p>🔒 المبلغ محجوز. أكّد الاستلام عند وصول المنتج سليماً. {daysLeft !== null ? `يُحوَّل تلقائياً للبائع بعد ${daysLeft} يوم إن لم يُفتح نزاع.` : ""}</p>
          ) : (
            <p>🔒 مبلغ المشتري محجوز. سلّم المنتج، ويصلك المبلغ عند تأكيده الاستلام{daysLeft !== null ? ` أو تلقائياً بعد ${daysLeft} يوم بلا نزاع` : ""}.</p>
          )}
          {o.other && <button type="button" className="mt-1 text-xs font-bold" style={{ color: "var(--app-accent)" }} onClick={() => o.other.contact && open(o.other.contact)}>💬 تواصل مع {o.role === "buyer" ? "البائع" : "المشتري"}: {o.other.name}</button>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {o.role === "buyer" && !disputeOpen && <Btn small disabled={busy} onClick={received}>📦 تم الاستلام</Btn>}
            {(!disputeOpen || !d.mine) && <Btn small kind="soft" className={o.role === "buyer" && !disputeOpen ? "" : "col-span-2"} onClick={() => setDispute((x) => !x)}>{disputeOpen ? "📝 أرسل إفادتك" : "⚠️ فتح نزاع"}</Btn>}
          </div>
          {dispute && (
            <div className="mt-2 rounded-xl p-2" style={{ background: "var(--app-bg)" }}>
              <textarea className={`${inputCls} rounded-lg p-2`} style={inputStyle} rows={3} placeholder="اكتب ما حدث بالتفصيل…" value={statement} onChange={(e) => setStatement(e.target.value)} />
              <div className="mt-2 flex items-center gap-2">
                <Btn small kind="ghost" onClick={() => fileRef.current?.click()}>{photo ? "✅ أُرفقت صورة" : "📷 إرفاق دليل (اختياري)"}</Btn>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void pickPhoto(e.target.files)} />
                <span className="flex-1" />
                <Btn small kind="danger" disabled={busy || !statement.trim()} onClick={sendDispute}>إرسال</Btn>
              </div>
            </div>
          )}
        </div>
      )}
      {d && d.status === "RESOLVED" && <div className="border-t px-3 py-2 text-xs" style={{ borderColor: "color-mix(in srgb, var(--app-hint) 18%, transparent)", color: "var(--app-hint)" }}>⚖️ حُسم النزاع: {d.resolution === "REFUNDED_TO_BUYER" ? "استرداد للمشتري" : "تحويل للبائع"}</div>}
    </div>
  );
}
