"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// 🏆 مسابقات الجروبات inside the chains bot's Mini App: weekly group and player standings, the live sponsor and its prize, my
// prizes (delivered automatically; «استلم» hands over any that could not reach me), and sponsoring a week (Stars / crypto / USDT).
import React, { useCallback, useEffect, useState } from "react";
import { Btn, Chips, Copyable, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, inputCls, inputStyle, useApp, useInnerBack, useStore } from "./ui";

type Home = {
  bot: string;
  sponsor: { name: string; url: string | null; prize: string | null; endsAt: string } | null;
  groups: { rank: number; title: string; username: string | null; points: number; players: number }[];
  week: { top: { rank: number; name: string; points: number; me: boolean }[]; me: { rank: number | null; points: number; rounds: number } };
  standing: { rank: number | null; points: number; rounds: number; eligible: boolean } | null;
  prizes: { id: string; rank: number; kind: string; status: string; points: number; at: string; sponsor: string; prize: string }[];
  rules: { roundSize: number; correct: number; first: number; minPoints: number; minRounds: number; claimDays: number; sponsorPrice: number; sponsorDays: number; tgPrize: string; premiumStars: number };
};
const GOLD = "#ca8a04";
const medal = (r: number) => ["🥇", "🥈", "🥉"][r - 1] || `${r}`;
const PRIZE_STATUS: Record<string, [string, "ok" | "warn" | "bad" | "neutral" | "info"]> = {
  SENT: ["وصلتك", "ok"], CLAIMED: ["استلمتها", "ok"], CLAIMABLE: ["بانتظار استلامك", "warn"], FAILED_FUNDS: ["محجوزة، تُرسل قريباً", "info"], PENDING: ["قيد الإرسال", "info"], EXPIRED: ["انتهت مدة الاستلام", "neutral"],
};
function left(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "انتهت";
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d} يوم و${h} ساعة` : `${h} ساعة`;
}

export default function ContestsSection() {
  const { api } = useApp();
  const [home, setHome] = useState<Home | null>(null);
  const [view, setView] = useState<"home" | "sponsor">("home");
  const load = useCallback(async () => { const r = await api<Home>("ct_home"); if (r.ok) setHome(r); }, [api]);
  useEffect(() => { void load(); }, [load]);
  useInnerBack(view !== "home", () => setView("home"));
  if (!home) return <><ScreenTitle icon="🏆" title="مسابقات الجروبات" /><Loading /></>;
  if (view === "sponsor") return <Sponsor home={home} />;
  return <ContestHome home={home} onSponsor={() => setView("sponsor")} setPrizes={(prizes) => setHome({ ...home, prizes })} />;
}

function ContestHome({ home, onSponsor, setPrizes }: { home: Home; onSponsor: () => void; setPrizes: (p: Home["prizes"]) => void }) {
  const { api, toast, open } = useApp();
  const [busy, setBusy] = useState(false);
  const pending = home.prizes.filter((p) => p.status === "CLAIMABLE" || p.status === "FAILED_FUNDS");
  const claim = async () => {
    setBusy(true);
    const r = await api<{ prizes: Home["prizes"] }>("ct_claim");
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    setPrizes(r.prizes);
    toast("أرسلنا جوائزك المتاحة إلى محادثة البوت 🎁");
  };
  const st = home.standing;
  const r = home.rules;
  return (
    <>
      <div className="mb-4 overflow-hidden rounded-3xl p-5" style={{ background: `linear-gradient(135deg,${GOLD},#713f12)`, color: "#fff" }}>
        <div className="text-[13px] font-bold opacity-85">🏆 مسابقات الجروبات</div>
        <div className="mt-1 text-[21px] font-black leading-snug">العب مع جروبك واربح</div>
        <p className="mt-1 text-[12.5px] leading-5 opacity-90">جولات من {r.roundSize} أسئلة في جروبك. الإجابة الصحيحة {r.correct} نقاط وأول إجابة صحيحة {r.first}. اللعب مجاني دائماً، والجوائز يموّلها الرعاة وتصل الفائزين تلقائياً.</p>
        <button type="button" onClick={() => open(`https://t.me/${home.bot}?startgroup=contest`)} className="mt-3 w-full rounded-xl bg-white/20 py-2.5 text-sm font-extrabold backdrop-blur active:bg-white/30">➕ أضف البوت لجروبك</button>
      </div>

      {home.sponsor ? (
        <Section title="🎁 جائزة هذا الأسبوع" hint={`الفائزون: أعلى ٣ لاعبين بـ${r.minPoints} نقطة على الأقل في جولتين أو أكثر خلال مدة الرعاية.`}>
          <Row icon="🎁" title={home.sponsor.prize || "جائزة الراعي"} sub={`برعاية ${home.sponsor.name} · تنتهي بعد ${left(home.sponsor.endsAt)}`} onClick={home.sponsor.url ? () => open(home.sponsor!.url!) : undefined} />
          {st && (
            <Row icon={st.eligible ? "✅" : "⏳"} title={st.rank ? `ترتيبك الآن: ${st.rank}` : "لم تلعب في هذه الرعاية بعد"}
              sub={`${st.points} نقطة في ${st.rounds} جولة${st.eligible ? " · مؤهَّل للجائزة" : ` · تحتاج ${Math.max(0, r.minPoints - st.points)} نقطة و${Math.max(0, r.minRounds - st.rounds)} جولة إضافية`}`} />
          )}
        </Section>
      ) : (
        <Section><Row icon="🎁" title="لا رعاية نشطة الآن" sub="الصدارة مستمرة، وأول جهة ترعى الأسبوع تحدد الجائزة." onClick={onSponsor} /></Section>
      )}

      {home.prizes.length > 0 && (
        <Section title="جوائزي" right={pending.length ? <Btn small onClick={claim} disabled={busy}>{busy ? "…" : "🎁 استلم"}</Btn> : undefined}
          hint={pending.length ? `الجوائز غير المستلمة تبقى ${r.claimDays} يوماً.` : undefined}>
          {home.prizes.map((p) => { const s = PRIZE_STATUS[p.status] || [p.status, "neutral"]; return <Row key={p.id} icon={medal(p.rank)} title={p.prize} sub={`${p.sponsor} · ${p.points} نقطة`} right={<Pill tone={s[1]}>{s[0]}</Pill>} />; })}
        </Section>
      )}

      <Section title="لاعبو الأسبوع" hint={home.week.me.rank ? `أنت في المركز ${home.week.me.rank} بـ${home.week.me.points} نقطة.` : "العب جولة في جروبك لتدخل القائمة."}>
        {home.week.top.length === 0 ? <Empty icon="🎯" title="لا نقاط بعد هذا الأسبوع" sub="ابدأوا جولة: /contest في الجروب." /> :
          home.week.top.map((p) => <Row key={p.rank} icon={medal(p.rank)} title={<span>{p.name}{p.me ? " (أنت)" : ""}</span>} right={<span className="text-sm font-extrabold" style={{ color: GOLD }}>{p.points}</span>} />)}
      </Section>

      <Section title="صدارة الجروبات">
        {home.groups.length === 0 ? <Empty icon="👥" title="لا جروبات في الصدارة بعد" /> :
          home.groups.map((g) => <Row key={g.rank} icon={medal(g.rank)} title={g.title} sub={`${g.players} لاعب`} right={<span className="text-sm font-extrabold" style={{ color: GOLD }}>{g.points}</span>} onClick={g.username ? () => open(`https://t.me/${g.username}`) : undefined} />)}
      </Section>

      <Section title="في الجروب">
        <Row icon="▶️" title={`/contest@${home.bot}`} sub="جولة جديدة (لمن بدأها أو لمشرفي الجروب الانتقال للسؤال التالي)." />
        <Row icon="📊" title={`/top@${home.bot}`} sub="صدارة الجروبات هذا الأسبوع." />
      </Section>

      <Section>
        <Row icon="🤝" title="ارعَ أسبوع المسابقات" sub={`${r.sponsorPrice}$ لمدة ${r.sponsorDays} أيام: اسمك وجائزتك في كل جولة ولوحة الصدارة.`} onClick={onSponsor} />
      </Section>
    </>
  );
}

