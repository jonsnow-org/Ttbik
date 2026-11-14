"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// 💸 USDT remittances inside the bot's Mini App: the same ChangeNOW office as the chat (live quote, guided pay-in, HW-… tracking,
// receipts, saved recipients, «receive» link). The platform earns the partner fee; nothing else is charged.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import QR from "@/lib/qrMin";
import { Btn, Chips, Copyable, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, inputCls, inputStyle, useApp, useInnerBack, useInterval } from "./ui";

type T = {
  track: string; status: string; statusLabel: string; final: boolean; coin: string; coinLabel: string; fromAmount: number; toAmount: number; address: string;
  recipient: string | null; fromCountry: string | null; toCountry: string | null; payin: string; payinExtra: string | null; payoutHash: string | null; createdAt: string;
};
type Home = { configured: boolean; transfers: T[]; recipients: { address: string; name: string | null }[]; coins: { id: string; label: string }[]; receive: string; to: { id: string; label: string }[]; from: { id: string; label: string }[] };
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const fmt = (n: number, max = 6) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: max });
const STEPS = ["waiting", "confirming", "exchanging", "sending", "finished"];
const STEP_LABEL: Record<string, string> = { waiting: "بانتظار إرسالك", confirming: "وصل المبلغ", exchanging: "التحويل", sending: "الإرسال للمستلم", finished: "وصلت" };
const tone = (s: string) => (s === "finished" ? "ok" : ["failed", "expired"].includes(s) ? "bad" : s === "refunded" ? "warn" : "info") as any;
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a);

export default function RemitSection({ pay }: { pay: string | null }) {
  const { api } = useApp();
  const [home, setHome] = useState<Home | null>(null);
  const [view, setView] = useState<{ v: "home" } | { v: "send"; addr?: string; name?: string } | { v: "track"; t: T } | { v: "receive" }>(pay && TRON.test(pay) ? { v: "send", addr: pay } : { v: "home" });
  const load = useCallback(async () => { const r = await api<Home>("remit_home"); if (r.ok) setHome(r); }, [api]);
  useEffect(() => { void load(); }, [load]);
  // The section keeps its own sub-screens; Telegram's Back button returns to the remittances home first.
  useInnerBack(view.v !== "home", () => { setView({ v: "home" }); void load(); });

  if (!home) return <><ScreenTitle icon="💸" title="حوالات USDT" /><Loading /></>;
  if (view.v === "send") return <Send home={home} initAddr={view.addr} initName={view.name} onCreated={(t) => { setView({ v: "track", t }); void load(); }} onCancel={() => setView({ v: "home" })} />;
  if (view.v === "track") return <Track t={view.t} onBack={() => { setView({ v: "home" }); void load(); }} />;
  if (view.v === "receive") return <Receive onBack={() => setView({ v: "home" })} />;
  return <RemitHome home={home} onSend={(addr, name) => setView({ v: "send", addr, name })} onTrack={(t) => setView({ v: "track", t })} onReceive={() => setView({ v: "receive" })} onReload={load} />;
}

