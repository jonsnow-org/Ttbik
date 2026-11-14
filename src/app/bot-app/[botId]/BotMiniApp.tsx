"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// The ads & earn bot's own Mini App: it works like the bot (watch & earn, create an ad, my ads, wallet, referrals, stats) and adds
// two sections close to its work: USDT remittances and the channels & groups exchange. Nothing here opens the website.
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppFrame, AppProvider, Btn, Chips, Copyable, Empty, Field, Loading, MainAction, Pill, Row, ScreenTitle, Section, getTg, inputCls, inputStyle, money, moneyCpc, useApp,
  type Lang, type Screen,
} from "./ui";
import { AD_STATUS, TX_LABEL, tr } from "./strings";
import { waitForPhoneVerification } from "@/lib/botApp/phoneVerification";
import RemitSection from "./Remit";
import ExchangeSection from "./Exchange";

type Init = {
  ok: boolean; error?: string; code?: string;
  gate: { channel: string } | null;
  user: { id: string; firstName: string; username: string; lang: Lang; balance: number; phoneVerified: boolean };
  bot: { username: string };
  config: {
    types: { type: string; ar: string; en: string; minCpc: number }[]; minWithdrawal: number; timer: number; contestTarget: number;
    stars: { stars: number; usd: number }[]; crypto: boolean; ton: boolean; chains: { chain: string; label: string }[]; chainMin: number; chainMax: number;
  };
};

export default function BotMiniApp({ botId, section, pay }: { botId: string; section: string; pay: string | null }) {
  const [lang, setLang] = useState<Lang>("ar");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const tg = getTg();
    try { tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.(); } catch { /* old clients */ }
    setReady(true);
  }, []);
  const initial: Screen = section === "home" ? { name: "home" } : { name: section, params: pay ? { pay } : {} };
  return (
    <AppFrame lang={lang}>
      {ready && (
        <AppProvider botId={botId} initial={initial} lang={lang} setLang={setLang}>
          <Shell />
        </AppProvider>
      )}
    </AppFrame>
  );
}

function Shell() {
  const { api, stack, setLang, lang, tg } = useApp();
  const [init, setInit] = useState<Init | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const load = useCallback(async (action = "init"): Promise<Init | null> => {
    const r = (await api<Init>(action)) as Init;
    if (!r.ok) { setFailed(r.error || "تعذّر التحميل"); return null; }
    setFailed(null);
    setInit(r);
    setLang(r.user.lang);
    return r;
  }, [api, setLang]);
  useEffect(() => { void load(); }, [load]);
  // Fresh balance when the user comes back to the app (after paying an invoice, sharing the phone, joining a channel...).
  useEffect(() => {
    const h = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [load]);

  if (!tg?.initData && !init) {
    if (failed) return <div className="mx-auto max-w-md p-4"><Empty icon="📱" title={tr(lang, "outside")} sub={tr(lang, "outsideSub")} /></div>;
  }
  if (failed && !init) return <div className="mx-auto max-w-md p-4"><Empty icon="⚠️" title={failed} action={<Btn onClick={() => void load()}>{tr(lang, "retry")}</Btn>} /></div>;
  if (!init) return <div className="mx-auto max-w-md p-4"><div className="h-36 animate-pulse rounded-3xl" style={{ background: "var(--app-card)" }} /><div className="mt-4"><Loading lines={4} /></div></div>;
  if (init.gate) return <Gate channel={init.gate.channel} onCheck={() => load("gate_check")} />;

  const cur = stack[stack.length - 1];
  const p = cur.params || {};
  const refresh = () => load();
  return (
    <main className="mx-auto max-w-md px-4 pb-6 pt-3">
      {cur.name === "home" && <Home init={init} />}
      {cur.name === "earn" && <Earn init={init} onBalance={refresh} />}
      {cur.name === "create" && <CreateAd init={init} onDone={refresh} />}
      {cur.name === "ads" && <MyAds onChange={refresh} />}
      {cur.name === "wallet" && <Wallet init={init} onChange={refresh} />}
      {cur.name === "referrals" && <Referrals />}
      {cur.name === "stats" && <Stats />}
      {cur.name === "remit" && <RemitSection pay={p.pay || null} />}
      {cur.name === "exchange" && <ExchangeSection username={init.user.username} />}
    </main>
  );
}

function Gate({ channel, onCheck }: { channel: string; onCheck: () => Promise<Init | null> }) {
  const { lang, open } = useApp();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const check = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(lang === "en" ? "Checking your channel membership with Telegram…" : "جارٍ فحص اشتراكك لدى Telegram…");
    const result = await onCheck();
    setNotice(result
      ? result.gate
        ? (lang === "en" ? "Telegram has not confirmed the subscription yet. Join the channel, then check again." : "لم يظهر اشتراكك بعد. تأكد من الانضمام إلى القناة ثم أعد الفحص.")
        : (lang === "en" ? "✅ Subscription confirmed." : "✅ تم تأكيد الاشتراك.")
      : (lang === "en" ? "Could not check membership. Check your connection and try again." : "تعذّر فحص الاشتراك الآن. تحقق من اتصالك وحاول مجدداً."));
    setBusy(false);
  };
  return (
    <main className="mx-auto max-w-md p-4">
      <Empty icon="📢" title={tr(lang, "gateTitle")} sub={`${tr(lang, "gateSub")} @${channel}`}
        action={<div className="flex flex-col gap-2">
          <Btn disabled={busy} onClick={() => open(`https://t.me/${channel}`)}>{tr(lang, "gateJoin")}</Btn>
          <Btn kind="soft" disabled={busy} onClick={() => void check()}>{busy ? (lang === "en" ? "Checking…" : "جارٍ الفحص…") : tr(lang, "gateCheck")}</Btn>
          {notice && <p role="status" aria-live="polite" className="pt-1 text-center text-xs leading-5" style={{ color: "var(--app-hint)" }}>{notice}</p>}
        </div>} />
    </main>
  );
}