function Sponsor({ home }: { home: Home }) {
  const { api, toast, open, tg, setDirty } = useApp();
  const store = useStore();
  const [code, setCode] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", url: "", contact: "", prizeMode: "TG", prize: "", prizeSecret: "" });
  const [busy, setBusy] = useState(false);
  const [usdt, setUsdt] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  useEffect(() => { void store.get("ct_sponsor").then((v) => { if (v) setCode(v); }); }, [store]);
  const refresh = useCallback(async (check = false) => {
    if (!code) return;
    const r = await api<any>("ct_sponsor_status", { code, check });
    if (r.ok) setStatus(r); else if (r.code !== undefined || r.error) setStatus(null);
  }, [api, code]);
  useEffect(() => { void refresh(); }, [refresh]);
  const set = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };
  const create = async () => {
    setBusy(true);
    const r = await api<{ code: string }>("ct_sponsor", f);
    setBusy(false);
    if (!r.ok) { toast(r.error || "", "err"); return; }
    setDirty(false);
    await store.set("ct_sponsor", r.code);
    setCode(r.code);
  };
  const pay = async (method: "stars" | "nowpayments" | "usdt") => {
    const r = await api<any>("ct_pay", { code, method });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    if (r.manual) { setUsdt(r); return; }
    if (method === "stars" && tg?.openInvoice) tg.openInvoice(r.url, (s: string) => { if (s === "paid") { toast("✅ وصل الدفع، رعايتك مفعّلة."); window.setTimeout(() => void refresh(), 1500); } });
    else open(r.url);
  };
  const s = status?.sponsor;
  if (code && s && s.status !== "PENDING_PAYMENT") {
    return (
      <>
        <ScreenTitle icon="🤝" title={`رعايتك ${s.code}`} />
        <Section>
          <Row icon="✅" title={s.status === "ACTIVE" ? "مفعّلة" : s.status} sub={s.startsAt ? `من ${s.startsAt.slice(0, 10)} إلى ${String(s.endsAt || "").slice(0, 10)}` : undefined} />
          <Row icon="🎁" title={s.prize || "جائزة الراعي"} />
        </Section>
        {status.winners?.length > 0 && <Section title="الفائزون">{status.winners.map((w: any) => <Row key={w.rank} icon={medal(w.rank)} title={w.user_name || "لاعب"} sub={`${w.points} نقطة`} right={<Pill tone={w.status === "SENT" || w.status === "CLAIMED" ? "ok" : "info"}>{PRIZE_STATUS[w.status]?.[0] || w.status}</Pill>} />)}</Section>}
        <Btn kind="ghost" onClick={async () => { await store.set("ct_sponsor", ""); setCode(null); setStatus(null); }}>رعاية جديدة</Btn>
      </>
    );
  }
  if (code && s) {
    return (
      <>
        <ScreenTitle icon="💳" title="ادفع لتفعيل الرعاية" sub={`${s.code} · ${s.price}$`} />
        {!usdt ? (
          <Section title="طريقة الدفع" hint={s.prizeMode === "TG" ? "جائزة تيليجرام تُشترى من نجوم البوت، فتُدفع بالنجوم فقط." : undefined}>
            <Row icon="⭐" title="نجوم تيليجرام" sub="تتفعّل فوراً" onClick={() => pay("stars")} />
            {s.prizeMode !== "TG" && <Row icon="🪙" title="عملات رقمية" sub="صفحة دفع آمنة" onClick={() => pay("nowpayments")} />}
            {s.prizeMode !== "TG" && <Row icon="💵" title="USDT (TRC20)" sub="تتفعّل تلقائياً عند وصول التحويل" onClick={() => pay("usdt")} />}
          </Section>
        ) : (
          <Section title="حوّل USDT (TRC20)" hint={usdt.note}>
            <Copyable label="المبلغ بالضبط" value={String(usdt.amount)} />
            <Copyable label="العنوان" value={usdt.address} />
            <div className="p-3"><Btn className="w-full" onClick={() => void refresh(true)}>✅ تحققت من تحويلي</Btn></div>
          </Section>
        )}
        <Btn kind="ghost" onClick={async () => { await store.set("ct_sponsor", ""); setCode(null); setStatus(null); setUsdt(null); }}>إلغاء وبدء طلب جديد</Btn>
      </>
    );
  }
  const r = home.rules;
  const ready = f.name.trim().length >= 2 && /^@?[A-Za-z][A-Za-z0-9_]{3,31}$/.test(f.contact.trim()) && (f.prizeMode === "TG" || (f.prize.trim().length >= 3 && f.prizeSecret.trim().length >= 3));
  return (
    <>
      <ScreenTitle icon="🤝" title="ارعَ أسبوع المسابقات" sub={`${r.sponsorPrice}$ لمدة ${r.sponsorDays} أيام. اسمك ورابطك وجائزتك في كل جولة ولوحة صدارة، والفائزون يُختارون وتصلهم الجوائز تلقائياً.`} />
      <Section title="الجائزة">
        <div className="p-3"><Chips items={[{ id: "TG", label: "⭐ جائزة تيليجرام" }, { id: "VOUCHER", label: "🎁 جائزتي الخاصة" }]} value={f.prizeMode} onChange={(v) => set("prizeMode", v)} /></div>
        {f.prizeMode === "TG" ? <Row icon="⭐" title={r.tgPrize} sub="تُشترى تلقائياً من النجوم التي تدفعها." /> : (
          <>
            <Field label="الجائزة (تظهر للجميع)"><input className={inputCls} style={inputStyle} maxLength={80} placeholder="كوبون خصم 50٪ من متجرنا" value={f.prize} onChange={(e) => set("prize", e.target.value)} /></Field>
            <Field label="طريقة الاستلام (تصل الفائزين فقط)"><input className={inputCls} style={inputStyle} maxLength={300} placeholder="كود الخصم أو رابط الاستلام" value={f.prizeSecret} onChange={(e) => set("prizeSecret", e.target.value)} /></Field>
          </>
        )}
      </Section>
      <Section>
        <Field label="اسم الجهة الراعية"><input className={inputCls} style={inputStyle} maxLength={60} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="رابط (اختياري)"><input dir="ltr" className={inputCls} style={inputStyle} placeholder="https://" value={f.url} onChange={(e) => set("url", e.target.value.trim())} /></Field>
        <Field label="معرّفك للتواصل"><input dir="ltr" className={inputCls} style={inputStyle} placeholder="@username" value={f.contact} onChange={(e) => set("contact", e.target.value.trim())} /></Field>
      </Section>
      <MainAction text={`التالي: الدفع · ${r.sponsorPrice}$`} onClick={create} disabled={!ready} busy={busy} color={GOLD} />
    </>
  );
}