function RemitHome({ home, onSend, onTrack, onReceive, onReload }: { home: Home; onSend: (a?: string, n?: string) => void; onTrack: (t: T) => void; onReceive: () => void; onReload: () => void }) {
  const { api, toast, confirm } = useApp();
  const active = home.transfers.filter((t) => !t.final);
  return (
    <>
      <div className="mb-4 overflow-hidden rounded-3xl p-5" style={{ background: "linear-gradient(135deg,#059669,#065f46)", color: "#fff" }}>
        <div className="text-[13px] font-bold opacity-85">💸 حوالات USDT</div>
        <div className="mt-1 text-[22px] font-black leading-snug">أرسل إلى محفظة المستلم بثقة</div>
        <p className="mt-1 text-[12.5px] leading-5 opacity-85">تُنفَّذ عملية التبديل والإرسال عبر شريك الخدمة؛ لا تستلم المنصة أموالك. اعرض السعر التقديري قبل الإنشاء، وتابع حالة التحويل ورقم تتبّعه من مكان واحد.</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
          <span className="rounded-full bg-white/20 px-2.5 py-1">🔎 سعر مباشر</span><span className="rounded-full bg-white/20 px-2.5 py-1">🧾 رقم تتبّع وإيصال</span><span className="rounded-full bg-white/20 px-2.5 py-1">🔐 إرسال مباشر للمحفظة</span>
        </div>
      </div>
      {!home.configured && <Section><Empty icon="⏳" title="الحوالات تُفعَّل قريباً" sub="تعمل الخدمة فور تفعيلها من المنصة." /></Section>}
      {home.configured && (
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => onSend()} className="rounded-2xl p-4 text-start active:scale-[0.98]" style={{ background: "var(--app-btn)", color: "var(--app-btn-text)" }}>
            <div className="text-2xl">📤</div><div className="mt-1 text-[15px] font-extrabold">أرسل حوالة</div><div className="text-[11px] opacity-80">سعر مباشر قبل التأكيد</div>
          </button>
          <button type="button" onClick={onReceive} className="rounded-2xl p-4 text-start active:scale-[0.98]" style={{ background: "var(--app-card)" }}>
            <div className="text-2xl">📥</div><div className="mt-1 text-[15px] font-extrabold">استلم حوالة</div><div className="text-[11px]" style={{ color: "var(--app-hint)" }}>رابط تعطيه لمن يرسل لك</div>
          </button>
        </div>
      )}
      {active.length > 0 && (
        <Section title="حوالات جارية">
          {active.map((t) => <Row key={t.track} icon="⏳" title={`${fmt(t.fromAmount)} ${t.coinLabel} → ${fmt(t.toAmount, 2)} USDT`} sub={<><span className="font-mono">{t.track}</span> · {t.statusLabel}</>} onClick={() => onTrack(t)} />)}
        </Section>
      )}
      {home.configured && home.recipients.length > 0 && (
        <Section title="مستلمون محفوظون" hint="اضغط اسماً لإرسال حوالة جديدة له بنقرة.">
          {home.recipients.map((r) => (
            <Row key={r.address} icon="👤" title={r.name || short(r.address)} sub={<span dir="ltr" className="font-mono">{short(r.address)}</span>} onClick={() => onSend(r.address, r.name || undefined)}
              right={<Btn small kind="ghost" onClick={async () => { if (!(await confirm("حذف هذا المستلم من القائمة؟"))) return; const x = await api("remit_del_recipient", { address: r.address }); toast(x.ok ? "حُذف" : x.error || "", x.ok ? "ok" : "err"); onReload(); }}>✕</Btn>} />
          ))}
        </Section>
      )}
      <Section title="سجل الحوالات">
        {home.transfers.length === 0 ? <Empty icon="🧾" title="لا توجد حوالات بعد" sub="أول حوالة لك تظهر هنا مع حالتها وإيصالها." /> :
          home.transfers.map((t) => <Row key={t.track} icon={t.status === "finished" ? "✅" : t.final ? "⚠️" : "⏳"} title={`${fmt(t.toAmount, 2)} USDT${t.recipient ? ` · ${t.recipient}` : ""}`} sub={<><span className="font-mono">{t.track}</span> · {new Date(t.createdAt).toLocaleDateString("ar")}</>} right={<Pill tone={tone(t.status)}>{t.statusLabel.replace(/^\S+\s/, "")}</Pill>} onClick={() => onTrack(t)} />)}
      </Section>
      <Section title="كيف تعمل؟">
        <Row icon="1️⃣" title="اختر العملة والمبلغ" sub="ترى فوراً كم USDT سيصل للمستلم." />
        <Row icon="2️⃣" title="أدخل محفظة المستلم TRC20" sub="عنوان يبدأ بحرف T، أو اختره من المحفوظين." />
        <Row icon="3️⃣" title="أرسل المبلغ للعنوان المعروض" sub="نتابع الحالة حتى تصل، ونرسل لك إشعاراً في البوت." />
      </Section>
    </>
  );
}