function Home({ init }: { init: Init }) {
  const { lang, push, api, setLang } = useApp();
  const tile = (icon: string, title: string, sub: string, to: string) => (
    <button type="button" onClick={() => push({ name: to })} className="rounded-2xl p-3.5 text-start transition active:scale-[0.98]" style={{ background: "var(--app-card)" }}>
      <div className="text-2xl">{icon}</div>
      <div className="mt-1.5 text-[15px] font-extrabold" style={{ color: "var(--app-text)" }}>{title}</div>
      <div className="mt-0.5 text-[11.5px] leading-4" style={{ color: "var(--app-hint)" }}>{sub}</div>
    </button>
  );
  const switchLang = async () => {
    const next: Lang = lang === "en" ? "ar" : "en";
    setLang(next);
    await api("lang", { lang: next });
  };
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-bold" style={{ color: "var(--app-hint)" }}>{tr(lang, "hello")}{init.user.firstName ? ` ${init.user.firstName}` : ""} 👋</div>
        <button type="button" onClick={switchLang} className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--app-chip)", color: "var(--app-link)" }}>🌐 {tr(lang, "language")}</button>
      </div>
      <div className="relative overflow-hidden rounded-3xl p-5 shadow-sm" style={{ background: "linear-gradient(135deg, var(--app-btn), color-mix(in srgb, var(--app-btn) 55%, #111827))", color: "var(--app-btn-text)" }}>
        <div className="text-xs font-bold opacity-80">{tr(lang, "balance")}</div>
        <div className="mt-1 text-4xl font-black tracking-tight" dir="ltr">{money(init.user.balance)}</div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => push({ name: "wallet", params: { tab: "deposit" } })} className="flex-1 rounded-xl bg-white/20 py-2.5 text-sm font-extrabold backdrop-blur active:bg-white/30">＋ {tr(lang, "deposit")}</button>
          <button type="button" onClick={() => push({ name: "wallet", params: { tab: "withdraw" } })} className="flex-1 rounded-xl bg-white/20 py-2.5 text-sm font-extrabold backdrop-blur active:bg-white/30">↗ {tr(lang, "withdraw")}</button>
        </div>
      </div>

      <h2 className="mb-2 mt-5 px-1 text-[13px] font-bold" style={{ color: "var(--app-section-header)" }}>{tr(lang, "adSystem")}</h2>
      <div className="grid grid-cols-2 gap-2.5">
        {tile("👀", tr(lang, "watchEarn"), tr(lang, "watchEarnSub"), "earn")}
        {tile("➕", tr(lang, "createAd"), tr(lang, "createAdSub"), "create")}
        {tile("📢", tr(lang, "myAds"), tr(lang, "myAdsSub"), "ads")}
        {tile("💰", tr(lang, "wallet"), tr(lang, "walletSub"), "wallet")}
        {tile("🙌", tr(lang, "referrals"), tr(lang, "referralsSub"), "referrals")}
        {tile("📊", tr(lang, "stats"), tr(lang, "statsSub"), "stats")}
      </div>

      <h2 className="mb-2 mt-5 px-1 text-[13px] font-bold" style={{ color: "var(--app-section-header)" }}>{tr(lang, "services")}</h2>
      <div className="space-y-2.5">
        <Feature icon="💸" title={tr(lang, "remit")} sub={tr(lang, "remitSub")} tone="#059669" onClick={() => push({ name: "remit" })} />
        <Feature icon="📣" title={tr(lang, "exchange")} sub={tr(lang, "exchangeSub")} tone="#7c3aed" onClick={() => push({ name: "exchange" })} />
      </div>
    </>
  );
}

function Feature({ icon, title, sub, tone, onClick }: { icon: string; title: string; sub: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl p-4 text-start transition active:scale-[0.99]" style={{ background: "var(--app-card)" }}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl" style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-extrabold" style={{ color: "var(--app-text)" }}>{title}</span>
        <span className="mt-0.5 block text-xs leading-5" style={{ color: "var(--app-hint)" }}>{sub}</span>
      </span>
      <span className="text-lg" style={{ color: "var(--app-hint)" }}>‹</span>
    </button>
  );
}

