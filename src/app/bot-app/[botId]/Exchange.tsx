"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// 📣 Channels & groups exchange inside the bot's Mini App: ownership proof, ad orders, seller delivery
// (list and verify a channel, deliver posts, verified badge). The platform's 15% commission and the badge price are 100% platform.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Btn, Chips, Copyable, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, inputCls, inputStyle, useApp, useInnerBack, useStore } from "./ui";

type Listing = { username: string; title: string; price: number; status: string; verifiedUntil: string | null; subscribers: number | null; medianViews: number; reachPct: number | null; grade: string; postsSampled: number; auditedAt: string | null };
type Rules = { commissionPct: number; minPrice: number; maxPrice: number; badgePrice: number };
type Deal = { code: string; kind: string; channel: string; price: number; status: string; postLink: string | null; paymentReference?: string | null; settlementReference?: string | null; createdAt: string };
type View = { v: "browse" } | { v: "channel"; l: Listing } | { v: "pay"; code: string; price: number; channel: string; kind: "AD" | "BADGE" } | { v: "deal"; code: string } | { v: "sell" } | { v: "manage"; token: string };

const DEAL_STATUS: Record<string, [string, "ok" | "warn" | "bad" | "neutral" | "info"]> = {
  PENDING_PAYMENT: ["بانتظار الدفع", "warn"], PAID: ["مدفوع · بانتظار النشر", "info"], POSTED: ["نُشر · قيد التحقق", "info"], VERIFIED: ["تم التحقق من النشر", "ok"],
  RELEASED: ["مكتملة", "ok"], REFUNDED: ["أُعيد المبلغ", "neutral"], CANCELLED: ["ملغاة", "neutral"],
};
const GRADE: Record<string, [string, "ok" | "warn" | "bad" | "neutral" | "info"]> = { excellent: ["تفاعل ممتاز", "ok"], good: ["تفاعل جيد", "info"], weak: ["تفاعل ضعيف", "warn"], suspicious: ["تفاعل مشكوك", "bad"], unknown: ["", "neutral"] };
const k = (n: number | null) => (n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
const usd = (n: number) => `$${(Number(n) || 0).toFixed(Number(n) % 1 ? 2 : 0)}`;

function useList(key: string) {
  const store = useStore();
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => { void store.get(key).then((v) => { try { setItems(v ? JSON.parse(v) : []); } catch { setItems([]); } }); }, [store, key]);
  const add = useCallback((x: string) => setItems((cur) => { const next = [x, ...cur.filter((y) => y !== x)].slice(0, 20); void store.set(key, JSON.stringify(next)); return next; }), [store, key]);
  return { items, add };
}