function Send({ home, initAddr, initName, onCreated, onCancel }: { home: Home; initAddr?: string; initName?: string; onCreated: (t: T) => void; onCancel: () => void }) {
  const { api, setDirty, toast } = useApp();
  const [f, setF] = useState({ to: "sy", from: "tr", coin: home.coins[0]?.id || "usdtbsc", amount: "", addr: initAddr || "", name: initName || "" });
  const [q, setQ] = useState<{ loading: boolean; quote?: number; min?: number | null; err?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };
  const coinLabel = home.coins.find((c) => c.id === f.coin)?.label || f.coin;
  // Live quote (debounced) whenever the coin or amount changes.
  useEffect(() => {
    const amt = f.amount.trim();
    if (!amt) { setQ(null); return; }
    let active = true;
    setQ({ loading: true });
    const h = window.setTimeout(async () => {
      const r = await api<{ quote: number; min: number | null }>("remit_quote", { coin: f.coin, amount: amt });
      if (!active) return;
      setQ(r.ok ? { loading: false, quote: r.quote, min: r.min } : { loading: false, err: r.error, min: (r as any).min ?? null });
    }, 550);
    return () => { active = false; window.clearTimeout(h); };
  }, [f.amount, f.coin, api]);
  const addrOk = TRON.test(f.addr.trim());
  const ready = !!q?.quote && !q.loading && addrOk && agree;
  const submit = async () => {
    setBusy(true);
    const r = await api<{ transfer: T | null }>("remit_create", { ...f, addr: f.addr.trim() });
    setBusy(false);
    if (!r.ok || !r.transfer) { toast(r.error || "تعذّر إنشاء الحوالة", "err"); return; }
    setDirty(false);
    onCreated(r.transfer);
  };
  return (
    <>
      <ScreenTitle icon="📤" title="أرسل حوالة" sub="سعر تقديري مباشر من الشريك؛ يظهر المبلغ النهائي بعد استلام الإيداع وتحديث حالة العملية." />
      <Section title="من أين وإلى أين">
        <div className="space-y-3 p-3">
          <div><div className="mb-1.5 text-xs font-bold" style={{ color: "var(--app-hint)" }}>بلد المستلم</div><Chips wrap={false} items={home.to} value={f.to} onChange={(v) => set("to", v)} /></div>
          <div><div className="mb-1.5 text-xs font-bold" style={{ color: "var(--app-hint)" }}>ترسل من</div><Chips wrap={false} items={home.from} value={f.from} onChange={(v) => set("from", v)} /></div>
        </div>
      </Section>
      <Section title="تدفع بـ">
        <div className="p-3"><Chips items={home.coins} value={f.coin} onChange={(v) => set("coin", v)} /></div>
      </Section>
      <Section>
        <Field label={`المبلغ بـ ${coinLabel}`} error={q?.err || null} hint={q?.min ? `أقل مبلغ الآن: ${fmt(q.min)} ${coinLabel}` : undefined}>
          <input dir="ltr" inputMode="decimal" className={`${inputCls} text-[22px] font-extrabold`} style={inputStyle} placeholder="100" value={f.amount} onChange={(e) => set("amount", e.target.value)} />
        </Field>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: "color-mix(in srgb,#059669 9%, transparent)" }}>
          <span className="text-xs font-bold" style={{ color: "var(--app-hint)" }}>يصل للمستلم تقريباً</span>
          <span className="text-[20px] font-black" dir="ltr" style={{ color: "#059669" }}>{q?.loading ? "…" : q?.quote ? `${fmt(q.quote, 2)} USDT` : "—"}</span>
        </div>
      </Section>
      {home.recipients.length > 0 && (
        <Section title="مستلم محفوظ">
          <div className="p-3"><Chips wrap={false} items={home.recipients.map((r) => ({ id: r.address, label: r.name || short(r.address) }))} value={f.addr} onChange={(v) => { set("addr", v); const r = home.recipients.find((x) => x.address === v); if (r?.name) set("name", r.name); }} /></div>
        </Section>
      )}
      <Section hint="تأكد من العنوان حرفاً بحرف: التحويل على البلوكشين لا يمكن عكسه.">
        <Field label="محفظة المستلم USDT (TRC20)" error={f.addr && !addrOk ? "العنوان يبدأ بحرف T وطوله 34 حرفاً." : null}>
          <div className="flex items-center gap-2">
            <input dir="ltr" className={`${inputCls} font-mono text-[14px]`} style={inputStyle} placeholder="T…" value={f.addr} onChange={(e) => set("addr", e.target.value.trim())} />
            <Btn small kind="soft" onClick={async () => { try { const t = await navigator.clipboard.readText(); if (t) set("addr", t.trim()); } catch { /* not allowed */ } }}>لصق</Btn>
          </div>
        </Field>
        <Field label="اسم المستلم (اختياري، للحفظ)">
          <input className={inputCls} style={inputStyle} maxLength={30} placeholder="مثال: أبي" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
      </Section>
      <label className="mb-2 flex items-start gap-2 px-1 text-xs leading-5" style={{ color: "var(--app-hint)" }}>
        <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>راجعت المبلغ والعنوان. السعر النهائي يحدده السوق لحظة وصول المبلغ وقد يختلف قليلاً.</span>
      </label>
      <Btn kind="ghost" small onClick={onCancel}>إلغاء</Btn>
      <MainAction text={q?.quote ? `أنشئ الحوالة · ${fmt(q.quote, 2)} USDT` : "أنشئ الحوالة"} onClick={submit} disabled={!ready} busy={busy} color="#059669" />
    </>
  );
}