// ----------------------------------------------------------------------------- 👀 Watch & earn
type Card = { id: string; short: string; type: string; platform: string; description: string | null; forced: boolean; reward: number; kind: "join" | "bot" | "visit"; timer: number };
function Earn({ init, onBalance }: { init: Init; onBalance: () => void }) {
  const { lang, api, open, toast, tg } = useApp();
  const [type, setType] = useState<string>(init.config.types[1]?.type || "TELEGRAM");
  const [cards, setCards] = useState<Card[] | null>(null);
  const [state, setState] = useState<Record<string, { until?: number; opened?: boolean; busy?: boolean; done?: number }>>({});
  const [need, setNeed] = useState<{ kind: "phone" | "link"; platform?: string } | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneNotice, setPhoneNotice] = useState("");
  const phoneFlowInFlight = useRef(false);
  const [, tick] = useState(0);
  useEffect(() => { const i = window.setInterval(() => tick((x) => x + 1), 500); return () => window.clearInterval(i); }, []);
  const load = useCallback(async (t: string) => {
    setCards(null);
    const r = await api<{ ads: Card[] }>("earn_list", { type: t });
    setCards(r.ok ? r.ads : []);
    if (!r.ok) toast(r.error || "", "err");
  }, [api, toast]);
  useEffect(() => { void load(type); }, [type, load]);
  useEffect(() => {
    if (init.user.phoneVerified) setNeed((current) => current?.kind === "phone" ? null : current);
  }, [init.user.phoneVerified]);

  // Keep the latest state in a ref: the focus listeners must not depend on
  // state itself, otherwise every countdown update re-registers them and can
  // repeatedly query the server while the user is merely watching the timer.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => {
    let syncing = false;
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      try {
        const ids = Object.entries(stateRef.current).filter(([, v]) => v.opened && v.done == null).map(([id]) => id);
        for (const adId of ids) {
          const r = await api<{ started: boolean; remainingSeconds: number }>("earn_status", { adId });
          if (!r.ok) continue;
          setState((current) => {
            const old = current[adId];
            if (!old?.opened || old.done != null) return current;
            const now = Date.now();
            const until = r.started ? now + r.remainingSeconds * 1000 : undefined;
            const localRemaining = old.until == null ? null : Math.max(0, Math.ceil((old.until - now) / 1000));
            if ((!r.started && old.until == null) || (r.started && localRemaining === r.remainingSeconds)) return current;
            return { ...current, [adId]: { ...old, until } };
          });
        }
      } finally {
        syncing = false;
      }
    };
    const onReturn = () => { if (document.visibilityState === "visible") void sync(); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onReturn); };
  }, [api]);

  const doOpen = async (c: Card) => {
    const r = await api<{ url: string; timer: number }>("earn_open", { adId: c.id });
    if (!r.ok) { toast(r.error || "", "err"); setCards((x) => x?.filter((y) => y.id !== c.id) || x); return; }
    setState((s) => ({ ...s, [c.id]: { ...s[c.id], opened: true, until: r.timer === 0 ? Date.now() : undefined } }));
    open(r.url);
  };
  const doVerify = async (c: Card) => {
    if (c.timer > 0) {
      const status = await api<{ started: boolean; remainingSeconds: number }>("earn_status", { adId: c.id });
      if (!status.ok) { toast(status.error || "", "err"); return; }
      if (!status.started || status.remainingSeconds > 0) {
        setState((s) => ({ ...s, [c.id]: { ...s[c.id], opened: true, until: status.started ? Date.now() + status.remainingSeconds * 1000 : undefined } }));
        toast(status.started ? `${tr(lang, "wait")} ${status.remainingSeconds}${tr(lang, "sec")}` : tr(lang, "openFirst"), "err");
        return;
      }
    }
    setState((s) => ({ ...s, [c.id]: { ...s[c.id], busy: true } }));
    const r = await api<{ reward: number; balance: number; platform?: string }>("earn_verify", { adId: c.id });
    setState((s) => ({ ...s, [c.id]: { ...s[c.id], busy: false } }));
    if (r.ok) {
      setState((s) => ({ ...s, [c.id]: { done: r.reward } }));
      toast(`+${moneyCpc(r.reward)} ${tr(lang, "earned")}`);
      onBalance();
      window.setTimeout(() => setCards((x) => x?.filter((y) => y.id !== c.id) || x), 1400);
      return;
    }
    if (r.code === "phone") { setNeed({ kind: "phone" }); return; }
    toast(r.error || "", "err");
    if (["gone", "already_claimed", "own", "flagged"].includes(String(r.code))) setCards((x) => x?.filter((y) => y.id !== c.id) || x);
  };
  const skip = (c: Card) => setCards((x) => x ? [...x.filter((y) => y.id !== c.id)] : x);
  const report = async (c: Card) => {
    const r = await api<{ message: string }>("earn_report", { adId: c.id });
    toast(r.ok ? r.message : r.error || "", r.ok ? "ok" : "err");
    if (r.ok) skip(c);
  };
  const checkPhone = async (alreadyLocked = false) => {
    if (!alreadyLocked) {
      if (phoneFlowInFlight.current) return;
      phoneFlowInFlight.current = true;
    }
    setPhoneBusy(true);
    setPhoneNotice(lang === "en" ? "Waiting for Telegram to confirm your number…" : "جارٍ التأكد من وصول رقمك إلى البوت…");
    const verified = await waitForPhoneVerification(async () => {
      const r = await api<Init>("init");
      return { ok: !!r.ok, phoneVerified: !!r.ok && r.user?.phoneVerified === true };
    }, { attempts: 25, intervalMs: 1_000 });
    phoneFlowInFlight.current = false;
    setPhoneBusy(false);
    if (verified) {
      setNeed(null);
      setPhoneNotice("");
      toast(lang === "en" ? "Phone number verified ✓" : "✅ تم التحقق من رقم هاتفك.");
      onBalance();
    } else {
      setPhoneNotice(lang === "en"
        ? "The bot has not confirmed your number yet. Share it in the bot chat, then tap Check again."
        : "لم يصل تأكيد المشاركة بعد. افتح محادثة البوت وشارك رقمك من زر تيليجرام الرسمي، ثم اضغط «تحقّق» هنا.");
    }
  };
  const sharePhone = () => {
    if (phoneFlowInFlight.current) return;
    // Feature-detect requestContact directly; do not depend on an optional version helper.
    if (typeof tg?.requestContact === "function") {
      phoneFlowInFlight.current = true;
      setPhoneBusy(true);
      setPhoneNotice(lang === "en" ? "Complete Telegram's phone-sharing prompt…" : "أكمل نافذة Telegram لمشاركة رقم هاتفك…");
      try {
        tg.requestContact((sent: boolean) => {
          if (!sent) {
            phoneFlowInFlight.current = false;
            setPhoneBusy(false);
            setPhoneNotice(lang === "en" ? "The phone number was not shared. You can try again." : "لم تتم مشاركة رقم الهاتف. يمكنك المحاولة مجدداً.");
            return;
          }
          void checkPhone(true);
        });
        return;
      } catch {
        phoneFlowInFlight.current = false;
        setPhoneBusy(false);
      }
    }
    void (async () => {
      const r = await api("phone_prompt");
      if (!r.ok) {
        toast(r.error || (lang === "en" ? "Could not open phone sharing." : "تعذّر إرسال طلب مشاركة الرقم."), "err");
        return;
      }
      setPhoneNotice(lang === "en"
        ? "A phone-sharing button was sent to the bot chat. Share your number there, then return and tap Check."
        : "أرسلنا زر مشاركة الرقم إلى محادثة البوت. شارك رقمك هناك، ثم ارجع واضغط «تحقّق».");
    })();
  };

  return (
    <>
      <ScreenTitle icon="👀" title={tr(lang, "watchEarn")} sub={tr(lang, "watchEarnSub")} />
      <div className="mb-3"><Chips wrap={false} items={init.config.types.map((x) => ({ id: x.type, label: lang === "en" ? x.en : x.ar }))} value={type} onChange={setType} /></div>
      {need?.kind === "phone" && (
        <Section>
          <Empty icon="📱" title={tr(lang, "phoneTitle")} sub={tr(lang, "phoneSub")}
            action={<div className="flex flex-col gap-2">
              <Btn disabled={phoneBusy} onClick={sharePhone}>{phoneBusy ? (lang === "en" ? "Checking…" : "جارٍ التحقق…") : tr(lang, "phoneBtn")}</Btn>
              <Btn kind="soft" disabled={phoneBusy} onClick={() => void checkPhone()}>{lang === "en" ? "I shared it — check" : "شاركته، تحقّق"}</Btn>
              {phoneNotice && <p role="status" aria-live="polite" className="pt-1 text-center text-xs leading-5" style={{ color: "var(--app-hint)" }}>{phoneNotice}</p>}
            </div>} />
        </Section>
      )}
      {need?.kind === "link" && (
        <Section><Empty icon="🔗" title={tr(lang, "linkTitle")} sub={need.platform ? need.platform.toUpperCase() : ""}
          action={<Btn onClick={async () => { const r = await api("link_account", { platform: need.platform }); toast(r.ok ? tr(lang, "linkSent") : r.error || "", r.ok ? "ok" : "err"); setNeed(null); }}>{tr(lang, "linkBtn")}</Btn>} /></Section>
      )}
      {!cards && <Loading lines={3} />}
      {cards && cards.length === 0 && <Section><Empty icon="🌙" title={tr(lang, "noAds")} sub={tr(lang, "noAdsSub")} /></Section>}
      <div className="space-y-3">
        {cards?.map((c) => {
          const st = state[c.id] || {};
          const left = st.until != null ? Math.max(0, Math.ceil((st.until - Date.now()) / 1000)) : null;
          return (
            <div key={c.id} className="rounded-2xl p-4" style={{ background: "var(--app-card)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-extrabold">{c.platform} <span className="font-mono text-[11px] opacity-50">#{c.short}</span></span>
                {c.forced ? <Pill>{tr(lang, "forced")}</Pill> : <Pill tone="ok">+{moneyCpc(c.reward)}</Pill>}
              </div>
              {c.description && <p className="mt-2 whitespace-pre-line text-[14px] leading-6">{c.description}</p>}
              {st.done != null ? (
                <div className="mt-3 rounded-xl py-2.5 text-center text-sm font-extrabold" style={{ background: "#dcfce7", color: "#166534" }}>✓ +{moneyCpc(st.done)}</div>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn onClick={() => doOpen(c)} kind={st.opened ? "soft" : "primary"} className="flex-1">{c.kind === "join" ? `📢 ${tr(lang, "join")}` : `🔗 ${tr(lang, "open")}`}{c.timer ? ` (${c.timer}${tr(lang, "sec")})` : ""}</Btn>
                  {!c.forced && (
                    <Btn onClick={() => doVerify(c)} disabled={st.busy || (left != null && left > 0) || (c.timer > 0 && (!st.opened || st.until == null))} className="flex-1">
                      {left != null && left > 0 ? `⏳ ${tr(lang, "wait")} ${left}${tr(lang, "sec")}` : c.timer > 0 && !st.until ? tr(lang, "openFirst") : `✅ ${tr(lang, "verify")}`}
                    </Btn>
                  )}
                  <div className="flex w-full justify-between">
                    <Btn kind="ghost" small onClick={() => skip(c)}>{tr(lang, "skip")} ←</Btn>
                    <Btn kind="ghost" small onClick={() => report(c)}>🚩 {tr(lang, "report")}</Btn>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {cards && cards.length > 0 && <div className="mt-3 text-center"><Btn kind="ghost" small onClick={() => load(type)}>↻</Btn></div>}
    </>
  );
}

// ----------------------------------------------------------------------------- ➕ Create an ad
function CreateAd({ init, onDone }: { init: Init; onDone: () => void }) {
  const { lang, api, toast, setDirty, reset, push } = useApp();
  const [f, setF] = useState({ type: "TELEGRAM", scope: "TARGETED", description: "", target: "", budget: "", cpc: "" });
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [short, setShort] = useState(false);
  const [preview, setPreview] = useState(false);
  const t = init.config.types.find((x) => x.type === f.type)!;
  const set = (k: keyof typeof f, v: string) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); setErr(null); };
  const budget = Number(f.budget.replace(",", ".")) || 0;
  const cpc = Number(f.cpc.replace(",", ".")) || 0;
  const est = budget > 0 && cpc > 0 ? Math.floor(budget / cpc) : 0;
  const ready = f.description.trim() && f.target.trim() && budget > 0 && cpc >= t.minCpc && cpc <= budget;
  const checkTarget = async () => {
    if (!f.target.trim()) return;
    const r = await api<{ note?: string | null }>("ad_check_target", { type: f.type, target: f.target });
    if (!r.ok) setErr(r.error || null); else setNote(r.note || null);
  };
  const submit = async () => {
    setBusy(true);
    const r = await api<{ budget: number }>("ad_create", { ...f, budget, cpc });
    setBusy(false);
    if (r.ok) { toast(tr(lang, "launched")); setDirty(false); onDone(); reset({ name: "ads" }); return; }
    setErr(r.error || null);
    setShort(r.code === "insufficient");
  };
  return (
    <>
      <ScreenTitle icon="➕" title={tr(lang, "createAd")} sub={tr(lang, "createAdSub")} />
      <Section title={tr(lang, "platform")}>
        <div className="p-3"><Chips items={init.config.types.map((x) => ({ id: x.type, label: lang === "en" ? x.en : x.ar }))} value={f.type} onChange={(v) => { set("type", v); setNote(null); }} /></div>
      </Section>
      <Section title={tr(lang, "scope")} hint={f.scope === "GLOBAL" ? (lang === "en" ? "Shown in every bot on the platform: more reach." : "يظهر في كل بوتات المنصة: وصول أكبر.") : (lang === "en" ? "Shown to this bot's users first." : "يظهر لمستخدمي هذا البوت أولاً.")}>
        <div className="p-3"><Chips items={[{ id: "TARGETED", label: tr(lang, "scopeTargeted") }, { id: "GLOBAL", label: tr(lang, "scopeGlobal") }]} value={f.scope} onChange={(v) => set("scope", v)} /></div>
      </Section>
      {f.type !== "TELEGRAM" && <p className="mb-3 rounded-xl px-3 py-2 text-xs leading-5" style={{ background: "var(--app-chip)", color: "var(--app-hint)" }}>{tr(lang, "visitOnlyHint")}</p>}
      <Section>
        <Field label={tr(lang, "description")}>
          <textarea rows={3} maxLength={600} className={`${inputCls} resize-none`} style={inputStyle} placeholder={tr(lang, "descriptionPh")} value={f.description} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field label={tr(lang, "target")} hint={note || undefined}>
          <input dir="ltr" className={inputCls} style={inputStyle} placeholder={f.type === "TELEGRAM" ? tr(lang, "targetTg") : "https://"} value={f.target} onChange={(e) => { set("target", e.target.value); setNote(null); }} onBlur={checkTarget} />
        </Field>
        <Field label={tr(lang, "budget")}>
          <input dir="ltr" inputMode="decimal" className={inputCls} style={inputStyle} placeholder="10" value={f.budget} onChange={(e) => set("budget", e.target.value)} />
        </Field>
        <Field label={tr(lang, "cpc")} hint={`${tr(lang, "minCpc")}: ${moneyCpc(t.minCpc)}`}>
          <input dir="ltr" inputMode="decimal" className={inputCls} style={inputStyle} placeholder={String(t.minCpc)} value={f.cpc} onChange={(e) => set("cpc", e.target.value)} />
        </Field>
      </Section>
      <Section title={lang === "en" ? "Campaign estimate" : "ملخص حملتك قبل الإطلاق"}>
        <Row icon="🎯" title={`${tr(lang, "estClicks")}: ${est}`} sub={lang === "en" ? `Up to ${est} completed tasks, if all the budget is spent.` : `حتى ${est} مهمة مكتملة عند استهلاك الميزانية؛ العدد تقديري وليس مضموناً.`} />
        <Row icon="🧑‍💻" title={lang === "en" ? `Worker reward per completed task: ${moneyCpc(cpc * 0.5)}` : `مكافأة المستخدم عن كل مهمة مكتملة: ${moneyCpc(cpc * 0.5)}`} sub={lang === "en" ? "50% of the task price goes to the worker." : "يصل 50% من تكلفة المهمة إلى المستخدم الذي يكملها."} />
        <Row icon="📊" title={lang === "en" ? `Estimated worker pool: ${moneyCpc(est * cpc * 0.5)}` : `إجمالي مكافآت المستخدمين التقديري: ${moneyCpc(est * cpc * 0.5)}`} sub={lang === "en" ? `Estimated unused balance: ${moneyCpc(Math.max(0, budget - est * cpc))}.` : `المتبقي المتوقع من الميزانية بعد توزيع المهام: ${moneyCpc(Math.max(0, budget - est * cpc))}.`} />
        <Row icon="💰" title={`${tr(lang, "balance")}: ${money(init.user.balance)}`} right={budget > init.user.balance ? <Btn small onClick={() => push({ name: "wallet", params: { tab: "deposit" } })}>{tr(lang, "topUp")}</Btn> : null} />
      </Section>
      <p className="mb-3 px-1 text-[11px] leading-5" style={{ color: "var(--app-hint)" }}>{lang === "en" ? "The 50% worker share is credited only after a task passes server verification. Opening a link alone is not a paid completion." : "تُضاف حصة المستخدم (50%) بعد اجتياز التحقق من المهمة على الخادم. مجرد فتح الرابط لا يُعد إكمالاً مدفوعاً."}</p>
      {err && <p className="mb-2 px-1 text-sm font-bold" style={{ color: "var(--app-danger)" }}>{err}</p>}
      {short && <Btn className="mb-2 w-full" kind="soft" onClick={() => push({ name: "wallet", params: { tab: "deposit" } })}>{tr(lang, "topUp")}</Btn>}
      <Btn className="mb-2 w-full" kind="soft" disabled={!f.description.trim() || !f.target.trim()} onClick={() => setPreview((v) => !v)}>{preview ? (lang === "en" ? "Hide ad preview" : "إخفاء المعاينة") : (lang === "en" ? "Preview how users will see the ad" : "👁 معاينة بطاقة الإعلان للمستخدمين")}</Btn>
      {preview && <Section title={lang === "en" ? "User-facing card preview" : "هكذا ستظهر بطاقتك للمستخدم"}>
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--app-sep)", background: "var(--app-card)" }}>
          <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-sm">{t[lang === "en" ? "en" : "ar"]}</strong><Pill tone="info">{f.scope === "GLOBAL" ? (lang === "en" ? "Global" : "عام") : (lang === "en" ? "Targeted" : "موجّه")}</Pill></div>
          <p className="whitespace-pre-wrap break-words text-sm leading-6" dir="auto">{f.description}</p>
          <div className="mt-3 flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--app-hint)" }}><span dir="ltr" className="min-w-0 break-all">{f.target}</span><span className="shrink-0 font-bold">{moneyCpc(cpc * 0.5)}</span></div>
          <p className="mt-2 text-[10px]" style={{ color: "var(--app-hint)" }}>{lang === "en" ? "Reward shown is the worker share after successful verification." : "المبلغ الظاهر هو مكافأة المستخدم بعد إتمام المهمة والتحقق منها."}</p>
        </div>
      </Section>}
      <MainAction text={`${tr(lang, "confirmAd")} · ${money(budget)}`} onClick={submit} disabled={!ready} busy={busy} />
    </>
  );
}

// ----------------------------------------------------------------------------- 📢 My ads
type MyAd = { id: string; short: string; type: string; platform: string; status: string; description: string | null; content: string; cpc: number; total: number; remaining: number; spent: number; clicks: number; scope: string };
function MyAds({ onChange }: { onChange: () => void }) {
  const { lang, api, toast, confirm, push } = useApp();
  const [ads, setAds] = useState<MyAd[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [topup, setTopup] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await api<{ ads: MyAd[] }>("my_ads"); if (r.ok) { setAds(r.ads); setLoadError(null); } else setLoadError(r.error || "تعذّر تحميل الحملات."); }, [api]);
  useEffect(() => { void load(); }, [load]);
  const op = async (a: MyAd, o: string, amount?: string) => {
    if (o === "cancel" && !(await confirm(lang === "en" ? `Cancel and refund ${money(a.remaining)}?` : `إلغاء الحملة واسترداد ${money(a.remaining)} لرصيدك؟`))) return;
    if (o === "delete" && !(await confirm(lang === "en" ? "Delete this campaign?" : "حذف الحملة نهائياً؟"))) return;
    const r = await api<{ message: string }>("ad_op", { adId: a.id, op: o, amount });
    toast(r.ok ? r.message : r.error || "", r.ok ? "ok" : "err");
    if (r.ok) { setTopup(""); onChange(); void load(); }
  };
  return (
    <>
      <ScreenTitle icon="📢" title={tr(lang, "myAds")} sub={tr(lang, "myAdsSub")} />
      {!ads && !loadError && <Loading />}
      {!ads && loadError && <Section><Empty icon="⚠️" title={lang === "en" ? "Could not load campaigns" : "تعذّر تحميل الحملات"} sub={loadError} action={<Btn onClick={() => void load()}>↻ {lang === "en" ? "Retry" : "إعادة المحاولة"}</Btn>} /></Section>}
      {ads && ads.length === 0 && <Section><Empty icon="📭" title={tr(lang, "emptyAds")} sub={tr(lang, "emptyAdsSub")} action={<Btn onClick={() => push({ name: "create" })}>➕ {tr(lang, "createAd")}</Btn>} /></Section>}
      <div className="space-y-3">
        {ads?.map((a) => {
          const s = AD_STATUS[a.status] || [a.status, a.status, "neutral"];
          const pct = a.total > 0 ? Math.min(100, Math.round((a.spent / a.total) * 100)) : 0;
          const isOpen = openId === a.id;
          return (
            <div key={a.id} className="rounded-2xl p-4" style={{ background: "var(--app-card)" }}>
              <button type="button" className="w-full text-start" onClick={() => setOpenId(isOpen ? null : a.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-extrabold">{a.platform} <span className="font-mono text-[11px] opacity-50">#{a.short}</span></span>
                  <Pill tone={s[2]}>{lang === "en" ? s[1] : s[0]}</Pill>
                </div>
                {a.description && <p className="mt-1 line-clamp-2 text-[13px] leading-5" style={{ color: "var(--app-hint)" }}>{a.description}</p>}
                <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--app-chip)" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--app-btn)" }} /></div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]" style={{ color: "var(--app-hint)" }}>
                  <div><div className="text-[15px] font-extrabold" style={{ color: "var(--app-text)" }}>{a.clicks}</div>{tr(lang, "clicks")}</div>
                  <div><div className="text-[15px] font-extrabold" style={{ color: "var(--app-text)" }} dir="ltr">{money(a.spent)}</div>{tr(lang, "spent")}</div>
                  <div><div className="text-[15px] font-extrabold" style={{ color: "var(--app-text)" }} dir="ltr">{money(a.remaining)}</div>{tr(lang, "remaining")}</div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10.5px]" style={{ color: "var(--app-hint)" }}>
                  <span>{lang === "en" ? "Budget used" : "المستهلك من الميزانية"}</span>
                  <span className="font-bold" dir="ltr">{pct}%</span>
                </div>
              </button>
              {isOpen && (
                <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: "var(--app-sep)" }}>
                  <div className="text-xs" style={{ color: "var(--app-hint)" }} dir="ltr">{a.content} · {moneyCpc(a.cpc)}</div>
                  <div className="grid grid-cols-2 gap-2 rounded-xl p-3 text-[11px]" style={{ background: "var(--app-chip)" }}>
                    <div><div style={{ color: "var(--app-hint)" }}>مكافأة المستخدم/مهمة</div><strong>{moneyCpc(a.cpc * 0.5)}</strong></div>
                    <div><div style={{ color: "var(--app-hint)" }}>مهام متوقعة بالمتبقي</div><strong>{Math.floor(a.remaining / a.cpc)}</strong></div>
                    <div><div style={{ color: "var(--app-hint)" }}>متوسط التكلفة الفعلي</div><strong>{a.clicks > 0 ? moneyCpc(a.spent / a.clicks) : "—"}</strong></div>
                    <div><div style={{ color: "var(--app-hint)" }}>نطاق الحملة</div><strong>{a.scope === "GLOBAL" ? "عام" : "موجّه"}</strong></div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {a.status === "ACTIVE" && <Btn small kind="soft" onClick={() => op(a, "pause")}>⏸ {tr(lang, "pause")}</Btn>}
                    {a.status === "PAUSED" && <Btn small kind="soft" onClick={() => op(a, "resume")}>▶ {tr(lang, "resume")}</Btn>}
                    {["ACTIVE", "PAUSED", "EXPIRED"].includes(a.status) && <Btn small kind="danger" onClick={() => op(a, "cancel")}>✖ {tr(lang, "cancelAd")}</Btn>}
                    {["CANCELLED", "REJECTED"].includes(a.status) && <Btn small kind="danger" onClick={() => op(a, "delete")}>🗑 {tr(lang, "deleteAd")}</Btn>}
                  </div>
                  {["ACTIVE", "PAUSED", "EXPIRED"].includes(a.status) && (
                    <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--app-chip)" }}>
                      <input dir="ltr" inputMode="decimal" className={inputCls} style={inputStyle} placeholder={`${tr(lang, "topupAd")} ($)`} value={topup} onChange={(e) => setTopup(e.target.value)} />
                      <Btn small onClick={() => op(a, "topup", topup)} disabled={!(Number(topup) > 0)}>{tr(lang, "topupAd")}</Btn>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ----------------------------------------------------------------------------- 💰 Wallet
function Wallet({ init, onChange }: { init: Init; onChange: () => void }) {
  const { lang, api, toast, open, tg, stack, setDirty } = useApp();
  const startTab = stack[stack.length - 1]?.params?.tab === "withdraw" ? "withdraw" : stack[stack.length - 1]?.params?.tab === "deposit" ? "deposit" : "history";
  const [tab, setTab] = useState<"deposit" | "withdraw" | "history">(startTab);
  const [w, setW] = useState<{ balance: number; txs: { id: string; amount: number; type: string; status: string; at: string }[] } | null>(null);
  const [cryptoAmt, setCryptoAmt] = useState("10");
  const [ton, setTon] = useState<{ address: string; memo: string } | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [chainUsd, setChainUsd] = useState("");
  const [chainReq, setChainReq] = useState<{ address: string; amount: string; asset: string; usd: number; expiresInMin: number } | null>(null);
  const [wd, setWd] = useState({ address: "", amount: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api<any>("wallet"); if (r.ok) setW(r); }, [api]);
  useEffect(() => { void load(); }, [load]);
  const stars = async (n: number) => {
    const r = await api<{ link: string }>("deposit_stars", { stars: n });
    if (!r.ok) { toast(r.error || "", "err"); return; }
    if (tg?.openInvoice) tg.openInvoice(r.link, (status: string) => { if (status === "paid") { toast("✓"); window.setTimeout(() => { onChange(); void load(); }, 1500); } });
    else open(r.link);
  };
  const crypto = async () => {
    const r = await api<{ url: string }>("deposit_crypto", { amount: Number(cryptoAmt) });
    if (r.ok) open(r.url); else toast(r.error || "", "err");
  };
  const chainCheck = async () => {
    const r = await api<{ credited: number; pending: number; readFailed: boolean; balance: number }>("deposit_chain_check");
    if (!r.ok) { toast(r.error || "", "err"); return; }
    if (r.credited > 0) { toast(`✓ +${money(r.credited)}`); setChainReq(null); onChange(); void load(); }
    else toast(r.pending === 0 ? "لا يوجد طلب إيداع مفتوح." : r.readFailed ? "تعذّر قراءة الشبكة الآن، حاول بعد دقائق." : "لم يصل تحويل مطابق بعد. انتظر تأكيد الشبكة ثم أعد التحقق.", "err");
  };
  const withdraw = async () => {
    setBusy(true);
    const r = await api<{ message: string }>("withdraw", { address: wd.address, amount: wd.amount });
    setBusy(false);
    if (r.ok) { toast(r.message); setWd({ address: "", amount: "" }); setDirty(false); onChange(); void load(); setTab("history"); }
    else toast(r.error || "", "err");
  };
  const bal = w?.balance ?? init.user.balance;
  return (
    <>
      <ScreenTitle icon="💰" title={tr(lang, "wallet")} />
      <div className="mb-4 rounded-3xl p-5 text-center" style={{ background: "var(--app-card)" }}>
        <div className="text-xs font-bold" style={{ color: "var(--app-hint)" }}>{tr(lang, "balance")}</div>
        <div className="mt-1 text-4xl font-black" dir="ltr">{money(bal)}</div>
      </div>
      <div className="mb-4"><Chips items={[{ id: "deposit", label: `＋ ${tr(lang, "deposit")}` }, { id: "withdraw", label: `↗ ${tr(lang, "withdraw")}` }, { id: "history", label: `🧾 ${tr(lang, "history")}` }]} value={tab} onChange={(v) => setTab(v as any)} /></div>

      {tab === "deposit" && (
        <>
          <Section title={`⭐ ${tr(lang, "depositStars")}`} hint={tr(lang, "depositStarsSub")}>
            <div className="grid grid-cols-2 gap-2 p-3">
              {init.config.stars.map((s) => (
                <button key={s.stars} type="button" onClick={() => stars(s.stars)} className="rounded-xl py-3 text-sm font-extrabold active:scale-95" style={{ background: "var(--app-chip)", color: "var(--app-text)" }}>⭐ {s.stars}<span className="block text-[11px] font-bold" style={{ color: "var(--app-hint)" }} dir="ltr">{money(s.usd)}</span></button>
              ))}
            </div>
          </Section>
          {init.config.crypto && (
            <Section title={`🪙 ${tr(lang, "depositCrypto")}`} hint={tr(lang, "depositCryptoSub")}>
              <div className="flex items-center gap-2 p-3">
                <input dir="ltr" inputMode="decimal" className={`${inputCls} rounded-xl px-3 py-2`} style={{ ...inputStyle, background: "var(--app-chip)" }} value={cryptoAmt} onChange={(e) => setCryptoAmt(e.target.value)} />
                <Btn onClick={crypto} disabled={!(Number(cryptoAmt) >= 1)}>{tr(lang, "pay")} {money(Number(cryptoAmt) || 0)}</Btn>
              </div>
            </Section>
          )}
          {init.config.ton && (
            <Section title={`💎 ${tr(lang, "depositTon")}`}>
              {!ton ? <div className="p-3"><Btn kind="soft" className="w-full" onClick={async () => { const r = await api<any>("deposit_ton"); if (r.ok) setTon(r); else toast(r.error || "", "err"); }}>{lang === "en" ? "Show address" : "أظهر العنوان"}</Btn></div> : (
                <><Copyable label={tr(lang, "address")} value={ton.address} /><Copyable label={tr(lang, "memo")} value={ton.memo} /></>
              )}
            </Section>
          )}
          {init.config.chains.length > 0 && (
            <Section title={`🔗 ${tr(lang, "depositChain")}`} hint={lang === "en" ? "Send the exact amount shown (with its decimals) so it is credited automatically." : "أرسل المبلغ بالضبط كما يظهر (بكسوره) ليُحتسب تلقائياً، ثم اضغط «تحققت من تحويلي»."}>
              {!chainReq ? (
                <div className="space-y-3 p-3">
                  <Chips items={init.config.chains.map((c) => ({ id: c.chain, label: c.label }))} value={chain} onChange={setChain} />
                  {chain && (
                    <div className="flex items-center gap-2">
                      <input dir="ltr" inputMode="decimal" className={`${inputCls} rounded-xl px-3 py-2`} style={{ ...inputStyle, background: "var(--app-chip)" }} placeholder={`${init.config.chainMin}–${init.config.chainMax} $`} value={chainUsd} onChange={(e) => setChainUsd(e.target.value)} />
                      <Btn onClick={async () => { const r = await api<any>("deposit_chain", { chain, usd: chainUsd }); if (r.ok) setChainReq(r.request); else toast(r.error || "", "err"); }}>{lang === "en" ? "Get address" : "احصل على العنوان"}</Btn>
                    </div>
                  )}
                  <Btn kind="ghost" small onClick={chainCheck}>✅ {tr(lang, "checkDeposit")}</Btn>
                </div>
              ) : (
                <>
                  <Copyable label={`${tr(lang, "amount")} (${chainReq.asset})`} value={chainReq.amount} />
                  <Copyable label={tr(lang, "address")} value={chainReq.address} />
                  <div className="p-3 text-xs" style={{ color: "var(--app-hint)" }}>⏳ {chainReq.expiresInMin} {lang === "en" ? "min" : "دقيقة"} · {money(chainReq.usd)}</div>
                  <div className="p-3 pt-0"><Btn className="w-full" onClick={chainCheck}>✅ {tr(lang, "checkDeposit")}</Btn></div>
                </>
              )}
            </Section>
          )}
        </>
      )}

      {tab === "withdraw" && (
        <>
          <Section hint={tr(lang, "withdrawNote")}>
            <Field label={tr(lang, "withdrawAddr")}>
              <input dir="ltr" className={inputCls} style={inputStyle} placeholder="T… / UQ…" value={wd.address} onChange={(e) => { setWd((s) => ({ ...s, address: e.target.value.trim() })); setDirty(true); }} />
            </Field>
            <Field label={`${tr(lang, "amount")} ($)`} hint={`${tr(lang, "withdrawMin")}: ${money(init.config.minWithdrawal)}`}>
              <div className="flex items-center gap-2">
                <input dir="ltr" inputMode="decimal" className={inputCls} style={inputStyle} placeholder="5" value={wd.amount} onChange={(e) => { setWd((s) => ({ ...s, amount: e.target.value })); setDirty(true); }} />
                <Btn small kind="soft" onClick={() => setWd((s) => ({ ...s, amount: String(Math.floor(bal * 100) / 100) }))}>MAX</Btn>
              </div>
            </Field>
          </Section>
          <MainAction text={tr(lang, "sendWithdraw")} onClick={withdraw} busy={busy} disabled={wd.address.length < 10 || !(Number(wd.amount) >= init.config.minWithdrawal) || Number(wd.amount) > bal} />
        </>
      )}

      {tab === "history" && (
        <Section title={tr(lang, "history")}>
          {!w && <div className="p-3"><Loading lines={2} /></div>}
          {w && w.txs.length === 0 && <Empty icon="🧾" title={tr(lang, "noHistory")} />}
          {w?.txs.map((x) => {
            const minus = ["WITHDRAWAL", "AD_PAYMENT", "OWNER_WITHDRAWAL"].includes(x.type);
            const label = TX_LABEL[x.type]?.[lang === "en" ? 1 : 0] || x.type;
            return <Row key={x.id} icon={minus ? "↗" : "↘"} title={label} sub={`${new Date(x.at).toLocaleString(lang === "en" ? "en-GB" : "ar")} · ${x.status}`} right={<span className="text-sm font-extrabold" dir="ltr" style={{ color: minus ? "var(--app-danger)" : "#059669" }}>{minus ? "−" : "+"}{x.amount < 0.01 ? moneyCpc(x.amount) : money(x.amount)}</span>} />;
          })}
        </Section>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------- 🙌 Referrals / 📊 Stats
function Referrals() {
  const { lang, api, open } = useApp();
  const [r, setR] = useState<{ count: number; won: boolean; full: boolean; target: number; link: string } | null>(null);
  useEffect(() => { void api<any>("referrals").then((x) => { if (x.ok) setR(x); }); }, [api]);
  const pct = r ? Math.min(100, Math.round((r.count / r.target) * 100)) : 0;
  const shareText = lang === "en" ? "Earn by completing simple tasks in this bot:" : "اربح بإنجاز مهام بسيطة في هذا البوت:";
  return (
    <>
      <ScreenTitle icon="🙌" title={tr(lang, "referrals")} sub={tr(lang, "refEarn")} />
      {!r ? <Loading lines={2} /> : (
        <>
          <div className="mb-4 rounded-3xl p-5 text-center" style={{ background: "var(--app-card)" }}>
            <div className="text-5xl font-black">{r.count}</div>
            <div className="mt-1 text-xs font-bold" style={{ color: "var(--app-hint)" }}>{tr(lang, "invited")}</div>
            <div className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: "var(--app-chip)" }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#f59e0b" }} /></div>
            <div className="mt-2 text-xs leading-5" style={{ color: "var(--app-hint)" }}>🏆 {tr(lang, "contest")} · {r.count}/{r.target}</div>
            {r.won && <div className="mt-2"><Pill tone="ok">🏆 {lang === "en" ? "You won! The platform will contact you." : "فزت! ستتواصل معك المنصة."}</Pill></div>}
          </div>
          {r.link && (
            <Section title={tr(lang, "invite")}>
              <Copyable value={r.link} />
              <div className="p-3"><Btn className="w-full" onClick={() => open(`https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(shareText)}`)}>📤 {tr(lang, "share")}</Btn></div>
            </Section>
          )}
        </>
      )}
    </>
  );
}

function Stats() {
  const { lang, api } = useApp();
  const [s, setS] = useState<{ ads: number; spent: number; tasks: number; earned: number } | null>(null);
  useEffect(() => { void api<any>("stats").then((x) => { if (x.ok) setS(x); }); }, [api]);
  const box = (label: string, value: string) => (
    <div className="rounded-2xl p-4" style={{ background: "var(--app-card)" }}>
      <div className="text-2xl font-black" dir="ltr">{value}</div>
      <div className="mt-1 text-xs font-bold" style={{ color: "var(--app-hint)" }}>{label}</div>
    </div>
  );
  return (
    <>
      <ScreenTitle icon="📊" title={tr(lang, "stats")} />
      {!s ? <Loading lines={2} /> : (
        <div className="grid grid-cols-2 gap-2.5">
          {box(tr(lang, "statsTasks"), String(s.tasks))}
          {box(tr(lang, "statsEarned"), money(s.earned))}
          {box(tr(lang, "statsAds"), String(s.ads))}
          {box(tr(lang, "statsSpent"), money(s.spent))}
        </div>
      )}
    </>
  );
}