export default function ExchangeSection({ username }: { username: string }) {
  const { api } = useApp();
  const [tab, setTab] = useState<"buy" | "mine" | "sell" | "assets">("buy");
  const [view, setView] = useState<View>({ v: "browse" });
  const [data, setData] = useState<{ listings: Listing[]; rules: Rules; myDeals?: string[]; myChannels?: string[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const deals = useList("ex_deals");
  const channels = useList("ex_channels");
  const load = useCallback(async () => { const r = await api<{ listings: Listing[]; rules: Rules; myDeals: string[]; myChannels: string[] }>("ex_list"); if (r.ok) { setData(r); setLoadError(null); } else setLoadError(r.error || "تعذّر تحديث بيانات البورصة."); }, [api]);
  useEffect(() => { void load(); }, [load]);
  useInnerBack(view.v !== "browse", () => setView({ v: "browse" }));

  if (!data) return <><ScreenTitle icon="📣" title="بورصة القنوات والجروبات" />{loadError ? <Section><Empty icon="⚠️" title="تعذّر تحميل البورصة" sub={loadError} action={<Btn onClick={() => void load()}>↻ إعادة المحاولة</Btn>} /></Section> : <Loading />}</>;
  const dealCodes = [...new Set([...(data.myDeals || []), ...deals.items])];
  const channelTokens = [...new Set([...(data.myChannels || []), ...channels.items])];
  if (view.v === "channel") return <Channel l={view.l} rules={data.rules} username={username} onDeal={(code, price) => { deals.add(code); setView({ v: "pay", code, price, channel: view.l.username, kind: "AD" }); }} />;
  if (view.v === "pay") return <Pay code={view.code} price={view.price} channel={view.channel} kind={view.kind} onDone={() => { setTab(view.kind === "AD" ? "mine" : "sell"); setView(view.kind === "AD" ? { v: "deal", code: view.code } : { v: "browse" }); }} />;
  if (view.v === "deal") return <DealView code={view.code} onPay={(d) => setView({ v: "pay", code: d.code, price: d.price, channel: d.channel, kind: d.kind === "BADGE" ? "BADGE" : "AD" })} />;
  if (view.v === "sell") return <Sell rules={data.rules} username={username} onListed={(token) => { channels.add(token); setView({ v: "manage", token }); }} />;
  if (view.v === "manage") return <Manage token={view.token} rules={data.rules} onBadge={(code, price, channel) => { deals.add(code); setView({ v: "pay", code, price, channel, kind: "BADGE" }); }} />;

  return (
    <>
      <div className="mb-4 overflow-hidden rounded-3xl p-5" style={{ background: "linear-gradient(135deg,#7c3aed,#4c1d95)", color: "#fff" }}>
        <div className="text-[13px] font-bold opacity-85">📣 بورصة القنوات والجروبات</div>
        <div className="mt-1 text-[21px] font-black leading-snug">اشترِ مساحة إعلانية أو حوّل قناتك إلى مصدر دخل</div>
        <p className="mt-1 text-[12.5px] leading-5 opacity-85">يُطلب من مالك القناة إثبات التحكم بها. مؤشرات الجمهور مأخوذة من معاينة تيليجرام العامة لعينة من المنشورات، وهي تقديرات لا تضمن الوصول أو المبيعات. تتبع الدفع والنشر والتسوية من شاشة واحدة.</p>
      </div>
      {loadError && <Section><Empty icon="⚠️" title="تعذّر تحديث بعض البيانات" sub={loadError} action={<Btn small kind="ghost" onClick={() => void load()}>↻ إعادة المحاولة</Btn>} /></Section>}
      <div className="mb-4"><Chips items={[{ id: "buy", label: "🛒 اشترِ إعلاناً" }, { id: "mine", label: `🧾 طلباتي${dealCodes.length ? ` (${dealCodes.length})` : ""}` }, { id: "sell", label: "💼 بِع إعلانات قناتك" }, { id: "assets", label: "🏪 بيع وشراء الأصول" }]} value={tab} onChange={(v) => setTab(v as any)} /></div>
      {tab === "buy" && <Browse data={data} onOpen={(l) => setView({ v: "channel", l })} onReload={load} />}
      {tab === "mine" && <MyDeals codes={dealCodes} onOpen={(code) => setView({ v: "deal", code })} onBrowse={() => setTab("buy")} />}
      {tab === "sell" && <SellHome rules={data.rules} tokens={channelTokens} onNew={() => setView({ v: "sell" })} onManage={(token) => setView({ v: "manage", token })} />}
      {tab === "assets" && <AssetMarket />}
    </>
  );
}

function Browse({ data, onOpen, onReload }: { data: { listings: Listing[]; rules: Rules }; onOpen: (l: Listing) => void; onReload: () => void }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"best" | "cheap" | "big" | "reach">("best");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^@/, "");
    const r = data.listings.filter((l) => !s || l.username.toLowerCase().includes(s) || l.title.toLowerCase().includes(s));
    const by: Record<string, (a: Listing, b: Listing) => number> = {
      best: (a, b) => (b.reachPct ?? 0) - (a.reachPct ?? 0) || (b.medianViews ?? 0) - (a.medianViews ?? 0) || Number(!!b.verifiedUntil) - Number(!!a.verifiedUntil),
      cheap: (a, b) => a.price - b.price, big: (a, b) => (b.subscribers ?? 0) - (a.subscribers ?? 0), reach: (a, b) => (b.medianViews ?? 0) - (a.medianViews ?? 0),
    };
    return [...r].sort(by[sort]);
  }, [data.listings, q, sort]);
  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-2xl px-3.5 py-2.5" style={{ background: "var(--app-card)" }}>
        <span style={{ color: "var(--app-hint)" }}>🔎</span>
        <input className={inputCls} style={inputStyle} placeholder="ابحث باسم القناة أو المعرّف" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mb-3"><Chips wrap={false} items={[{ id: "best", label: "الأفضل" }, { id: "cheap", label: "الأرخص" }, { id: "big", label: "الأكثر مشتركين" }, { id: "reach", label: "الأعلى مشاهدة" }]} value={sort} onChange={(v) => setSort(v as any)} /></div>
      {list.length === 0 ? (
        <Section><Empty icon="📭" title={data.listings.length ? "لا نتائج لهذا البحث" : "لا توجد قنوات معروضة بعد"} sub={data.listings.length ? "جرّب كلمة أخرى." : "كن أول من يعرض قناته من تبويب «بِع إعلانات قناتك»."} action={<Btn kind="ghost" small onClick={onReload}>↻ تحديث</Btn>} /></Section>
      ) : (
        <div className="space-y-2.5">
          {list.map((l) => {
            const g = GRADE[l.grade] || GRADE.unknown;
            return (
              <button key={l.username} type="button" onClick={() => onOpen(l)} className="w-full rounded-2xl p-4 text-start active:scale-[0.99]" style={{ background: "var(--app-card)" }}>
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-lg font-black" style={{ background: "color-mix(in srgb,#7c3aed 15%, transparent)", color: "#7c3aed" }}>{(l.title || l.username).slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 truncate text-[15px] font-extrabold" style={{ color: "var(--app-text)" }}>{l.title || l.username}{l.verifiedUntil && <span title="شارة البورصة مدفوعة" style={{ color: "#2481cc" }}>☑️</span>}</span>
                    <span className="block text-xs" dir="ltr" style={{ color: "var(--app-hint)", textAlign: "right" }}>@{l.username}</span>
                  </span>
                  <span className="text-end"><span className="block text-[17px] font-black" style={{ color: "#7c3aed" }}>{usd(l.price)}</span><span className="text-[10px]" style={{ color: "var(--app-hint)" }}>للمنشور</span></span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-bold" style={{ color: "var(--app-hint)" }}>
                  <span className="rounded-full px-2 py-0.5" style={{ background: "var(--app-chip)" }}>👥 {k(l.subscribers)}</span>
                  <span className="rounded-full px-2 py-0.5" style={{ background: "var(--app-chip)" }}>👁 {k(l.medianViews)}/منشور</span>
                  {l.postsSampled > 0 && <span className="rounded-full px-2 py-0.5" style={{ background: "var(--app-chip)" }}>عينة {l.postsSampled}</span>}
                  {l.reachPct != null && <span className="rounded-full px-2 py-0.5" style={{ background: "var(--app-chip)" }}>📈 {Math.round(l.reachPct)}%</span>}
                  {l.auditedAt && <span className="text-[10px]">فُحصت {new Date(l.auditedAt).toLocaleDateString("ar")}</span>}
                  {g[0] && <Pill tone={g[1]}>{g[0]}</Pill>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-3 px-1 text-[11px] leading-5" style={{ color: "var(--app-hint)" }}>السعر يشمل عمولة المنصة {data.rules.commissionPct}%. أرقام الأداء تاريخية وتقديرية، ولا تضمن عدد النقرات أو المبيعات.</p>
    </>
  );
}

function Channel({ l, rules, username, onDeal }: { l: Listing; rules: Rules; username: string; onDeal: (code: string, price: number) => void }) {
  const { api, toast, setDirty, open } = useApp();
  const [f, setF] = useState({ adText: "", targetUrl: "", contact: username ? `@${username}` : "" });
  const [busy, setBusy] = useState(false);
  const set = (k2: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k2]: v })); setDirty(true); };
  const ok = f.adText.trim().length >= 20 && /^https?:\/\/\S{3,}$/i.test(f.targetUrl.trim()) && /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(f.contact.trim());
  const submit = async () => {
    setBusy(true);
    const r = await api<{ code: string; price: number }>("ex_deal_create", { channel: l.username, ...f });
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    setDirty(false);
    onDeal(r.code, r.price);
  };
  const g = GRADE[l.grade] || GRADE.unknown;
  return (
    <>
      <ScreenTitle icon="📣" title={l.title || l.username} sub={`@${l.username}`} />
      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {[["👥", k(l.subscribers), "مشترك"], ["👁", k(l.medianViews), "وسيط المشاهدات"], ["📈", l.reachPct != null ? `${Math.round(l.reachPct)}%` : "—", "وصول تقديري"]].map(([i, v, t]) => (
          <div key={t} className="rounded-2xl p-3" style={{ background: "var(--app-card)" }}><div className="text-lg">{i}</div><div className="text-[17px] font-black">{v}</div><div className="text-[10.5px]" style={{ color: "var(--app-hint)" }}>{t}</div></div>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {l.verifiedUntil && <Pill tone="info">☑️ شارة البورصة حتى {new Date(l.verifiedUntil).toLocaleDateString("ar")}</Pill>}
        {g[0] && <Pill tone={g[1]}>{g[0]}</Pill>}
        <Btn small kind="ghost" onClick={() => open(`https://t.me/${l.username}`)}>عاين القناة ↗</Btn>
      </div>
      <Section title="إعلانك" hint={`السعر الإجمالي ${usd(l.price)} ويصل إلى مالك القناة ${usd(l.price * (1 - rules.commissionPct / 100))} بعد عمولة ${rules.commissionPct}%. يُنشر النص كما هو مع رابطك.`}>
        <Field label={`نص الإعلان (${f.adText.trim().length}/1500، 20 حرفاً على الأقل)`}>
          <textarea rows={5} maxLength={1500} className={`${inputCls} resize-none`} style={inputStyle} placeholder="اكتب نص المنشور الذي تريد نشره في القناة…" value={f.adText} onChange={(e) => set("adText", e.target.value)} />
        </Field>
        <Field label="رابط الإعلان">
          <input dir="ltr" className={inputCls} style={inputStyle} placeholder="https://t.me/yourchannel" value={f.targetUrl} onChange={(e) => set("targetUrl", e.target.value)} />
        </Field>
        <Field label="معرّفك للتواصل">
          <input dir="ltr" className={inputCls} style={inputStyle} placeholder="@username" value={f.contact} onChange={(e) => set("contact", e.target.value)} />
        </Field>
      </Section>
      <Section title="كيف تحمي المنصة أموالك؟">
        <Row icon="🔒" title="ادفع عبر طلب المنصة" sub="يسجل النظام الدفع ومرجعه؛ لا تحوّل مباشرة إلى صاحب القناة، وتابع حالة الطلب هنا." />
        <Row icon="🔎" title="نتحقق من النشر" sub="يرسل صاحب القناة رابط المنشور؛ نتحقق آلياً أو نحيله للمراجعة اليدوية." />
        <Row icon="↩️" title="لم يُنشر؟ يُعاد المبلغ" sub="لا يُحوَّل لصاحب القناة شيء قبل التحقق." />
      </Section>
      <MainAction text={`اطلب الإعلان · ${usd(l.price)}`} onClick={submit} disabled={!ok} busy={busy} color="#7c3aed" />
      <p className="px-1 text-[11px]" style={{ color: "var(--app-hint)" }}>يشمل عمولة المنصة {rules.commissionPct}%.</p>
    </>
  );
}

function Pay({ code, price, channel, kind, onDone }: { code: string; price: number; channel: string; kind: "AD" | "BADGE"; onDone: () => void }) {
  const { api, toast, open } = useApp();
  const [manual, setManual] = useState<{ amount: number; usdt: string; network: string; note: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pay = async (method: "stars" | "nowpayments" | "usdt") => {
    setBusy(method);
    const r = await api<any>("ex_pay", { code, method });
    setBusy(null);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    if (r.manual) { setManual(r); return; }
    if (r.url) open(r.url);
  };
  return (
    <>
      <ScreenTitle icon="💳" title={kind === "BADGE" ? "فعّل شارة إبراز القناة" : "ادفع لتأكيد الطلب"} sub={`${kind === "BADGE" ? "شارة إبراز ☑️ لقناة" : "إعلان في"} @${channel}`} />
      <div className="mb-4 rounded-3xl p-5 text-center" style={{ background: "var(--app-card)" }}>
        <div className="text-xs font-bold" style={{ color: "var(--app-hint)" }}>المبلغ</div>
        <div className="mt-1 text-4xl font-black" dir="ltr">{usd(price)}</div>
        <div className="mt-2 text-xs" style={{ color: "var(--app-hint)" }}>كود الطلب</div>
        <div className="font-mono text-base font-extrabold" dir="ltr">{code}</div>
      </div>
      {!manual ? (
        <Section title="طريقة الدفع">
          <Row icon="⭐" title="نجوم تيليجرام" sub="يتأكد تلقائياً بعد وصول إشعار الدفع" onClick={() => pay("stars")} right={busy === "stars" ? <span>…</span> : undefined} />
          <Row icon="🪙" title="عملات رقمية" sub="صفحة دفع آمنة، تتأكد تلقائياً" onClick={() => pay("nowpayments")} right={busy === "nowpayments" ? <span>…</span> : undefined} />
          <Row icon="💵" title="تحويل USDT يدوي" sub="تؤكده المنصة بعد وصوله" onClick={() => pay("usdt")} right={busy === "usdt" ? <span>…</span> : undefined} />
        </Section>
      ) : (
        <Section title={`حوّل USDT (${manual.network})`} hint={manual.note}>
          <Copyable label="المبلغ" value={String(manual.amount)} />
          <Copyable label="العنوان" value={manual.usdt} />
          <Copyable label="اكتب هذا الكود في الملاحظة" value={code} />
        </Section>
      )}
      <Btn className="w-full" kind="soft" onClick={onDone}>{kind === "AD" ? "تابع حالة الطلب" : "تم"}</Btn>
    </>
  );
}

function useDeal(code: string) {
  const { api } = useApp();
  const [d, setD] = useState<Deal | null | false>(null);
  const load = useCallback(async () => { const r = await api<{ deal: Deal }>("ex_deal", { code }); setD(r.ok ? r.deal : false); }, [api, code]);
  useEffect(() => { void load(); }, [load]);
  return { d, load };
}

function MyDeals({ codes, onOpen, onBrowse }: { codes: string[]; onOpen: (c: string) => void; onBrowse: () => void }) {
  if (!codes.length) return <Section><Empty icon="🧾" title="لا توجد طلبات بعد" sub="طلبات الإعلان التي تنشئها من هذا التطبيق تظهر هنا مع حالتها." action={<Btn onClick={onBrowse}>🛒 تصفّح القنوات</Btn>} /></Section>;
  return <Section title="طلباتي">{codes.map((c) => <DealRow key={c} code={c} onOpen={() => onOpen(c)} />)}</Section>;
}
function DealRow({ code, onOpen }: { code: string; onOpen: () => void }) {
  const { d } = useDeal(code);
  if (d === false) return null;
  const s = d ? DEAL_STATUS[d.status] || [d.status, "neutral"] : null;
  return <Row icon={d?.kind === "BADGE" ? "☑️" : "📣"} title={d ? `@${d.channel} · ${usd(d.price)}` : code} sub={<span dir="ltr" className="font-mono">{code}</span>} right={s ? <Pill tone={s[1]}>{s[0]}</Pill> : <span>…</span>} onClick={onOpen} />;
}

const FLOW = ["PENDING_PAYMENT", "PAID", "POSTED", "VERIFIED", "RELEASED"];
const FLOW_LABEL = ["الدفع", "بانتظار النشر", "نُشر", "تم التحقق", "مكتملة"];
function DealView({ code, onPay }: { code: string; onPay: (d: Deal) => void }) {
  const { open } = useApp();
  const { d, load } = useDeal(code);
  if (d === null) return <Loading />;
  if (d === false) return <Section><Empty icon="❓" title="الكود غير موجود" /></Section>;
  const idx = FLOW.indexOf(d.status);
  const s = DEAL_STATUS[d.status] || [d.status, "neutral"];
  return (
    <>
      <ScreenTitle icon={d.kind === "BADGE" ? "☑️" : "📣"} title={d.kind === "BADGE" ? `شارة إبراز @${d.channel}` : `إعلان في @${d.channel}`} sub={code} />
      <div className="mb-4 rounded-3xl p-5" style={{ background: "var(--app-card)" }}>
        <div className="flex items-center justify-between"><Pill tone={s[1]}>{s[0]}</Pill><span className="text-xl font-black" dir="ltr">{usd(d.price)}</span></div>
        {d.kind === "AD" && idx >= 0 && (
          <div className="mt-5 flex items-start justify-between gap-1">
            {FLOW.map((st, i) => (
              <div key={st} className="flex flex-1 flex-col items-center">
                <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-black" style={i <= idx ? { background: "#7c3aed", color: "#fff" } : { background: "var(--app-chip)", color: "var(--app-hint)" }}>{i < idx ? "✓" : i + 1}</div>
                <div className="mt-1 text-center text-[9.5px] font-bold leading-3" style={{ color: i <= idx ? "var(--app-text)" : "var(--app-hint)" }}>{FLOW_LABEL[i]}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {d.status === "PENDING_PAYMENT" && <Btn className="mb-3 w-full" onClick={() => onPay(d)}>💳 ادفع الآن</Btn>}
      {d.postLink && <Section><Row icon="🔗" title="رابط المنشور" sub={<span dir="ltr">{d.postLink}</span>} onClick={() => open(d.postLink!)} /></Section>}
      <Section>
        <Row icon="🔒" title="الدفع والنشر مرحلتان منفصلتان" sub="إتمام الدفع لا يعني أن الإعلان نُشر. تبقى الصفقة مفتوحة حتى إثبات النشر ثم تسجيل التسوية." />
        {d.paymentReference && <Row icon="🔎" title="مرجع الدفع الوارد" sub={<span dir="ltr" className="break-all font-mono">{d.paymentReference}</span>} />}
        {d.settlementReference && <Row icon="🧾" title={d.status === "REFUNDED" ? "مرجع الاسترداد" : "مرجع صرف أرباح القناة"} sub={<span dir="ltr" className="break-all font-mono">{d.settlementReference}</span>} />}
      </Section>
      <Btn kind="ghost" onClick={() => void load()}>↻ تحديث الحالة</Btn>
    </>
  );
}

function SellHome({ rules, tokens, onNew, onManage }: { rules: Rules; tokens: string[]; onNew: () => void; onManage: (t: string) => void }) {
  return (
    <>
      <Section title="لماذا تعرض قناتك هنا؟">
        <Row icon="💰" title="دخل من قناتك بلا مطاردة معلنين" sub={`تحدد سعر المنشور (${rules.minPrice}$-${rules.maxPrice}$) ويصلك ${100 - rules.commissionPct}% منه.`} />
        <Row icon="🔒" title="الدفع والنشر مرحلتان منفصلتان" sub="لا تُعد الصفقة مكتملة لصاحب القناة إلا بعد التحقق من النشر وتسجيل مرجع صرف مستحقه." />
        <Row icon="☑️" title="شارة إبراز القناة" sub={`تظهر قناتك ضمن النتائج المميزة بشارة ☑️ لمدة سنة مقابل ${rules.badgePrice}$.`} />
      </Section>
      {tokens.length > 0 && <Section title="قنواتي">{tokens.map((t) => <ChannelRow key={t} token={t} onOpen={() => onManage(t)} />)}</Section>}
      <Btn className="w-full" onClick={onNew}>➕ اعرض قناة أو جروب</Btn>
    </>
  );
}
function ChannelRow({ token, onOpen }: { token: string; onOpen: () => void }) {
  const { api } = useApp();
  const [l, setL] = useState<any>(null);
  useEffect(() => { void api<any>("ex_manage", { token }).then((r) => setL(r.ok ? r.listing : false)); }, [api, token]);
  if (l === false) return null;
  return <Row icon="📣" title={l ? `@${l.username}` : "…"} sub={l ? `${usd(l.price)} للمنشور` : ""} right={l ? <Pill tone={l.status === "LISTED" ? "ok" : "warn"}>{l.status === "LISTED" ? "معروضة" : "بانتظار التوثيق"}</Pill> : undefined} onClick={onOpen} />;
}

function Sell({ rules, username, onListed }: { rules: Rules; username: string; onListed: (token: string) => void }) {
  const { api, toast, setDirty } = useApp();
  const [f, setF] = useState({ channel: "", ownerContact: username ? `@${username}` : "", payoutAddress: "", price: "" });
  const [busy, setBusy] = useState(false);
  const set = (k2: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k2]: v })); setDirty(true); };
  const price = Number(f.price) || 0;
  const submit = async () => {
    setBusy(true);
    const r = await api<{ token: string }>("ex_list_request", { ...f, price });
    setBusy(false);
    if (!r.ok || !r.token) { toast(r.error || "", "err"); return; }
    setDirty(false);
    onListed(r.token);
  };
  return (
    <>
      <ScreenTitle icon="💼" title="اعرض قناتك" sub="نثبت التحكم بالقناة ونحلل عينة من منشوراتها العامة؛ الأرقام تقديرية." />
      <Section>
        <Field label="معرّف القناة أو الجروب العام"><input dir="ltr" className={inputCls} style={inputStyle} placeholder="@yourchannel" value={f.channel} onChange={(e) => set("channel", e.target.value.trim())} /></Field>
        <Field label="سعر المنشور الواحد ($)" hint={price > 0 ? `يصلك ${(price * (1 - rules.commissionPct / 100)).toFixed(2)}$ عن كل منشور بعد عمولة المنصة ${rules.commissionPct}%.` : `بين ${rules.minPrice}$ و${rules.maxPrice}$`}>
          <input dir="ltr" inputMode="decimal" className={inputCls} style={inputStyle} placeholder="20" value={f.price} onChange={(e) => set("price", e.target.value)} />
        </Field>
        <Field label="محفظة استلام أرباحك (USDT-TRC20 أو TON)"><input dir="ltr" className={`${inputCls} font-mono text-[14px]`} style={inputStyle} placeholder="عنوان TRC20 أو TON صالح" value={f.payoutAddress} onChange={(e) => set("payoutAddress", e.target.value.trim())} /></Field>
        <Field label="معرّفك للتواصل"><input dir="ltr" className={inputCls} style={inputStyle} placeholder="@username" value={f.ownerContact} onChange={(e) => set("ownerContact", e.target.value.trim())} /></Field>
      </Section>
      <MainAction text="التالي: توثيق الملكية" onClick={submit} disabled={!f.channel || !(price >= rules.minPrice && price <= rules.maxPrice) || f.payoutAddress.length < 20 || f.ownerContact.length < 4} busy={busy} color="#7c3aed" />
    </>
  );
}

function Manage({ token, rules, onBadge }: { token: string; rules: Rules; onBadge: (code: string, price: number, channel: string) => void }) {
  const { api, toast, open } = useApp();
  const [m, setM] = useState<{ listing: any; deals: any[] } | null | false>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api<any>("ex_manage", { token }); setM(r.ok ? r : false); }, [api, token]);
  useEffect(() => { void load(); }, [load]);
  if (m === null) return <Loading />;
  if (m === false) return <Section><Empty icon="❓" title="القناة غير موجودة" /></Section>;
  const l = m.listing;
  const verify = async () => {
    setBusy(true);
    const r = await api<{ already: boolean }>("ex_list_verify", { token });
    setBusy(false);
    toast(r.ok ? "✓ تم توثيق الملكية، قناتك معروضة الآن" : r.error || "", r.ok ? "ok" : "err");
    if (r.ok) void load();
  };
  const post = async (code: string) => {
    const r = await api<{ verified: boolean }>("ex_post", { token, code, link: links[code] || "" });
    toast(r.ok ? (r.verified ? "✓ تم التحقق من المنشور" : "سُجّل الرابط، وسيُراجع") : r.error || "", r.ok ? "ok" : "err");
    if (r.ok) void load();
  };
  const badge = async () => {
    const r = await api<{ code: string; price: number }>("ex_badge", { token });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    onBadge(r.code, r.price, l.username);
  };
  return (
    <>
      <ScreenTitle icon="💼" title={`@${l.username}`} sub={`${usd(l.price)} للمنشور · ${l.status === "LISTED" ? "معروضة في البورصة" : "بانتظار توثيق الملكية"}`} />
      {l.status !== "LISTED" && l.verifyCode && (
        <Section title="وثّق ملكية القناة" hint="ضع الكود في وصف القناة أو في منشور عام، ثم اضغط تحقّق. يمكنك حذفه بعد التوثيق.">
          <Copyable label="كود التوثيق" value={l.verifyCode} />
          <div className="flex gap-2 p-3"><Btn className="flex-1" kind="soft" onClick={() => open(`https://t.me/${l.username}`)}>افتح القناة</Btn><Btn className="flex-1" onClick={verify} disabled={busy}>{busy ? "…" : "✅ تحقّق"}</Btn></div>
        </Section>
      )}
      {l.status === "LISTED" && (
        <>
          <Section title="طلبات الإعلان" hint="انشر النص كما هو ثم ألصق رابط المنشور. بعد التحقق تسجل الإدارة عملية الصرف ومرجع التحويل هنا.">
            {m.deals.length === 0 ? <Empty icon="📭" title="لا توجد طلبات بعد" sub="تظهر هنا فور دفع معلن لإعلان في قناتك." /> : m.deals.map((d: any) => {
              const s = DEAL_STATUS[d.status] || [d.status, "neutral"];
              return (
                <div key={d.code} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: "var(--app-sep)" }}>
                  <div className="flex items-center justify-between"><span className="font-mono text-xs" dir="ltr">{d.code}</span><Pill tone={s[1]}>{s[0]}</Pill></div>
                  <p className="mt-1.5 whitespace-pre-line text-[13px] leading-5">{d.ad_text}</p>
                  {d.target_url && <div className="mt-1 break-all text-xs" dir="ltr" style={{ color: "var(--app-link)" }}>{d.target_url}</div>}
                  {d.payment_reference && <div className="mt-1 break-all text-[11px]" style={{ color: "var(--app-hint)" }}>مرجع الدفع الوارد: <span dir="ltr" className="font-mono">{d.payment_reference}</span></div>}
                  {d.settlement_reference && <div className="mt-1 text-[11px]" style={{ color: "var(--app-hint)" }}>مرجع الصرف/الاسترداد: <span dir="ltr" className="font-mono">{d.settlement_reference}</span></div>}
                  <div className="mt-1 text-xs" style={{ color: "var(--app-hint)" }}>يصلك {usd(d.payout)}</div>
                  {(d.status === "PAID" || d.status === "POSTED") && (
                    <div className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--app-chip)" }}>
                      <input dir="ltr" className={`${inputCls} text-[14px]`} style={inputStyle} placeholder={`https://t.me/${l.username}/123`} value={links[d.code] || ""} onChange={(e) => setLinks((x) => ({ ...x, [d.code]: e.target.value.trim() }))} />
                      <Btn small onClick={() => post(d.code)} disabled={!links[d.code]}>إرسال</Btn>
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
          <Section title="☑️ شارة التوثيق">
            {l.verifiedUntil ? <Row icon="☑️" title="شارة الإبراز مفعّلة" sub={`حتى ${new Date(l.verifiedUntil).toLocaleDateString("ar")}`} /> : <Row icon="☑️" title={`فعّل شارة إبراز بـ ${usd(rules.badgePrice)}`} sub="تُبرز قناتك في نتائج البورصة لمدة سنة. إثبات الملكية الأساسي مجاني." onClick={badge} />}
          </Section>
        </>
      )}
    </>
  );
}


type AssetType = "CHANNEL" | "GROUP" | "BOT";
type AssetListingView = { id: string; assetType: AssetType; identifier: string; title: string; description: string; price: number; seller: { telegramId: string; firstName: string; lastName: string | null; username: string }; verificationMode: string; createdAt: string };
type AssetSaleView = {
  code: string; status: string; sellerTelegramId: string; buyerTelegramId: string;
  seller: any; buyer: any; sellerConfirmed: boolean; buyerConfirmed: boolean; paymentLate?: boolean; transferEvidence: string | null;
  assetType: AssetType; identifier: string; title: string; price: number; commission: number; sellerAmount: number;
  paymentReference: string | null; settlementReference: string | null;
};
const ASSET_STATUS: Record<string, string> = {
  PENDING_PAYMENT: "بانتظار الدفع", PAID: "مدفوع · بانتظار التسليم", POSTED: "التسليم قيد التحقق",
  VERIFIED: "تم إثبات نقل الملكية · بانتظار التسوية", RELEASED: "اكتملت الصفقة",
  REFUNDED: "تم الاسترداد", CANCELLED: "أُلغي الحجز قبل وصول الدفعة",
};
const ASSET_TYPE_LABEL: Record<AssetType, string> = { CHANNEL: "قناة", GROUP: "مجموعة", BOT: "بوت" };

function AssetIdentityCard({ identity, onRequest }: { identity: any; onRequest: () => void }) {
  const valid = !!identity?.phoneVerified && !!identity?.phoneNumber && !!identity?.username && identity.username !== "unknown";
  return (
    <Section title="🪪 هوية تيليجرام للطرفين" hint="المعرّف الرقمي هو مفتاح المطابقة. الاسم واليوزرنيم محفوظان كلقطة وقت الصفقة، ورقم الهاتف لا يُقبل إلا عبر مشاركة جهة الاتصال من حسابك.">
      {identity ? (
        <div className="space-y-1 px-3 py-2 text-sm">
          <p className="font-bold">{identity.firstName} {identity.lastName || ""}</p>
          <p dir="ltr" className="text-xs">@{identity.username || "لا يوجد Username"} · Telegram ID: {identity.telegramId}</p>
          <p dir="ltr" className="text-xs">{identity.phoneVerified ? identity.phoneNumber : "رقم الهاتف غير موثّق"}</p>
          <Pill tone={valid ? "ok" : "warn"}>{valid ? "الهوية مكتملة" : "أكمل توثيق الهوية قبل البيع أو الشراء"}</Pill>
        </div>
      ) : <p className="px-3 py-2 text-sm">لم يتم تسجيل هويتك بعد. أعد تحميل الصفحة.</p>}
      {!valid && <Btn className="w-full" onClick={onRequest}>📱 توثيق رقم الهاتف من تيليجرام</Btn>}
      {!identity?.username || identity?.username === "unknown" ? <p className="px-3 text-xs text-amber-700">عيّن Username عاماً في إعدادات تيليجرام، فالمعرّف الرقمي وحده لا يكفي لعرض بيانات التواصل للطرفين.</p> : null}
    </Section>
  );
}

function AssetMarket() {
  const { api, toast, open } = useApp();
  const [tab, setTab] = useState<"browse" | "sell" | "deals">("browse");
  const [data, setData] = useState<{ listings: AssetListingView[]; myListings: any[]; mySales: string[]; identity: any; verifierBots: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sale, setSale] = useState<AssetSaleView | null>(null);
  const [manualPay, setManualPay] = useState<any>(null);
  const [form, setForm] = useState({ assetType: "CHANNEL" as AssetType, identifier: "", title: "", description: "", price: "", payoutAddress: "" });
  const [evidence, setEvidence] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const r = await api<any>("ex_asset_list");
    if (r.ok) setData(r);
    else toast(r.error || "تعذّر تحميل سوق الأصول.", "err");
  }, [api, toast]);
  useEffect(() => { void load(); }, [load]);

  const identityReady = !!data?.identity?.phoneVerified && !!data.identity.phoneNumber && !!data.identity.username && data.identity.username !== "unknown";
  const requestIdentity = async () => {
    const r = await api<any>("ex_asset_identity_request");
    if (!r.ok) { toast(r.error || "تعذّر طلب مشاركة رقم الهاتف.", "err"); return; }
    toast("أرسلنا زر مشاركة جهة الاتصال إلى محادثة البوت. افتح المحادثة وشارك رقمك ثم حدّث الهوية.", "ok");
    if (r.link) open(r.link);
  };
  const showSale = async (code: string) => {
    setBusy(true);
    const r = await api<any>("ex_asset_sale", { code });
    setBusy(false);
    if (!r.ok) { toast(r.error || "الصفقة غير متاحة.", "err"); return; }
    setSale(r.sale);
    setManualPay(null);
    setEvidence("");
    setTab("deals");
  };
  const buy = async (l: AssetListingView) => {
    if (!identityReady) { toast("أكمل توثيق الاسم واليوزرنيم ورقم الهاتف أولاً.", "err"); await requestIdentity(); return; }
    setBusy(true);
    const r = await api<any>("ex_asset_buy", { listingId: l.id });
    setBusy(false);
    if (!r.ok) { toast(r.error || "تعذّر حجز الأصل.", "err"); return; }
    toast("تم حجز العرض. أكمل الدفع خلال 30 دقيقة.", "ok");
    await showSale(r.code);
  };
  const create = async () => {
    if (!identityReady) { toast("أكمل توثيق هويتك ورقم هاتفك قبل عرض الأصل.", "err"); await requestIdentity(); return; }
    const price = Number(form.price);
    if (!form.identifier.trim() || !(price >= 10 && price <= 25000) || form.description.trim().length < 30 || form.payoutAddress.trim().length < 20) {
      toast("أكمل المعرّف والوصف والسعر بين 10 و25000 دولار ومحفظة استلام صحيحة.", "err"); return;
    }
    setBusy(true);
    const r = await api<any>("ex_asset_create", { ...form, price });
    setBusy(false);
    if (!r.ok) { toast(r.error || "تعذّر إنشاء العرض.", "err"); return; }
    toast(r.status === "LISTED" ? "تم إثبات ملكيتك وإتاحة العرض في السوق." : "أرسل العرض إلى مراجعة المالك؛ لن يظهر للمشترين قبل اعتماده.", "ok");
    setForm({ assetType: "CHANNEL", identifier: "", title: "", description: "", price: "", payoutAddress: "" });
    await load();
    setTab("sell");
  };
  const pay = async (method: "stars" | "nowpayments" | "usdt") => {
    if (!sale) return;
    setBusy(true);
    const r = await api<any>("ex_pay", { code: sale.code, method });
    setBusy(false);
    if (!r.ok) { toast(r.error || "تعذّر بدء الدفع.", "err"); return; }
    if (r.manual) { setManualPay(r); return; }
    if (r.url) open(r.url);
  };
  const sellerTransfer = async () => {
    if (!sale) return;
    setBusy(true);
    const r = await api<any>("ex_asset_transfer", { code: sale.code, evidence });
    setBusy(false);
    if (!r.ok) { toast(r.error || "تعذّر تسجيل التسليم.", "err"); return; }
    toast("سُجل تأكيد البائع. انتظر تحقق المشتري أو مراجعة الإدارة للبوت.", "ok");
    await showSale(sale.code);
  };
  const buyerReceive = async () => {
    if (!sale) return;
    setBusy(true);
    const r = await api<any>("ex_asset_receive", { code: sale.code });
    setBusy(false);
    if (!r.ok) { toast(r.error || "لم نثبت نقل الملكية.", "err"); return; }
    toast(r.manualReview ? "أكدت الاستلام. تنتظر صفقة البوت مراجعة المالك في BotFather." : "تم إثبات أن حسابك أصبح المالك.", "ok");
    await showSale(sale.code);
    await load();
  };

  const identityLine = (label: string, x: any) => (
    <div className="rounded-xl p-3 text-sm" style={{ background: "var(--app-chip)" }}>
      <p className="mb-1 font-bold">{label}</p>
      <p>{x?.firstName || "—"} {x?.lastName || ""}</p>
      <p dir="ltr" className="text-xs">@{x?.username || "—"} · ID {x?.telegramId || "—"}</p>
      <p dir="ltr" className="text-xs">{x?.phoneNumber || "الهاتف غير متاح"}</p>
    </div>
  );

  if (!data) return <Section><Loading /></Section>;
  return (
    <>
      <ScreenTitle icon="🏪" title="سوق ملكية أصول تيليجرام" sub="بيع وشراء القنوات والمجموعات والبوتات مع تسجيل هوية الطرفين وتتبع التسليم." />
      <AssetIdentityCard identity={data.identity} onRequest={requestIdentity} />
      <div className="mb-3"><Chips items={[{ id: "browse", label: "🛒 شراء أصل" }, { id: "sell", label: "➕ اعرض أصلاً" }, { id: "deals", label: `🧾 صفقاتي ${data.mySales.length ? `(${data.mySales.length})` : ""}` }]} value={tab} onChange={(v) => { setTab(v as any); setSale(null); setManualPay(null); }} /></div>

      {tab === "browse" && (
        <>
          <div className="mb-3 rounded-2xl p-3" style={{ background: "var(--app-card)" }}>
            <input className={inputCls} style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث باسم الأصل أو معرّفه" />
          </div>
          {data.listings.filter((x) => !query || [x.title, x.identifier].some((v) => v.toLowerCase().includes(query.toLowerCase().replace(/^@/, "")))).length === 0
            ? <Section><Empty icon="🏪" title="لا توجد أصول معروضة" sub="تأكد من عودتك بعد توثيق ملكية العرض." /></Section>
            : <div className="space-y-2">
              {data.listings.filter((x) => !query || [x.title, x.identifier].some((v) => v.toLowerCase().includes(query.toLowerCase().replace(/^@/, "")))).map((l) => (
                <div key={l.id} className="rounded-2xl p-4" style={{ background: "var(--app-card)" }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-bold">{l.title}</p><p dir="ltr" className="text-xs" style={{ color: "var(--app-hint)" }}>{l.assetType} · @{l.identifier}</p></div>
                    <p dir="ltr" className="shrink-0 font-black text-violet-700">${l.price.toFixed(2)}</p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{l.description}</p>
                  <div className="mt-2 text-xs" style={{ color: "var(--app-hint)" }}>البائع: {l.seller.firstName} {l.seller.lastName || ""} · @{l.seller.username} · التحقق: {l.verificationMode === "TELEGRAM_CREATOR_CHECK" ? "ملكية عبر بوت تيليجرام" : "مراجعة الإدارة"}</div>
                  <Btn className="mt-3 w-full" onClick={() => buy(l)} disabled={busy || !identityReady}>شراء وحجز الأصل · ${l.price}</Btn>
                </div>
              ))}
            </div>}
          <p className="mt-3 px-1 text-xs leading-5" style={{ color: "var(--app-hint)" }}>الأسعار بالدولار. عمولة المنصة 15%. لا يُصرف للبائع شيء قبل التأكد من نقل الملكية وتسجيل مرجع الصرف. لا تطلب كلمات مرور أو رموز دخول.</p>
        </>
      )}

      {tab === "sell" && (
        <>
          <Section title="➕ اعرض قناة أو مجموعة أو بوت" hint={`القنوات والمجموعات: أضف أحد هذه الحسابات كمشرف ثم سنفحص صفة المالك: ${(data.verifierBots || []).join(" أو ") || "لا يوجد بوت تحقق متاح حالياً"}. البوتات: مراجعة BotFather يدوية قبل إتاحتها.`}>
            <Field label="نوع الأصل">
              <select className={inputCls} style={inputStyle} value={form.assetType} onChange={(e) => setForm({ ...form, assetType: e.target.value as AssetType })}>
                <option value="CHANNEL">قناة تيليجرام</option><option value="GROUP">مجموعة تيليجرام</option><option value="BOT">بوت تيليجرام</option>
              </select>
            </Field>
            <Field label={form.assetType === "BOT" ? "معرّف البوت" : "معرّف القناة أو المجموعة"} hint="اكتب @username العام أو chat ID يبدأ بـ -100 للمجموعات/القنوات الخاصة بعد إضافة بوت التحقق.">
              <input dir="ltr" className={inputCls} style={inputStyle} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value.trim() })} placeholder="@username أو -100..." />
            </Field>
            <Field label="اسم الأصل"><input className={inputCls} style={inputStyle} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="اسم القناة أو المجموعة أو البوت" /></Field>
            <Field label="وصف الأصل"><textarea rows={4} maxLength={1800} className={`${inputCls} resize-none`} style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="المجال، الجمهور، المميزات، سبب البيع، وأي معلومات مهمة..." /></Field>
            <Field label="سعر البيع بالدولار (10–25000)"><input dir="ltr" inputMode="decimal" className={inputCls} style={inputStyle} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="100" /></Field>
            <Field label="محفظة استلام مستحق البيع (USDT-TRC20 أو TON)"><input dir="ltr" className={`${inputCls} font-mono text-xs`} style={inputStyle} value={form.payoutAddress} onChange={(e) => setForm({ ...form, payoutAddress: e.target.value.trim() })} placeholder="عنوان المحفظة" /></Field>
          </Section>
          <MainAction text="إرسال العرض للتحقق" onClick={create} disabled={busy || !identityReady} busy={busy} color="#7c3aed" />
          <Section title="عروضي الحالية">
            {data.myListings.length === 0 ? <Empty icon="📭" title="لم تعرض أي أصل بعد" /> : data.myListings.map((x) => (
              <Row key={x.id} icon={x.assetType === "BOT" ? "🤖" : x.assetType === "GROUP" ? "👥" : "📣"} title={`${x.title} · @${x.identifier}`} sub={`${x.price}$ · ${x.status === "LISTED" ? "معروض" : x.status === "PENDING_REVIEW" ? "بانتظار مراجعة المالك" : x.status === "RESERVED" ? "محجوز لمشترٍ" : x.status}`} right={<Pill tone={x.status === "LISTED" ? "ok" : "warn"}>{x.status === "LISTED" ? "نشط" : "متابعة"}</Pill>} />
            ))}
          </Section>
        </>
      )}

      {tab === "deals" && (
        <>
          {sale ? (
            <>
              <Section title={`صفقة ${sale.code}`}>
                <p className="font-bold">{sale.title} · {ASSET_TYPE_LABEL[sale.assetType]} · @{sale.identifier}</p>
                <p className="mt-1 text-sm">السعر ${sale.price.toFixed(2)} · عمولة المنصة ${sale.commission.toFixed(2)} · مستحق البائع ${sale.sellerAmount.toFixed(2)}</p>
                <Pill tone={sale.status === "VERIFIED" || sale.status === "RELEASED" ? "ok" : "warn"}>{ASSET_STATUS[sale.status] || sale.status}</Pill>
                <p className="mt-2 text-xs" style={{ color: "var(--app-hint)" }}>تطابق الأطراف يتم بواسطة Telegram ID؛ الاسم واليوزرنيم والهاتف محفوظة كلقطة وقت الشراء.</p>
              </Section>
              <Section title="هويات الطرفين">
                {identityLine("البائع", sale.seller)}
                {identityLine("المشتري", sale.buyer)}
              </Section>
              {sale.paymentLate && <Section><Row icon="⚠️" title="وصل الدفع بعد انتهاء الحجز" sub="لم تُعتمد هذه الصفقة ولم يُسمح بنقل الأصل. ستراجع الإدارة الاسترداد؛ لا ترسل للبائع أي مبلغ ولا تنفذ النقل." /></Section>}\n              <Section title="الدفع والتسوية">
                <Row icon="🔒" title="لا صرف قبل إثبات نقل الملكية" sub="مرجع الدفع الوارد ومرجع صرف مستحق البائع يسجلان منفصلين." />
                {sale.paymentReference && <Copyable label="مرجع الدفع" value={sale.paymentReference} />}
                {sale.settlementReference && <Copyable label="مرجع التسوية" value={sale.settlementReference} />}
                <p className="text-xs" style={{ color: "var(--app-hint)" }}>قيمة الصفقة ${sale.price.toFixed(2)} · مستحق البائع ${sale.sellerAmount.toFixed(2)}</p>
              </Section>
              {sale.status === "PENDING_PAYMENT" && (
                <Section title="أكمل الدفع">
                  <p className="text-sm">الحجز صالح 30 دقيقة من إنشائه. ادفع عبر طريقة متاحة أدناه.</p>
                  <div className="flex flex-wrap gap-2"><Btn small onClick={() => pay("stars")}>⭐ نجوم</Btn><Btn small onClick={() => pay("nowpayments")}>🪙 دفع إلكتروني</Btn><Btn small onClick={() => pay("usdt")}>USDT</Btn></div>
                  {manualPay && <div className="mt-3 space-y-2"><Copyable label="المبلغ" value={String(manualPay.amount)} /><Copyable label="العنوان" value={manualPay.usdt} /><Copyable label="مرجع الصفقة" value={sale.code} /><p className="text-xs">{manualPay.note}</p></div>}
                </Section>
              )}
              {sale.status === "PAID" && sale.sellerTelegramId === data.identity?.telegramId && (
                <Section title="تأكيد تسليم الأصل" hint={sale.assetType === "BOT" ? "أكمل نقل الملكية من BotFather أولاً، ثم أدخل رابط الدليل الذي ستراجعه الإدارة." : "نفّذ نقل الملكية داخل تيليجرام أولاً. بعد ذلك يضغط المشتري على التحقق من الملكية."}>
                  {sale.assetType === "BOT" && <Field label="رابط دليل BotFather (HTTPS)"><input dir="ltr" className={inputCls} style={inputStyle} value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="https://..." /></Field>}
                  <Btn className="w-full" onClick={sellerTransfer} disabled={busy || (sale.assetType === "BOT" && !/^https:\/\//i.test(evidence))}>📦 أتممت نقل الملكية</Btn>
                </Section>
              )}
              {sale.status === "POSTED" && sale.buyerTelegramId === data.identity?.telegramId && (
                <Section title="تحقق من استلام الملكية" hint={sale.assetType === "BOT" ? "أكد الاستلام بعد نقل البوت إلى حسابك. سيبقى الصرف متوقفاً حتى مراجعة BotFather من الإدارة." : "سنتحقق عبر بوت المنصة من أن Telegram ID الخاص بك أصبح صاحب صفة creator."}>
                  <Btn className="w-full" onClick={buyerReceive} disabled={busy}>✅ تحقق من الملكية الآن</Btn>
                </Section>
              )}
              {sale.status === "VERIFIED" && <Section><Row icon="✅" title="تم إثبات نقل الملكية" sub="بقي على الإدارة تحويل مستحق البائع وتسجيل مرجع العملية قبل إغلاق الصفقة." /></Section>}
              <Btn kind="ghost" onClick={() => { setSale(null); setManualPay(null); }}>رجوع إلى صفقاتي</Btn>
            </>
          ) : (
            <Section title="صفقاتي" hint="تظهر الصفقات التي كنت فيها مشترياً أو بائعاً.">
              {data.mySales.length === 0 ? <Empty icon="🧾" title="لا توجد صفقات بعد" sub="احجز أصلاً معروضاً أو اعرض أصلك لتظهر الصفقة هنا." /> : data.mySales.map((code) => <Row key={code} icon="🛍️" title={code} sub="افتح لتفاصيل الهوية والتسليم والدفع" onClick={() => void showSale(code)} right={<Pill tone="info">فتح</Pill>} />)}
            </Section>
          )}
        </>
      )}
      <div className="mt-3 flex justify-end"><Btn small kind="ghost" onClick={() => void load()}>↻ تحديث سوق الأصول</Btn></div>
    </>
  );
}