function QrBox({ value }: { value: string }) {
  const m = useMemo(() => { try { return QR(value); } catch { return null; } }, [value]);
  if (!m) return null;
  const n = m.length;
  return (
    <svg viewBox={`-2 -2 ${n + 4} ${n + 4}`} className="mx-auto h-44 w-44 rounded-xl bg-white p-1" shapeRendering="crispEdges" aria-label="QR">
      {m.flatMap((row, y) => row.map((v, x) => (v ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#111" /> : null)))}
    </svg>
  );
}

function Track({ t: initial, onBack }: { t: T; onBack: () => void }) {
  const { api, open, copy } = useApp();
  const [t, setT] = useState<T>(initial);
  const [showQr, setShowQr] = useState(false);
  const refresh = useCallback(async () => { const r = await api<{ transfer: T }>("remit_status", { track: t.track }); if (r.ok && r.transfer) setT(r.transfer); }, [api, t.track]);
  useEffect(() => { void refresh(); }, [refresh]);
  useInterval(() => { void refresh(); }, t.final ? null : 20_000);
  const stepIdx = t.status === "new" ? 0 : STEPS.indexOf(t.status);
  const waiting = t.status === "new" || t.status === "waiting";
  const receipt = `🧾 إيصال حوالة ${t.track}\nالمبلغ: ${fmt(t.fromAmount)} ${t.coinLabel}\nيصل: ${fmt(t.toAmount, 2)} USDT (TRC20)\nإلى: ${t.address}${t.recipient ? ` (${t.recipient})` : ""}\nالحالة: ${t.statusLabel}${t.payoutHash ? `\nرقم العملية: ${t.payoutHash}` : ""}`;
  return (
    <>
      <ScreenTitle icon="🧾" title={`حوالة ${t.track}`} sub={new Date(t.createdAt).toLocaleString("ar")} />
      <div className="mb-4 rounded-3xl p-5 text-center" style={{ background: "var(--app-card)" }}>
        <Pill tone={tone(t.status)}>{t.statusLabel}</Pill>
        <div className="mt-3 text-3xl font-black" dir="ltr">{fmt(t.toAmount, 2)} <span className="text-base">USDT</span></div>
        <div className="mt-1 text-xs" style={{ color: "var(--app-hint)" }}>تدفع {fmt(t.fromAmount)} {t.coinLabel}{t.recipient ? ` · إلى ${t.recipient}` : ""}</div>
        {!t.final || t.status === "finished" ? (
          <div className="mt-5 flex items-center justify-between gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className="flex flex-1 flex-col items-center">
                <div className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-black" style={i <= stepIdx ? { background: "#059669", color: "#fff" } : { background: "var(--app-chip)", color: "var(--app-hint)" }}>{i < stepIdx || t.status === "finished" ? "✓" : i + 1}</div>
                <div className="mt-1 text-[9.5px] font-bold leading-3" style={{ color: i <= stepIdx ? "var(--app-text)" : "var(--app-hint)" }}>{STEP_LABEL[s]}</div>
              </div>
            ))}
          </div>
        ) : null}
        {!t.final && <div className="mt-3 text-[11px]" style={{ color: "var(--app-hint)" }}>🔄 تتحدث الحالة تلقائياً، ونرسل لك إشعاراً في البوت عند كل تغيير.</div>}
      </div>
      {waiting && (
        <Section title={`أرسل ${fmt(t.fromAmount)} ${t.coinLabel} إلى`} hint="أرسل المبلغ بالضبط إلى عنوان الإيداع. يبدأ التبديل بعد تأكيد الشبكة، والمدة تختلف حسب العملة والازدحام وخدمة التبديل.">
          <Copyable label="المبلغ" value={String(t.fromAmount)} />
          <Copyable label="عنوان الإيداع" value={t.payin} />
          {t.payinExtra && <Copyable label="Memo / Tag — إلزامي" value={t.payinExtra} />}
          <div className="p-3 text-center">
            {showQr ? <QrBox value={t.payin} /> : <Btn small kind="soft" onClick={() => setShowQr(true)}>▦ إظهار رمز QR</Btn>}
          </div>
        </Section>
      )}
      <Section title="التفاصيل">
        <Row icon="👤" title="محفظة المستلم" sub={<span dir="ltr" className="break-all font-mono">{t.address}</span>} />
        {t.payoutHash && <Row icon="🔗" title="رقم العملية على الشبكة" sub={<span dir="ltr" className="break-all font-mono">{short(t.payoutHash)}</span>} onClick={() => open(`https://tronscan.org/#/transaction/${t.payoutHash}`)} />}
      </Section>
      <div className="flex flex-wrap gap-2">
        <Btn kind="soft" onClick={() => copy(receipt)}>📋 نسخ الإيصال</Btn>
        <Btn kind="soft" onClick={() => open(`https://t.me/share/url?url=${encodeURIComponent(t.track)}&text=${encodeURIComponent(receipt)}`)}>📤 مشاركة الإيصال</Btn>
        <Btn kind="ghost" onClick={() => void refresh()}>↻ تحديث</Btn>
        <Btn kind="ghost" onClick={onBack}>كل الحوالات</Btn>
      </div>
    </>
  );
}

function Receive({ onBack }: { onBack: () => void }) {
  const { api, open, toast } = useApp();
  const [addr, setAddr] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const make = async () => {
    const r = await api<{ link: string }>("remit_recv_link", { address: addr.trim() });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    setLink(r.link || null);
  };
  return (
    <>
      <ScreenTitle icon="📥" title="استلم حوالة" sub="أدخل محفظتك USDT (TRC20) وخذ رابطاً تعطيه لمن يريد أن يرسل لك. يفتح له البوت الحوالة جاهزة بعنوانك." />
      <Section>
        <Field label="محفظتك USDT (TRC20)" error={addr && !TRON.test(addr.trim()) ? "العنوان يبدأ بحرف T وطوله 34 حرفاً." : null}>
          <input dir="ltr" className={`${inputCls} font-mono text-[14px]`} style={inputStyle} placeholder="T…" value={addr} onChange={(e) => { setAddr(e.target.value.trim()); setLink(null); }} />
        </Field>
      </Section>
      {!link && <Btn className="w-full" onClick={make} disabled={!TRON.test(addr.trim())}>أنشئ رابط الاستلام</Btn>}
      {link && (
        <Section title="رابط الاستلام">
          <Copyable value={link} />
          <div className="p-3 text-center"><QrBox value={link} /></div>
          <div className="p-3 pt-0"><Btn className="w-full" onClick={() => open(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("أرسل لي حوالة USDT عبر هذا الرابط:")}`)}>📤 مشاركة الرابط</Btn></div>
        </Section>
      )}
      <Btn kind="ghost" small onClick={onBack}>رجوع</Btn>
    </>
  );
}
