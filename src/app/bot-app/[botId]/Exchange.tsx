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
  const [tab, setTab] = useState<"buy" | "mine" | "sell">("buy");
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
      <div className="mb-4"><Chips items={[{ id: "buy", label: "🛒 اشترِ إعلاناً" }, { id: "mine", label: `🧾 طلباتي${dealCodes.length ? ` (${dealCodes.length})` : ""}` }, { id: "sell", label: "💼 بِع إعلانات قناتك" }]} value={tab} onChange={(v) => setTab(v as any)} /></div>
      {tab === "buy" && <Browse data={data} onOpen={(l) => setView({ v: "channel", l })} onReload={load} />}
      {tab === "mine" && <MyDeals codes={dealCodes} onOpen={(code) => setView({ v: "deal", code })} onBrowse={() => setTab("buy")} />}
      {tab === "sell" && <SellHome rules={data.rules} tokens={channelTokens} onNew={() => setView({ v: "sell" })} onManage={(token) => setView({ v: "manage", token })} />}
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
