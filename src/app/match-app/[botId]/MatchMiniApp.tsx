"use client";

/**
 * Premium hybrid Telegram Mini App for MARRIAGE_BOT bots (/match-app/<botId>).
 * State: plain React state per tab + a single `api()` helper (POST with
 * Telegram initData, verified server-side). Anonymous chat uses short
 * polling (no paid realtime). Telegram MainButton/BackButton/haptics wired.
 */
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import AdsterraBanner from "@/components/AdsterraBanner";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tab = "anon" | "discover" | "chats" | "me" | "admin";
type Card = {
  ref: string; shortId: string; name?: string | null; gender: "MALE" | "FEMALE"; age: number; country: string; city: string | null; job: string | null;
  education: string | null; maritalStatus: string | null; verified: boolean; flag: string; compat: number | null; values?: number | null; tgv?: boolean;
  presence: { online: boolean; label: string }; photo: boolean; photoLocked: boolean; likedYou?: boolean; boosted?: boolean;
};
type Msg = { id: number; mine: boolean; text: string; at: string };
type Poll = { state: "idle" | "waiting" | "timeout" | "chatting" | "ended"; fake?: boolean; sessionId?: string; filter?: string | null; messages?: Msg[]; contact?: "hidden" | "offered" | "requested_by_me" | "requested_by_partner"; partnerRead?: number; partnerTyping?: boolean; voice?: boolean };

const tg = (): any => (typeof window !== "undefined" ? (window as any).Telegram?.WebApp : null);
const haptic = (k: "light" | "medium" | "heavy" | "success" | "error" | "select" = "light") => {
  try {
    const h = tg()?.HapticFeedback;
    if (!h) return;
    if (k === "success" || k === "error") h.notificationOccurred(k);
    else if (k === "select") h.selectionChanged();
    else h.impactOccurred(k);
  } catch { /* old clients */ }
};

const GRAD = "bg-gradient-to-l from-[#ff2e93] via-[#e0708a] to-[#e8b4a0]";
const GLASS = "bg-white/[0.06] backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.35)]";

const emptyProfile = { gender: "", name: "", age: "", country: "", city: "", job: "", education: "", maritalStatus: "", attributes: "", contactMethod: "TELEGRAM", contactValue: "" };
const emptyPref = { country: "", ageMin: "", ageMax: "", job: "", education: "", attributes: "", city: "", maritalStatus: "" };
const blank = (o: Record<string, any>, base: Record<string, any>) => Object.fromEntries(Object.keys(base).map((k) => [k, o?.[k] ?? base[k] ?? ""]));

const FUNNEL_LABELS: Record<string, string> = {
  app_open: "📱 فتح التطبيق", upgrades_view: "⭐ عرض الترقيات", purchase_attempt: "🛒 محاولة شراء", purchase_insufficient: "💸 رصيد غير كافٍ",
  stars_invoice: "🧾 فاتورة نجوم", stars_paid: "⭐ دفع بالنجوم", purchase_success: "✅ شراء ناجح", rewind: "↩️ استرجاع", reminder_sent: "⏰ تذكير تجديد",
};

export default function MatchMiniApp({ botId }: { botId: string }) {
  const [boot, setBoot] = useState<"loading" | "outside" | "start" | "phone" | "ready">("loading");
  const [tab, setTab] = useState<Tab>("discover");
  const [canTg, setCanTg] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [me, setMe] = useState<any>(null);
  const [toast, setToast] = useState("");
  const [anonUnread, setAnonUnread] = useState(0);
  const [dmUnread, setDmUnread] = useState(0);
  const [chatWith, setChatWith] = useState<Card | null>(null);
  const [info, setInfo] = useState<Card | null>(null);
  const anonLastId = useRef(0);
  const anonWasChatting = useRef(false);
  const [modal, setModal] = useState<null | { kind: "match"; card: Card } | { kind: "compliment"; card: Card } | { kind: "super"; card: Card; done: () => void }>(null);

  const api = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    try {
      const r = await fetch(`/api/match-app/${encodeURIComponent(botId)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData: tg()?.initData || "", action, ...extra }),
      });
      return await r.json();
    } catch {
      return { ok: false, error: "تعذّر الاتصال" };
    }
  }, [botId]);

  const say = useCallback((m: string, kind: "success" | "error" = "success") => {
    if (!m) return;
    setToast(m); haptic(kind);
    window.setTimeout(() => setToast((t) => (t === m ? "" : t)), 3200);
  }, []);

  const reloadMe = useCallback(async () => {
    const r = await api("me");
    if (!r.ok) { say(r.error, "error"); setBoot("outside"); return null; }
    if (!r.registered) {
      // The admin may use the dashboard without a member profile (server re-checks every admin call).
      if (r.isAdmin) { setMe(r); setTab("admin"); setBoot("ready"); return r; }
      if (r.reason === "phone") setCanTg(!!r.canTgVerify);
      setBoot(r.reason === "phone" ? "phone" : "start"); return null;
    }
    setMe(r); setBoot("ready");
    return r;
  }, [api, say]);

  useEffect(() => {
    const w = tg();
    if (!w?.initData) { setBoot("outside"); return; }
    w.ready(); w.expand();
    try { w.setHeaderColor?.("#0b1020"); w.setBackgroundColor?.("#0b1020"); w.disableVerticalSwipes?.(); } catch { /* optional */ }
    reloadMe().then((r) => {
      if (r && r.registered && !r.profile) setTab("me");
      // Broadcast button «✏️ حدّث ملفي» opens ?tab=me
      try {
        const want = new URLSearchParams(window.location.search).get("tab");
        if (want === "me") setTab("me");
        if (want === "admin" && r?.isAdmin) setTab("admin"); // admin keyboard «📱 التطبيق المصغر»
      } catch { /* ignore */ }
      if (r?.dmUnread) setDmUnread(r.dmUnread);
    });
  }, [reloadMe]);

  // While the app is open on another tab: keep the app the active surface (so partner
  // messages stay in the app, not Telegram) and show an unread badge on 🔀.
  useEffect(() => {
    if (boot !== "ready" || tab === "anon" || !me?.registered) return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const r = await api("anon_poll", { after: anonLastId.current });
      if (stop || !r?.ok) return;
      if (r.state === "chatting") {
        const n = (r.messages || []).filter((m: Msg) => !m.mine).length;
        if (n) setAnonUnread(n);
        if (!anonWasChatting.current) { anonWasChatting.current = true; say("✅ تم الاتصال في الدردشة المجهولة — افتح تبويب 🔀"); setAnonUnread((u) => Math.max(u, 1)); }
      } else anonWasChatting.current = false;
    };
    tick();
    const id = window.setInterval(tick, 10000);
    return () => { stop = true; window.clearInterval(id); };
  }, [boot, tab, me?.registered]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === "anon") setAnonUnread(0); }, [tab]);
  // 💬 unread direct messages → badge on the Chats tab only (never in the 🔔 bell).
  useEffect(() => {
    if (boot !== "ready" || !me?.registered) return;
    const tick = async () => { if (document.visibilityState !== "visible") return; const r = await api("dm_unread"); if (r?.ok) setDmUnread(r.n || 0); };
    const id = window.setInterval(tick, 15000);
    return () => window.clearInterval(id);
  }, [boot, me?.registered, api]);

  // BackButton: never collapses the app by itself, asks before leaving (owner's choice).
  useEffect(() => {
    const w = tg();
    if (!w?.BackButton) return;
    try { w.enableClosingConfirmation?.(); } catch {}
    w.BackButton.show();
    const h = () => {
      haptic("light");
      if (w.showConfirm) w.showConfirm("هل تريد الخروج من التطبيق؟", (ok: boolean) => { if (ok) w.close(); });
      else if (window.confirm("هل تريد الخروج من التطبيق؟")) w.close();
    };
    w.BackButton.onClick(h);
    return () => w.BackButton.offClick(h);
  }, []);

  if (boot !== "ready") {
    const text = {
      loading: "جارٍ التحميل…",
      outside: toast || "افتح هذا التطبيق من زر القائمة داخل البوت في تلجرام.",
      start: "اضغط «ابدأ» في البوت أولاً ثم ارجع للتطبيق.",
      phone: canTg ? "خطوة أمان واحدة قبل الدخول: وثّق حسابك على تيليجرام بضغطة (بلا رقم هاتف)، أو وثّق رقمك من البوت." : "وثّق رقم هاتفك داخل البوت أولاً (خطوة أمان إلزامية) ثم ارجع. أو أضف اسم مستخدم (@username) لحسابك في تيليجرام ثم أعد فتح التطبيق للتوثيق بدون رقم.",
    }[boot];
    return (
      <Shell>
        <div className="grid min-h-[80dvh] place-items-center text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} rounded-3xl p-8 max-w-xs`}>
            <div className="text-5xl mb-3">{boot === "loading" ? "💞" : "🔒"}</div>
            <p className="text-white/80 leading-7">{text}</p>
            {boot === "phone" && canTg && (
              <button disabled={tgBusy} onClick={async () => { haptic("medium"); setTgBusy(true); const r = await api("tg_verify"); setTgBusy(false); if (r.ok) { haptic("success"); setBoot("loading"); void reloadMe(); } else say(r.error, "error"); }}
                className={`mt-4 w-full rounded-2xl py-3 text-sm font-bold disabled:opacity-60 ${GRAD}`}>{tgBusy ? "جارٍ التوثيق…" : "✅ وثّق بحساب تيليجرام"}</button>
            )}
            {boot === "loading" && <div className="mt-4 h-1 overflow-hidden rounded bg-white/10"><motion.div className={`h-full w-1/3 ${GRAD}`} animate={{ x: ["-100%", "300%"] }} transition={{ repeat: Infinity, duration: 1.2 }} /></div>}
          </motion.div>
        </div>
      </Shell>
    );
  }

  const hasProfile = me?.profile?.status === "APPROVED";

  return (
    <Shell>
      <Notifier api={api} say={say} enabled={hasProfile} onOpen={() => setTab("chats")} />
      <Onboarding hasProfile={hasProfile} goProfile={() => setTab("me")} />
      <Header me={me} onUpgrade={() => setTab("me")} bell={hasProfile ? <Bell api={api} /> : null} />
      {/* QA fix: no exit-wait here — an exiting tab with a pending layout/infinite animation could block
          the next tab forever (blank «المطابقات» after visiting a «ملفي» section). Enter animation only. */}
      <>
        <motion.section key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="pb-32">
          {tab === "anon" && <AnonTab api={api} say={say} me={me} active={tab === "anon"} onUsed={reloadMe} onSeen={(id, chatting) => { anonLastId.current = id; anonWasChatting.current = chatting; }} />}
          {tab === "discover" && (hasProfile
            ? <DiscoverTab api={api} say={say} me={me} onInfo={setInfo} onMessage={setChatWith} onMatch={(card) => setModal({ kind: "match", card })} onCompliment={(card) => setModal({ kind: "compliment", card })} onSuper={(card, done) => setModal({ kind: "super", card, done })} onUsed={reloadMe} onGo={(t) => setTab(t)} />
            : <Empty icon="👤" text="أنشئ ملفك أولاً لتظهر لك المطابقات" action="إنشاء الملف" onAction={() => setTab("me")} />)}
          {tab === "chats" && <ChatsTab api={api} say={say} athar={me?.athar} onOpenChat={setChatWith} onRead={() => api("dm_unread").then((r: any) => r?.ok && setDmUnread(r.n || 0))} hasProfile={hasProfile} goAnon={() => setTab("anon")} onCompliment={(card) => setModal({ kind: "compliment", card })} />}
          {tab === "me" && (me?.registered === false ? <Empty icon="🛡" text="حساب الإدارة بلا ملف عضو" /> : <MeTab api={api} say={say} me={me} reload={reloadMe} />)}
          {tab === "admin" && me?.isAdmin && <AdminTab api={api} say={say} onChange={reloadMe} />}
        </motion.section>
      </>

      <BottomNav tab={tab} setTab={(t) => { haptic("select"); setTab(t); }} admin={me?.isAdmin ? (me?.adminBadges?.total ?? 0) : null} unread={anonUnread} chatsUnread={dmUnread} />

      <AnimatePresence>
        {info && <InfoSheet key={"i" + info.ref} card={info} api={api} say={say} reasons={me?.reportReasons || {}} onClose={() => setInfo(null)} onMessage={() => { setChatWith(info); setInfo(null); }} />}
        {chatWith && <ChatSheet key={"c" + chatWith.ref} card={chatWith} api={api} say={say} onUpgrade={() => { setChatWith(null); setTab("me"); }} onClose={() => { setChatWith(null); api("dm_unread").then((r: any) => r?.ok && setDmUnread(r.n || 0)); }} />}
        {modal?.kind === "match" && <MatchModal card={modal.card} athar={me?.athar} api={api} onClose={() => setModal(null)} onChat={() => { setChatWith(modal.card); setModal(null); }} />}
        {modal?.kind === "super" && <SuperLikeSheet balance={me?.ent?.balance ?? 0} onClose={() => setModal(null)} onSend={async (note) => {
          const r = await api("swipe", { target: modal.card.ref, kind: "super", note });
          say(r.message || r.error, r.ok ? "success" : "error");
          if (r.ok) { modal.done(); setModal(null); reloadMe(); if (r.match) setModal({ kind: "match", card: { ...modal.card, ...r.card } }); }
        }} />}
        {modal?.kind === "compliment" && <ComplimentSheet list={me?.compliments || []} left={me?.complimentsLeft} onClose={() => setModal(null)} onPick={async (i) => { const r = await api("compliment", { target: modal.card.ref, index: i }); say(r.message || r.error, r.ok ? "success" : "error"); setModal(null); reloadMe(); }} />}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} role="status"
            className={`fixed bottom-28 inset-x-4 z-50 rounded-2xl px-4 py-3 text-center text-sm ${GLASS}`}>{toast}</motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}

// ---------------------------------------------------------------------------------------------
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main dir="rtl" className="relative min-h-[100dvh] overflow-x-hidden bg-[#0b1020] text-white font-sans selection:bg-pink-500/40">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-[#ff2e93]/25 blur-[100px]" />
        <div className="absolute top-1/3 -left-24 h-72 w-72 rounded-full bg-[#e8b4a0]/15 blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-indigo-600/20 blur-[100px]" />
      </div>
      <div className="relative mx-auto max-w-md px-4 pt-[max(1rem,env(safe-area-inset-top))]">{children}</div>
    </main>
  );
}

function Header({ me, onUpgrade, bell }: { me: any; onUpgrade: () => void; bell?: React.ReactNode }) {
  const vip = !!me?.ent?.vip;
  return (
    <header className="mb-4 flex items-center justify-between">
      <div>
        <p className="text-xs text-white/50">أهلاً {me?.firstName || ""} 👋</p>
        <h1 className="text-xl font-extrabold">
          <span className="bg-gradient-to-l from-[#ff7ab8] to-[#e8b4a0] bg-clip-text text-transparent">توافق</span>
          {vip && <span className="mr-2 rounded-full bg-gradient-to-l from-amber-300 to-amber-500 px-2 py-0.5 text-[10px] font-bold text-black align-middle">👑 ذهبية</span>}
        </h1>
      </div>
      <div className="flex items-center gap-2">{bell}
      <motion.button whileTap={{ scale: 0.92 }} onClick={() => { haptic("medium"); onUpgrade(); }}
        className={`flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm ${GLASS}`} aria-label="الرصيد والترقيات">
        <span>💰</span><b className="tabular-nums">${Number(me?.ent?.balance ?? 0).toFixed(2)}</b><span className="text-[#f3cbbd]">⭐</span>
      </motion.button></div>
    </header>
  );
}

function BottomNav({ tab, setTab, admin, unread = 0, chatsUnread = 0 }: { tab: Tab; setTab: (t: Tab) => void; admin: number | null; unread?: number; chatsUnread?: number }) {
  const items: [Tab, string, string][] = [["anon", "🔀", "دردشة مجهولة"], ["discover", "🔥", "المطابقات"], ["chats", "💬", "محادثاتي"], ["me", "👤", "ملفي"]];
  if (admin !== null) items.push(["admin", "🛡", "لوحة القيادة"]);
  return (
    <nav aria-label="التنقل الرئيسي" className={`fixed bottom-4 inset-x-4 z-40 mx-auto max-w-md rounded-[28px] p-1.5 ${GLASS}`} style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
      <ul className={`grid gap-1 ${admin !== null ? "grid-cols-5" : "grid-cols-4"}`}>
        {items.map(([t, icon, label]) => (
          <li key={t}>
            <button onClick={() => setTab(t)} aria-current={tab === t ? "page" : undefined} className="relative w-full rounded-3xl py-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-white/60">
              {tab === t && <motion.span layoutId="navpill" className={`absolute inset-0 rounded-3xl ${GRAD} opacity-90`} transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
              <span className="relative block text-lg leading-none">{icon}</span>
              {t === "anon" && !!unread && tab !== "anon" && <span className="absolute right-2 top-1 min-w-4 rounded-full bg-emerald-500 px-1 text-[9px] font-bold leading-4">{unread > 9 ? "9+" : unread}</span>}
              {t === "chats" && !!chatsUnread && <span data-testid="chats-badge" className="absolute right-2 top-1 min-w-4 rounded-full bg-pink-500 px-1 text-[9px] font-bold leading-4">{chatsUnread > 9 ? "9+" : chatsUnread}</span>}
              {t === "admin" && !!admin && <span className="absolute right-2 top-1 min-w-4 rounded-full bg-red-500 px-1 text-[9px] font-bold leading-4">{admin > 99 ? "99+" : admin}</span>}
              <span className={`relative mt-1 block text-[10px] ${tab === t ? "text-white font-bold" : "text-white/60"}`}>{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Empty({ icon, text, action, onAction }: { icon: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className={`mt-10 rounded-3xl p-8 text-center ${GLASS}`}>
      <div className="text-5xl">{icon}</div>
      <p className="mt-3 text-white/70">{text}</p>
      {action && <button onClick={onAction} className={`mt-4 rounded-2xl px-5 py-2.5 font-bold ${GRAD}`}>{action}</button>}
    </div>
  );
}

function Pill({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={() => { haptic("select"); onClick(); }}
      aria-pressed={!!active}
      className={`min-w-fit flex-1 whitespace-nowrap rounded-2xl px-3 py-2 text-sm transition ${active ? `${GRAD} font-bold text-white shadow-[0_0_20px_rgba(255,46,147,0.35)]` : "bg-white/5 text-white/70 border border-white/10"}`}>
      {children}
    </button>
  );
}

function Field({ label, value, onChange, type = "text", area, placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; area?: boolean; placeholder?: string }) {
  const cls = "mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-[15px] text-white placeholder-white/30 outline-none focus:border-pink-400/60 focus:ring-2 focus:ring-pink-500/20";
  return (
    <label className="mb-3 block">
      <span className="text-xs text-white/50">{label}</span>
      {area
        ? <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
        : <input value={value} type={type} inputMode={type === "number" ? "numeric" : undefined} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />}
    </label>
  );
}

function Toggle({ on, label, hint, onChange }: { on: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => { haptic("select"); onChange(!on); }} className="flex w-full items-center justify-between gap-3 py-3 text-right">
      <span><span className="block text-sm">{label}</span>{hint && <span className="block text-[11px] text-white/40">{hint}</span>}</span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? GRAD : "bg-white/15"}`}>
        <motion.span layout className="absolute top-1 h-5 w-5 rounded-full bg-white shadow" style={{ right: on ? 4 : 24 }} />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// 🔀 Anonymous chat — a window onto the BOT's own random chat (same queue, rules, buttons).
function AnonTab({ api, say, me, active, onUsed, onSeen }: { api: any; say: any; me: any; active: boolean; onUsed: () => void; onSeen?: (lastId: number, chatting: boolean) => void }) {
  const [outbox, setOutbox] = useState<{ tmp: number; text: string; status: "sending" | "failed"; error?: string }[]>([]);
  const [offline, setOffline] = useState(false);
  const af = me?.anonFilters || { owned: false, filter: {} };
  const [filter, setFilter] = useState<{ gender?: string; country: string; ageMin: string; ageMax: string }>(() => ({
    gender: af.filter?.gender, country: af.filter?.country ?? "", ageMin: af.filter?.ageMin != null ? String(af.filter.ageMin) : "", ageMax: af.filter?.ageMax != null ? String(af.filter.ageMax) : "",
  }));
  const [poll, setPoll] = useState<Poll>({ state: "idle" });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [exitOpen, setExitOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const typingAt = useRef(0);
  const lastId = useRef(0);
  const sessionRef = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((r: any) => {
    if (!r?.ok) { setOffline(r?.error === "تعذّر الاتصال"); if (r?.error && r.error !== "تعذّر الاتصال") say(r.error, "error"); return; }
    setOffline(false);
    if (r.state === "chatting" && r.sessionId !== sessionRef.current) { sessionRef.current = r.sessionId; lastId.current = 0; setMsgs([]); haptic("success"); }
    if (r.messages?.length) {
      lastId.current = r.messages[r.messages.length - 1].id;
      setMsgs((m) => { const seen = new Set(m.map((x) => x.id)); return [...m, ...r.messages.filter((x: Msg) => !seen.has(x.id))]; });
      if (r.messages.some((x: Msg) => !x.mine)) haptic("light");
    }
    if (r.state === "ended" && sessionRef.current) { say("انتهت المحادثة"); sessionRef.current = undefined; }
    setPoll(r);
    onSeen?.(lastId.current, r.state === "chatting");
  }, [say]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollNow = async () => apply(await api("anon_poll", { after: lastId.current, sessionId: sessionRef.current }));
  const [rtTopic, setRtTopic] = useState<string | null>(null);
  const rtLive = useRef(false);
  // Polling with backoff (4s → 12s when quiet; 30s when Realtime is live), paused while hidden.
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let delay = 4000;
    let timer: number | undefined;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        const r = await api("anon_poll", { after: lastId.current, sessionId: sessionRef.current, wantTopic: !!me?.realtime && poll.state === "chatting" && !rtTopic });
        if (stop) return;
        apply(r);
        if (r?.rtTopic) setRtTopic(r.rtTopic);
        delay = r?.messages?.length ? 4000 : r?.partnerTyping ? 2500 : Math.min(6000, Math.round(delay * 1.5));
      }
      const base = poll.state === "idle" || poll.state === "ended" ? 15000 : rtLive.current && poll.state === "chatting" ? 30000 : delay;
      timer = window.setTimeout(tick, base);
    };
    tick();
    const onVis = () => { if (document.visibilityState === "visible") { delay = 4000; window.clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [active, poll.state, rtTopic]); // eslint-disable-line react-hooks/exhaustive-deps

  // Optional Supabase Realtime doorbell: content-free "ping" → fetch via the authenticated API.
  useEffect(() => {
    const cfg = me?.realtime;
    if (!active || !cfg || !rtTopic || poll.state !== "chatting") return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    import("@supabase/supabase-js").then(({ createClient }) => {
      if (cancelled) return;
      const client = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const ch = client.channel(rtTopic).on("broadcast", { event: "ping" }, () => { pollNow(); })
        .subscribe((status: string) => {
          rtLive.current = status === "SUBSCRIBED";
          // Reconnect: drop the topic and fetch a fresh one shortly; polling covers the gap.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") window.setTimeout(() => { if (!cancelled) setRtTopic(null); }, 5000);
        });
      cleanup = () => { rtLive.current = false; client.removeChannel(ch); };
    }).catch(() => { rtLive.current = false; });
    return () => { cancelled = true; cleanup?.(); };
  }, [active, rtTopic, poll.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (poll.state !== "chatting") setRtTopic(null); }, [poll.state]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs.length, outbox.length]);

  // Same as pressing «🔀 مراسلة عشوائية» in the bot.
  const start = async (ignoreFilter = false) => {
    haptic("medium");
    setMsgs([]); lastId.current = 0;
    apply(await api("anon_start", { ignoreFilter }));
    onUsed();
  };
  const saveFilter = async () => {
    const r = await api("anon_filter", { filter });
    say(r.message || r.error, r.ok ? "success" : "error");
    onUsed();
  };
  const buyFilters = async () => {
    if (!(await confirmTg(`تفعيل «🎛 فلاتر الدردشة العشوائية» بـ $${af.price ?? 2} لمدة 30 يوماً من رصيدك؟`))) return;
    const r = await api("upgrade", { key: "anonFilters" });
    say(r.message || r.error, r.ok ? "success" : "error");
    onUsed();
  };
  // Optimistic send: the bubble shows at once (⏳), then the server copy (✓) replaces it.
  const send = async (t = text, retryTmp?: number) => {
    const v = t.trim();
    if (!v) return;
    setText("");
    const tmp = retryTmp ?? Date.now();
    setOutbox((o) => [...o.filter((x) => x.tmp !== tmp), { tmp, text: v, status: "sending" }]);
    const r = await api("anon_send", { text: v });
    if (!r.ok) {
      setOutbox((o) => o.map((x) => (x.tmp === tmp ? { ...x, status: "failed", error: r.error } : x)));
      if (r.error && r.error !== "تعذّر الاتصال") say(r.error, "error");
      return;
    }
    haptic("light");
    await pollNow();
    setOutbox((o) => o.filter((x) => x.tmp !== tmp));
  };
  const end = async (reason: string) => { setExitOpen(false); await api("anon_end", { reason }); setPoll({ state: "idle" }); sessionRef.current = undefined; };

  useEffect(() => {
    const w = tg();
    if (!w?.MainButton) return;
    // The native MainButton sits under our floating nav (system area); the start button is
    // now an in-page button above the nav, so keep the native one hidden on this tab.
    if (active) w.MainButton.hide();
  }, [active, poll.state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (poll.state === "chatting") {
    return (
      <div className={`flex h-[calc(100dvh-190px)] flex-col rounded-3xl ${GLASS}`}>
        <div className="flex items-center justify-between border-b border-white/10 p-3">
          <div className="flex items-center gap-2">
            <div className={`grid h-10 w-10 place-items-center rounded-full ${GRAD}`}>🎭</div>
            <div>
              <p className="text-sm font-bold">شخص مجهول</p>
              <p className={`text-[11px] ${offline ? "text-amber-300" : "text-emerald-300"}`}>{offline ? "⚠️ إعادة الاتصال…" : "● مجهولة الهوية بالكامل"}</p>
            </div>
          </div>
          <div className="flex gap-1">
            {!poll.fake && <IconBtn title="إبلاغ" onClick={async () => { const r = await api("anon_report"); say(r.message || r.error); }}>🚩</IconBtn>}
            {!poll.fake && <IconBtn title="حظر" onClick={async () => { if (await confirmTg("حظر هذا الشخص وإنهاء المحادثة؟")) { const r = await api("anon_block"); setPoll({ state: "idle" }); sessionRef.current = undefined; say(r.message || "⛔ تم الحظر"); } }}>⛔</IconBtn>}
            <IconBtn title="إنهاء المحادثة" onClick={() => (poll.fake ? end("other") : setExitOpen(true))}>⏹</IconBtn>
          </div>
        </div>
        {exitOpen && (
          <div className="space-y-2 border-b border-white/10 p-3">
            <p className="text-xs text-white/60">قبل الإنهاء — اختر سبباً مختصراً (تُرسَل رسالة شكر لطيفة تلقائياً للطرف الآخر):</p>
            {(me?.anonExitReasons || []).map((r: any) => (
              <button key={r.code} onClick={() => end(r.code)} className="block w-full rounded-2xl bg-white/5 px-3 py-2 text-right text-sm">{r.label}</button>
            ))}
            <button onClick={() => setExitOpen(false)} className="text-xs text-white/40">رجوع</button>
          </div>
        )}
        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-3">
          {msgs.map((m) => (
            <motion.div key={m.id} initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-[15px] leading-6 ${m.mine ? `mr-auto ${GRAD} rounded-bl-md` : "ml-auto bg-white/10 rounded-br-md"}`}>
              {m.text.startsWith("🎤voice:") ? <VoiceBubble api={api} text={m.text} /> : m.text}
              {m.mine && <span className="mr-1 align-bottom text-[10px] opacity-70" title={!poll.fake && (poll.partnerRead ?? 0) >= m.id ? "قُرئت" : "أُرسلت"}>{!poll.fake && (poll.partnerRead ?? 0) >= m.id ? "✓✓" : "✓"}</span>}
            </motion.div>
          ))}
          {outbox.map((o) => (
            <div key={o.tmp} className={`mr-auto max-w-[80%] rounded-2xl rounded-bl-md px-3 py-2 text-[15px] leading-6 ${o.status === "failed" ? "border border-red-400/60 bg-red-500/10" : `${GRAD} opacity-70`}`}>
              {o.text}
              {o.status === "sending" ? <span className="mr-1 text-[10px]">⏳</span> : (
                <span className="mt-1 block text-[11px] text-red-200">⚠️ لم تُرسل{o.error && o.error !== "تعذّر الاتصال" ? "" : " — "}
                  {(!o.error || o.error === "تعذّر الاتصال") && <button onClick={() => send(o.text, o.tmp)} className="underline">إعادة المحاولة</button>}
                  <button onClick={() => setOutbox((x) => x.filter((y) => y.tmp !== o.tmp))} className="mr-2 opacity-70">✕</button>
                </span>
              )}
            </div>
          ))}
          {poll.partnerTyping && (
            <div className="ml-auto w-fit rounded-2xl rounded-br-md bg-white/10 px-3 py-2 text-xs text-white/70" aria-live="polite">
              <span className="inline-flex gap-1 align-middle">{[0, 1, 2].map((i) => <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-white/70" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }} />)}</span>
              <span className="mr-2">يكتب الآن…</span>
            </div>
          )}
        </div>
        {poll.contact && poll.contact !== "hidden" && (
          <div className="px-3 pb-1">
            <p className="mb-1 text-[11px] text-white/50">💬 المحادثة مستمرة بشكل جيد. عند الرغبة، يمكنكما طلب تبادل بيانات التواصل الرسمي:</p>
            <button disabled={poll.contact === "requested_by_me"} onClick={async () => { const r = await api("anon_contact"); say(r.message || r.error); pollNow(); }}
              className="rounded-full border border-[#e8b4a0]/40 bg-white/5 px-3 py-1.5 text-xs text-[#f3cbbd] disabled:opacity-50">
              {poll.contact === "requested_by_partner" ? "✅ أوافق على التبادل" : poll.contact === "requested_by_me" ? "⏳ بانتظار موافقة الطرف الآخر" : "📇 طلب تبادل التواصل الرسمي"}
            </button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 p-3">
          <input value={text} onChange={(e) => { setText(e.target.value); if (!poll.fake && Date.now() - typingAt.current > 3000) { typingAt.current = Date.now(); api("anon_typing"); } }} placeholder="اكتب رسالتك (نص فقط)…" className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-pink-400/60" />
          {poll.voice && !poll.fake && !text.trim() ? <VoiceButton api={api} say={say} onSent={pollNow} /> : <motion.button whileTap={{ scale: 0.9 }} className={`rounded-2xl px-4 font-bold ${GRAD}`}>إرسال</motion.button>}
        </form>
      </div>
    );
  }

  const waiting = poll.state === "waiting";
  const filterLabel = filter.gender === "FEMALE" ? "👩 أنثى" : filter.gender === "MALE" ? "👨 ذكر" : "🎲 عشوائي";
  return (
    <div className="relative pb-28">
      <div className="flex justify-end">
        <button data-testid="anon-filter-chip" onClick={() => setFilterOpen(true)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs">🎛 فلتر · {filterLabel}</button>
      </div>
      <div className="relative mx-auto my-4 grid h-56 w-56 place-items-center">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="absolute inset-0 rounded-full border border-pink-400/40"
            animate={waiting ? { scale: [0.4, 1.25], opacity: [0.8, 0] } : { scale: 0.9 - i * 0.2, opacity: 0.25 }}
            transition={waiting ? { repeat: Infinity, duration: 2.4, delay: i * 0.8, ease: "easeOut" } : { duration: 0.3 }} />
        ))}
        {waiting && <motion.span className="absolute inset-4 rounded-full" style={{ background: "conic-gradient(from 0deg, rgba(255,46,147,0.45), transparent 35%)" }} animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }} />}
        <motion.div animate={{ scale: waiting ? [1, 1.08, 1] : 1 }} transition={{ repeat: Infinity, duration: 1.6 }}
          className={`relative grid h-24 w-24 place-items-center rounded-full text-4xl shadow-[0_0_40px_rgba(255,46,147,0.5)] ${GRAD}`}>🎭</motion.div>
      </div>
      <p className="text-center text-white/70">
        {waiting ? "🔍 يتم البحث الآن عن شريك للمحادثة… إن لم يُعثر على أحد خلال دقيقة واحدة، اضغط الزر مجدداً."
          : poll.state === "timeout" ? (poll.filter ? `⌛ لم نجد خلال دقيقة شريكاً يطابق فلاترك (${poll.filter}). لم نتجاهل فلاترك — وسّعها أو ابحث هذه المرة بدونها.` : "⌛ لم يُعثر على أحد خلال دقيقة. اضغط «🔀 مراسلة عشوائية» للتحقق مجدداً.")
          : "دردشة مجهولة الهوية بالكامل — نفس المراسلة العشوائية في البوت"}
      </p>
      {waiting && poll.filter && <p className="mt-1 text-center text-xs text-[#f3cbbd]">🎛 {poll.filter}</p>}

      {waiting ? (
        <button onClick={async () => { await api("anon_end"); setPoll({ state: "idle" }); }} className="mx-auto mt-6 block rounded-2xl border border-white/15 px-6 py-3">إلغاء البحث</button>
      ) : (
        <>
          {poll.state === "timeout" && poll.filter && (
            <button onClick={() => start(true)} className="mx-auto mt-4 block rounded-2xl border border-white/15 px-5 py-2 text-sm">🌐 ابحث هذه المرة بدون فلاتر</button>
          )}
          <button data-testid="anon-start" onClick={() => start()} className={`mt-4 w-full rounded-2xl py-3.5 font-bold shadow-[0_8px_30px_rgba(255,46,147,0.35)] ${GRAD}`}>🔀 مراسلة عشوائية</button>
        </>
      )}
      {filterOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" onClick={() => setFilterOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} data-testid="anon-filter-sheet" className={`max-h-[85vh] w-full overflow-y-auto rounded-t-[32px] p-5 pb-8 ${GLASS} bg-[#0f1530]/95`}>
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
            <p className="mb-3 text-base font-bold">🎛 فلتر الدردشة العشوائية</p>
            <div className="space-y-2">
              {([["", "🎲 عشوائي", "مجاني · الافتراضي"], ["FEMALE", "👩 أنثى فقط", af.owned ? "مفعّل" : `🔒 $${af.price ?? 2} / 30 يوماً`], ["MALE", "👨 ذكر فقط", af.owned ? "مفعّل" : `🔒 $${af.price ?? 2} / 30 يوماً`]] as const).map(([g, label, hint]) => {
                const on = (filter.gender || "") === g;
                const locked = !!g && !af.owned;
                return (
                  <button key={g} disabled={locked} onClick={() => setFilter({ ...filter, gender: g || undefined })}
                    className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-right ${on ? `${GRAD} font-bold` : "border border-white/10 bg-white/5"} ${locked ? "opacity-60" : ""}`}>
                    <span>{label}</span><span className="text-[11px] opacity-80">{hint}</span>
                  </button>
                );
              })}
            </div>
            {!af.owned ? (
              <div className="mt-4 rounded-2xl border border-[#e8b4a0]/30 bg-white/5 p-3">
                <p className="text-[12px] leading-5 text-white/60">فلتر الجنس والدولة والعمر ميزة مدفوعة: ${af.price ?? 2} لمدة 30 يوماً — مشمولة في العضوية الذهبية. بدون تجديد تلقائي.</p>
                <button onClick={buyFilters} className={`mt-3 w-full rounded-2xl py-2.5 text-sm font-bold ${GRAD}`}>تفعيل (${af.price ?? 2} / 30 يوماً)</button>
              </div>
            ) : (
              <div className="mt-4">
                <p className="mb-2 text-[11px] text-emerald-300">✓ {af.viaVip ? "ضمن العضوية الذهبية" : `مفعّلة حتى ${new Date(af.until).toLocaleDateString("ar")}`}</p>
                <Field label="الدولة" value={filter.country} onChange={(v) => setFilter({ ...filter, country: v })} placeholder="فارغ = أي دولة" />
                <div className="flex gap-2">
                  <div className="flex-1"><Field label="العمر من" type="number" value={filter.ageMin} onChange={(v) => setFilter({ ...filter, ageMin: v })} /></div>
                  <div className="flex-1"><Field label="إلى" type="number" value={filter.ageMax} onChange={(v) => setFilter({ ...filter, ageMax: v })} /></div>
                </div>
                <p className="text-[11px] text-white/40">تتم المطابقة فقط مع من يحقق فلاترك، وإن كان لديه فلاتر فيجب أن تحققها أنت أيضاً.</p>
                <button onClick={async () => { await saveFilter(); setFilterOpen(false); }} className={`mt-2 w-full rounded-2xl py-2.5 text-sm font-bold ${GRAD}`}>حفظ</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 🛡 Admin dashboard — every call is re-checked server-side (isMatchAdmin); actions = the bot's own.
function AdminTab({ api, say, onChange }: { api: any; say: any; onChange: () => void }) {
  type Sec = "overview" | "profiles" | "verify" | "rsearch" | "rchat" | "inbox" | "users" | "broadcast" | "audit" | "funnel";
  const [sec, setSec] = useState<Sec>("overview");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [lookup, setLookup] = useState<any>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [bc, setBc] = useState("");
  const loadSeq = useRef(0);
  const [badges, setBadges] = useState<any>({});

  const load = useCallback(async (s: Sec = sec) => {
    const act = { overview: "admin_overview", profiles: "admin_profiles", verify: "admin_verifications", rsearch: "admin_reports", rchat: "admin_reports", inbox: "admin_inbox", users: null, broadcast: null, audit: "admin_audit", funnel: "admin_funnel" }[s];
    const seq = ++loadSeq.current;
    if (!act) { setData(null); return; }
    const r = await api(act, { source: s === "rchat" ? "RANDOM_CHAT" : "SEARCH" });
    // QA fix: a slower response for a previous section must not render under the new one
    if (seq !== loadSeq.current) return;
    if (!r.ok) { say(r.error, "error"); return; }
    if (r.badges) setBadges(r.badges);
    setData({ ...r, __sec: s });
  }, [api, say, sec]);
  useEffect(() => { setData(null); load(sec); }, [sec]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (action: string, extra: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !(await confirmTg(confirmText))) return;
    setBusy(true);
    const r = await api(action, extra);
    setBusy(false);
    say(r.message || r.error, r.ok ? "success" : "error");
    await load(); onChange();
  };

  const b = badges || {};
  const view = data?.__sec === sec ? data : null;
  const secs: [Sec, string, number?][] = [
    ["overview", "📊 نظرة عامة"], ["profiles", "📋 الملفات", b.profiles], ["verify", "☑️ التوثيق", b.verifications],
    ["rsearch", "🚩 بلاغات المطابقة", b.reportsSearch], ["rchat", "🚩 بلاغات العشوائية", b.reportsChat], ["inbox", "📥 الوارد", b.inbox],
    ["users", "🔎 مستخدم / رفع حظر"], ["broadcast", "📢 بث"], ["audit", "🧾 السجل"], ["funnel", "📈 التحويل"],
  ];
  const Btn = ({ children, onClick, tone = "" }: { children: React.ReactNode; onClick: () => void; tone?: string }) => (
    <button disabled={busy} onClick={onClick} className={`rounded-xl px-3 py-1.5 text-xs disabled:opacity-50 ${tone || "bg-white/10"}`}>{children}</button>
  );
  const when = (d: string) => new Date(d).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {secs.map(([k, l, n]) => (
          <Pill key={k} active={sec === k} onClick={() => setSec(k)}>{l}{n ? <span className="mr-1 rounded-full bg-red-500 px-1.5 text-[10px] font-bold">{n}</span> : null}</Pill>
        ))}
      </div>
      <p className="px-1 text-[11px] text-white/40">نفس أزرار لوحة البوت — التنبيهات والتأكيدات تصلك في محادثة البوت كالمعتاد.</p>

      {sec === "overview" && data?.stats && (
        <div className={`grid grid-cols-2 gap-2 rounded-3xl p-4 text-sm ${GLASS}`}>
          {([["👥 المستخدمون", data.stats.totalUsers], ["🟢 متصلون", data.stats.onlineUsers], ["⏳ ملفات معلقة", data.stats.pendingProfiles], ["✅ معتمدة", data.stats.approvedProfiles], ["❌ مرفوضة", data.stats.rejectedProfiles], ["🚩 بلاغات بحث", data.stats.pendingSearchReports], ["🚩 بلاغات عشوائية", data.stats.pendingChatReports], ["💬 محادثات نشطة", data.stats.activeSessions], ["⏳ بالطابور", data.stats.waitingQueue], ["📥 وارد", data.stats.pendingInbox]] as [string, number][]).map(([l, v]) => (
            <div key={l} className="rounded-2xl bg-white/5 p-3"><p className="text-[11px] text-white/50">{l}</p><p className="text-xl font-black">{v}</p></div>
          ))}
          <button disabled={busy} onClick={() => act("admin_diagnostics", {})} className="col-span-2 rounded-2xl bg-white/10 py-2 text-xs">🩺 فحص البحث (يُرسل للبوت)</button>
        </div>
      )}

      {sec === "profiles" && (view?.items?.length ? view.items.map((p: any) => (
        <div key={p.userId} className={`rounded-3xl p-4 text-sm ${GLASS}`}>
          <p className="font-bold">{p.name} · {p.age} · {p.gender === "MALE" ? "ذكر" : "أنثى"} <span className="text-white/40">#{p.shortId}</span></p>
          <p className="text-[12px] text-white/60">{[p.country, p.city, p.job, p.education, p.maritalStatus].filter(Boolean).join(" · ")}{p.hasPhoto ? " · 📷 (الصورة في البوت)" : ""}</p>
          <div className="mt-2 flex gap-2">
            <Btn tone="bg-emerald-500/80" onClick={() => act("admin_profile_decide", { userId: p.userId, approve: true })}>✅ قبول</Btn>
            <Btn tone="bg-red-500/70" onClick={() => act("admin_profile_decide", { userId: p.userId, approve: false }, "رفض هذا الملف؟")}>❌ رفض</Btn>
          </div>
        </div>
      )) : data && <Empty icon="✅" text="لا توجد ملفات بانتظار المراجعة." />)}

      {sec === "verify" && (<>
        {data?.note && <p className="px-1 text-[11px] text-white/50">{data.note}</p>}
        {view?.items?.length ? view.items.map((p: any) => (
          <div key={p.userId} className={`flex items-center justify-between rounded-3xl p-4 text-sm ${GLASS}`}>
            <span>{p.name} <span className="text-white/40">#{p.shortId}</span></span>
            <span className="flex gap-2">
              <Btn tone="bg-emerald-500/80" onClick={() => act("admin_verify_decide", { userId: p.userId, approve: true })}>☑️ توثيق</Btn>
              <Btn tone="bg-red-500/70" onClick={() => act("admin_verify_decide", { userId: p.userId, approve: false }, "رفض طلب التوثيق؟")}>رفض</Btn>
            </span>
          </div>
        )) : data && <Empty icon="☑️" text="لا توجد طلبات توثيق معلقة." />}
      </>)}

      {(sec === "rsearch" || sec === "rchat") && (view?.items?.length ? view.items.map((r: any) => (
        <div key={r.id} className={`rounded-3xl p-4 text-sm ${GLASS}`}>
          <p>المُبلِّغ: {r.reporter.name || "بلا ملف"} <span className="text-white/40">#{r.reporter.shortId}</span></p>
          <p>المُبلَّغ عنه: <b>{r.target.name || "بلا ملف"}</b> <span className="text-white/40">#{r.target.shortId}</span>{r.target.pending > 1 && <span className="mr-1 rounded-full bg-red-500/80 px-1.5 text-[10px]">{r.target.pending} بلاغات</span>}</p>
          {r.reason && <p className="text-[12px] text-white/50">{r.reason}</p>}
          <p className="text-[11px] text-white/40">{when(r.at)}</p>
          <div className="mt-2 flex gap-2">
            <Btn onClick={() => act("admin_report_resolve", { reportId: r.id, act: "ignore" })}>🙈 تجاهل</Btn>
            <Btn tone="bg-amber-500/70" onClick={() => act("admin_report_resolve", { reportId: r.id, act: "mute" })}>🔇 كتم 24س</Btn>
            <Btn tone="bg-red-500/70" onClick={() => act("admin_report_resolve", { reportId: r.id, act: "ban" }, "حظر نهائي لهذا المستخدم؟")}>⛔ حظر نهائي</Btn>
          </div>
        </div>
      )) : data && <Empty icon="✅" text="لا توجد بلاغات بانتظار المراجعة في هذا القسم." />)}

      {sec === "inbox" && (view?.items?.length ? view.items.map((m: any) => (
        <div key={m.id} className={`rounded-3xl p-4 text-sm ${GLASS}`}>
          <p className="font-bold">{m.name || "بلا ملف"} <span className="text-white/40">#{m.shortId} · {m.senderId}</span></p>
          <p className="my-1 whitespace-pre-wrap text-white/80">{m.text}</p>
          <p className="text-[11px] text-white/40">{when(m.at)}</p>
          <div className="mt-2 flex gap-2">
            <input value={reply[m.id] || ""} onChange={(e) => setReply({ ...reply, [m.id]: e.target.value })} placeholder="↩️ اكتب ردك" className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs outline-none" />
            <Btn tone={GRAD} onClick={() => act("admin_inbox_reply", { messageId: m.id, text: reply[m.id] || "" })}>إرسال</Btn>
          </div>
          <div className="mt-2 flex gap-2">
            <Btn onClick={() => act("admin_inbox_action", { messageId: m.id, kind: "read" })}>✅ مقروء</Btn>
            <Btn tone="bg-amber-500/70" onClick={() => act("admin_inbox_action", { messageId: m.id, kind: "mute" })}>🔇 كتم المرسل</Btn>
            <Btn tone="bg-red-500/70" onClick={() => act("admin_inbox_action", { messageId: m.id, kind: "ban" }, "حظر المرسل نهائياً؟")}>⛔ حظر المرسل</Btn>
          </div>
        </div>
      )) : data && <Empty icon="📭" text="لا توجد رسائل واردة جديدة." />)}

      {sec === "users" && (
        <div className={`rounded-3xl p-4 text-sm ${GLASS}`}>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} inputMode="numeric" placeholder="آيدي المستخدم (Telegram ID)" className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 outline-none" />
            <Btn tone={GRAD} onClick={async () => { const r = await api("admin_lookup", { userId: q }); if (r.ok) setLookup(r); else { setLookup(null); say(r.error, "error"); } }}>🔎 بحث</Btn>
          </div>
          {lookup && (
            <div className="mt-3 space-y-1 text-[13px]">
              <p>🆔 {lookup.user.id} · 📱 {lookup.user.phoneVerified ? "✅" : "❌"} · 💰 ${lookup.user.balance.toFixed(2)}</p>
              <p>🚫 محظور: {lookup.user.isBanned ? "نعم" : "لا"} · 🔇 مكتوم: {lookup.user.mutedUntil ? `حتى ${when(lookup.user.mutedUntil)}` : "لا"}</p>
              <p>❤️ {lookup.user.likesReceived} · 🚩 ضده {lookup.user.reportsReceived} · 🚩 قدّمها {lookup.user.reportsGiven}</p>
              <p>👤 {lookup.profile ? `${lookup.profile.name} · ${lookup.profile.status} · توثيق ${lookup.profile.verification}${lookup.profile.isHidden ? " · مخفي" : ""}` : "لا يوجد ملف"}</p>
              <div className="flex gap-2 pt-1">
                {(lookup.user.isBanned || lookup.user.mutedUntil) && <Btn tone="bg-emerald-500/80" onClick={() => act("admin_unban", { userId: lookup.user.id }, "رفع الحظر/الكتم؟")}>🔓 رفع حظر/كتم</Btn>}
                {lookup.profile?.status === "PENDING" && <>
                  <Btn tone="bg-emerald-500/80" onClick={() => act("admin_profile_decide", { userId: lookup.user.id, approve: true })}>✅ قبول الملف</Btn>
                  <Btn tone="bg-red-500/70" onClick={() => act("admin_profile_decide", { userId: lookup.user.id, approve: false })}>❌ رفض الملف</Btn>
                </>}
                {lookup.profile?.status === "APPROVED" && <Btn tone="bg-red-500/70" onClick={() => act("admin_profile_decide", { userId: lookup.user.id, approve: false }, "رفض ملف معتمد؟")}>❌ رفض الملف</Btn>}
              </div>
            </div>
          )}
        </div>
      )}

      {sec === "broadcast" && <UpdateCampaign api={api} say={say} />}
      {sec === "broadcast" && (
        <div className={`rounded-3xl p-4 text-sm ${GLASS}`}>
          <textarea value={bc} onChange={(e) => setBc(e.target.value)} rows={5} placeholder="📢 نص الرسالة لجميع المستخدمين المُفعّلين" className="w-full rounded-xl border border-white/10 bg-white/5 p-3 outline-none" />
          <button disabled={busy || !bc.trim()} onClick={async () => { await act("admin_broadcast", { text: bc }, "إرسال هذا البث لجميع المستخدمين؟"); setBc(""); }} className={`mt-2 w-full rounded-2xl py-2.5 font-bold disabled:opacity-50 ${GRAD}`}>إرسال البث</button>
        </div>
      )}

      {sec === "funnel" && (view?.items?.length ? (
        <div className={`rounded-3xl p-4 text-sm ${GLASS}`}>
          <p className="mb-2 font-bold">📈 قمع التحويل (مستخدمون فريدون)</p>
          <div className="grid grid-cols-3 gap-y-1 text-xs"><b>المرحلة</b><b>7 أيام</b><b>30 يوماً</b>
            {view.items.map((r: any) => (
              <Fragment key={r.event}><span>{FUNNEL_LABELS[r.event] || r.event}</span><span>{r.users} <span className="text-white/35">({r.events})</span></span><span>{r.users30}</span></Fragment>
            ))}
          </div>
          {(() => { const o = view.items.find((r: any) => r.event === "app_open")?.users || 0; const p = view.items.find((r: any) => r.event === "purchase_success")?.users || 0; return <p className="mt-3 text-xs text-white/60">معدل التحويل (7 أيام): {o ? ((p / o) * 100).toFixed(1) : "0"}%</p>; })()}
        </div>
      ) : <p className="text-sm text-white/40">لا بيانات بعد.</p>)}
      {sec === "audit" && (view?.items?.length ? (
        <div className={`rounded-3xl p-3 text-[12px] ${GLASS}`}>
          {view.items.map((a: any) => (
            <p key={a.id} className="border-b border-white/5 py-1.5"><span className="text-white/40">{when(a.created_at)}</span> · {a.action}{a.target ? ` → ${a.target}` : ""} <span className="text-white/40">({a.via === "app" ? "التطبيق" : a.admin_id === "system" ? "تلقائي" : "البوت"})</span></p>
          ))}
        </div>
      ) : data && <Empty icon="🧾" text="لا توجد إجراءات مسجّلة بعد." />)}
    </div>
  );
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return <motion.button whileTap={{ scale: 0.85 }} title={title} aria-label={title} onClick={() => { haptic("light"); onClick(); }} className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-sm">{children}</motion.button>;
}

function confirmTg(text: string): Promise<boolean> {
  return new Promise((res) => (tg()?.showConfirm ? tg().showConfirm(text, (ok: boolean) => res(ok)) : res(window.confirm(text))));
}

// ---------------------------------------------------------------------------------------------
// 🔥 Swipe discovery
function DiscoverTab({ api, say, me, onMatch, onCompliment, onSuper, onUsed, onGo, onInfo, onMessage }: { api: any; say: any; me: any; onInfo: (c: Card) => void; onMessage: (c: Card) => void; onMatch: (c: Card) => void; onCompliment: (c: Card) => void; onSuper: (c: Card, done: () => void) => void; onUsed: () => void; onGo?: (t: Tab) => void }) {
  const [canRewind, setCanRewind] = useState(false);
  // ↩️ paid rewind (same price/function as the bot's «↩️ السابق»).
  const rewind = async () => {
    const price = me?.rewindPrice ?? 0.5;
    if (!(await confirmTg(`استرجاع آخر ملف تخطّيته بـ $${price} من رصيدك؟`))) return;
    const r = await api("rewind");
    if (!r.ok) { say(r.error, "error"); if (/لا يوجد/.test(r.error || "")) setCanRewind(false); return; }
    haptic("success"); say(r.message);
    setDeck((d) => [r.item, ...(d || []).filter((x) => x.ref !== r.item.ref)]);
    onUsed();
  };
  const [deck, setDeck] = useState<Card[] | null>(null);
  const [strict, setStrict] = useState(false);
  const [gender, setGender] = useState<"" | "MALE" | "FEMALE">(me?.cardGender?.gender || "");
  const [photos, setPhotos] = useState<Record<string, string>>({});
  // 🚻 Mixed cards by default; a specific gender is the paid filter (server re-checks).
  const pickGender = async (g: "" | "MALE" | "FEMALE") => {
    haptic("select");
    if (g && !me?.cardGender?.owned) { say(`🚻 فلتر جنس البطاقات ميزة مدفوعة ($${me?.cardGender?.price ?? 2} / 30 يوماً، مشمولة في الذهبية)`, "error"); onGo?.("me"); return; }
    const r = await api("card_gender", { gender: g || null });
    if (!r.ok) { say(r.error, "error"); return; }
    setGender(g);
  };

  const load = useCallback(async () => {
    setDeck(null);
    const r = await api("discover", { strict });
    if (!r.ok) { say(r.error, "error"); setDeck([]); return; }
    setDeck(r.items);
  }, [api, say, strict, gender]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const top = deck?.[0];
    if (top) api("seen", { target: top.ref }); // same visit tracking as the bot's card
    // Prefetch the photos of the visible stack (top 3) so the next card is ready.
    // in parallel and a little deeper, and decode each image before it is needed, so the next card is already there when the first is gone
    for (const c of (deck || []).slice(0, 5)) if (c.photo && !photos[c.ref]) api("photo", { target: c.ref }).then((r: any) => { if (!r.ok) return; try { const im = new Image(); im.src = r.src; } catch {} setPhotos((p) => ({ ...p, [c.ref]: r.src })); });
  }, [deck]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const w = tg();
    if (!w?.MainButton) return;
    w.MainButton.setParams({ text: "🔄 تحديث المطابقات", color: "#ff2e93", text_color: "#ffffff", is_visible: !!deck && deck.length === 0 });
    const h = () => load();
    w.MainButton.onClick(h);
    return () => { w.MainButton.offClick(h); w.MainButton.hide(); };
  }, [deck, load]);

  const act = async (kind: "like" | "super" | "pass" | "propose") => {
    const card = deck?.[0];
    if (!card) return;
    haptic(kind === "pass" ? "light" : kind === "super" ? "heavy" : "medium");
    if (kind === "super") { onSuper(card, () => setDeck((d) => (d ? d.filter((x) => x.ref !== card.ref) : d))); return; }
    if (kind !== "propose") setDeck((d) => (d ? d.slice(1) : d));
    if (kind === "pass") setCanRewind(true);
    if (kind === "pass") {
      // A skip is fire-and-forget: the card already advanced, so a slow/dropped request
      // must never surface «تعذّر الاتصال». One quiet retry, then ignore.
      void api("swipe", { target: card.ref, kind }).then((r: any) => (r?.ok ? r : api("swipe", { target: card.ref, kind })));
      return;
    }
    // One quiet retry for a dropped request; if it still fails the card comes back instead of being lost.
    let r = await api("swipe", { target: card.ref, kind });
    if (!r.ok && r.error === "تعذّر الاتصال") r = await api("swipe", { target: card.ref, kind });
    if (!r.ok) { if (kind === "like") setDeck((d) => (d && !d.some((x) => x.ref === card.ref) ? [card, ...d] : d)); say(r.error, "error"); return; }
    if (r.message) say(r.message);
    if (r.match) onMatch({ ...card, ...r.card });
  };

  const genderBar = (
    <div className="mb-2 flex items-center gap-1.5 text-xs" role="group" aria-label="جنس البطاقات">
      {([["", "👫 الكل"], ["FEMALE", "👩 نساء"], ["MALE", "👨 رجال"]] as const).map(([g, l]) => (
        <button key={g} onClick={() => pickGender(g)} className={`rounded-full px-3 py-1 ${gender === g ? GRAD : "border border-white/15 text-white/70"}`}>
          {l}{g && !me?.cardGender?.owned ? " 🔒" : ""}
        </button>
      ))}
    </div>
  );
  const strictBar = (<>{genderBar}
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className="text-white/50">{strict ? "🎯 بحث دقيق: كل مواصفاتك" : "🔍 البحث عن شريك"}</span>
      {me?.ent?.advancedFilters
        ? <button onClick={() => { haptic("select"); setStrict((v) => !v); }} className={`whitespace-nowrap rounded-full px-3 py-1 ${strict ? GRAD : "border border-white/15"}`}>🎯 بحث دقيق</button>
        : <span className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1 text-white/35">🎯 بحث دقيق (للمشتركين)</span>}
    </div></>
  );
  if (!deck) return <div>{strictBar}<DeckSkeleton /></div>;
  if (deck.length === 0) return (
    <div>{strictBar}
      <Empty icon="✨" text="شاهدت كل المطابقات الحالية. جرّب أحد هذه الخيارات:" action="🔄 تحديث" onAction={load} />
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {canRewind && <button onClick={rewind} className={`rounded-2xl p-3 ${GLASS}`}>↩️ استرجاع آخر ملف<span className="block text-[10px] text-white/45">${me?.rewindPrice ?? 0.5}</span></button>}
        <button onClick={() => onGo?.("anon")} className={`rounded-2xl p-3 ${GLASS}`}>🔀 دردشة مجهولة<span className="block text-[10px] text-white/45">تعارف فوري</span></button>
        <button onClick={() => onGo?.("me")} className={`rounded-2xl p-3 ${GLASS}`}>💍 وسّع المعايير<span className="block text-[10px] text-white/45">نتائج أكثر</span></button>
        {!me?.ent?.boosted && <button onClick={() => onGo?.("me")} className={`rounded-2xl p-3 ${GLASS}`}>🚀 ارفع ملفك<span className="block text-[10px] text-white/45">ليجدك الآخرون أولاً</span></button>}
      </div>
    </div>
  );

  return (
    <div>
      {strictBar}
      <div className="relative mt-2 h-[min(540px,calc(100dvh-300px))] min-h-[400px]">
        <AnimatePresence>
          {deck.slice(0, 3).reverse().map((c, i, arr) => (
            <SwipeCard key={c.ref} card={c} photo={photos[c.ref]} isTop={i === arr.length - 1} depth={arr.length - 1 - i}
              onSwipe={() => act("pass")} onTap={() => onInfo(c)}
              onPhotoRequest={async () => { const r = await api("photo_request", { target: c.ref }); say(r.message || r.error); }} />
          ))}
        </AnimatePresence>
      </div>
      {/* Floating actions over the photo (Tinder-style), above the bottom gradient */}
      <div data-testid="card-actions" className="pointer-events-none relative z-20 -mt-[92px] flex items-center justify-center gap-4 [&>*]:pointer-events-auto">
        <ActionBtn label="تخطي" size="md" tone="bg-rose-600" onClick={() => act("pass")}>✖️</ActionBtn>
        <ActionBtn label="رسالة" size="md" tone="bg-sky-500" glow="#60a5fa" onClick={() => deck[0] && onMessage(deck[0])}>💬</ActionBtn>
        <ActionBtn label="إعجاب" size="lg" glow="#ff2e93" gradient onClick={() => act("like")}>❤️</ActionBtn>
        <ActionBtn label="معلومات" size="md" tone="bg-slate-500" onClick={() => deck[0] && onInfo(deck[0])}>ℹ️</ActionBtn>
      </div>
      <div className="mt-3 flex items-center justify-center gap-3">
        {canRewind && <ActionBtn label={`السابق $${me?.rewindPrice ?? 0.5}`} size="sm" tone="bg-slate-500" onClick={rewind}>↩️</ActionBtn>}
        <ActionBtn label="مميز $1" size="sm" tone="bg-amber-500" glow="#fbbf24" onClick={() => act("super")}>⭐</ActionBtn>
        <ActionBtn label="طلب زواج" size="sm" tone="bg-violet-600" glow="#a78bfa" onClick={() => act("propose")}>💍</ActionBtn>
        <ActionBtn label="مجاملة" size="sm" tone="bg-emerald-600" onClick={() => deck[0] && onCompliment(deck[0])}>💌</ActionBtn>
      </div>
      <p className="mt-3 text-center text-[11px] text-white/35">اسحب يميناً أو يساراً للتخطي · الإعجاب بزر ❤️</p>
    </div>
  );
}

function ActionBtn({ children, onClick, label, size, glow, gradient, tone }: { children: React.ReactNode; onClick: () => void; label: string; size: "sm" | "md" | "lg"; glow?: string; gradient?: boolean; tone?: string }) {
  const dim = size === "lg" ? "h-16 w-16 text-2xl" : size === "md" ? "h-13 w-13 h-[52px] w-[52px] text-xl" : "h-11 w-11 text-lg";
  return (
    <div className="flex flex-col items-center gap-1">
      <motion.button whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.06 }} onClick={onClick} aria-label={label}
        className={`grid place-items-center rounded-full ring-2 ring-white/25 shadow-lg ${dim} ${gradient ? GRAD : tone || "bg-slate-600"}`} style={glow ? { boxShadow: `0 0 24px ${glow}66` } : undefined}>{children}</motion.button>
      <span className="text-[10px] text-white/45">{label}</span>
    </div>
  );
}

function SwipeCard({ card, photo, isTop, depth, onSwipe, onPhotoRequest, onTap }: { card: Card; photo?: string; isTop: boolean; depth: number; onSwipe: (d: "left" | "right" | "up") => void; onPhotoRequest: () => void; onTap?: () => void }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
    const nopeOp = useTransform(x, [-120, -30], [1, 0]);
  const skipRightOp = useTransform(x, [30, 120], [0, 1]);
    const [exit, setExit] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const end = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    // Dragging either way only skips the card; liking is the ❤️ button (owner, 2026-10-18: a drag must never send a like or a paid super like).
    if (offset.x > 110 || velocity.x > 700) { setExit({ x: 600, y: 0 }); onSwipe("right"); }
    else if (offset.x < -110 || velocity.x < -700) { setExit({ x: -600, y: 0 }); onSwipe("left"); }
  };

  return (
    <motion.div
      className={`absolute inset-0 overflow-hidden rounded-[32px] border border-white/10 ${isTop ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ x, y, rotate, zIndex: 10 - depth, touchAction: "none" }}
      drag={isTop} dragElastic={0.7} dragDirectionLock dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }} onDragEnd={end}
      onTap={() => { if (isTop && Math.abs(x.get()) < 8 && Math.abs(y.get()) < 8) { haptic("light"); onTap?.(); } }}
      data-testid={isTop ? "top-card" : undefined}
      initial={{ scale: 0.92, opacity: 0, y: 20 }}
      animate={{ scale: 1 - depth * 0.05, y: depth * 14, opacity: 1 }}
      exit={{ x: exit.x || (Math.random() > 0.5 ? 600 : -600), y: exit.y, opacity: 0, transition: { duration: 0.3 } }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#1b2340] via-[#141a33] to-[#2a1530]" />
      {photo
        ? <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        : (
          <div className="absolute inset-0 flex flex-col items-center justify-start pt-16">
            <div className={`grid h-32 w-32 place-items-center rounded-full text-6xl ring-4 ring-white/10 shadow-[0_0_60px_rgba(255,46,147,0.35)] ${card.gender === "FEMALE" ? "bg-gradient-to-br from-[#ff7ab8] to-[#b76e79]" : "bg-gradient-to-br from-[#6d8cff] to-[#3b3f8f]"}`}>
              {card.gender === "FEMALE" ? "👩" : "👨"}
            </div>
            <p className="mt-3 text-[11px] text-white/45">{card.photo ? "… جارٍ تحميل الصورة" : card.photoLocked ? "🔒 الصورة تظهر بموافقة صاحبها" : "بطاقة تعريف — بلا صورة"}</p>
          </div>
        )}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      <div className="absolute top-4 inset-x-4 flex items-start justify-between">
        <span className={`rounded-full px-3 py-1 text-xs backdrop-blur-md ${card.presence.online ? "bg-emerald-500/25 text-emerald-200" : "bg-black/30 text-white/70"}`}>
          {card.presence.online ? "● " : ""}{card.presence.label}
        </span>
        <div className="flex flex-col items-end gap-1">
          {card.compat != null && <span className={`rounded-full px-3 py-1 text-xs font-bold ${GRAD}`}>💞 {card.compat}%</span>}
          {card.values != null && <span className="rounded-full bg-violet-600 px-3 py-1 text-xs font-bold">🧠 قيم {card.values}%</span>}
        </div>
      </div>

      <motion.span style={{ opacity: skipRightOp }} className="absolute top-20 left-6 -rotate-12 rounded-xl border-4 border-rose-400 px-3 py-1 text-2xl font-black text-rose-300">تخطي</motion.span>
      <motion.span style={{ opacity: nopeOp }} className="absolute top-20 right-6 rotate-12 rounded-xl border-4 border-rose-400 px-3 py-1 text-2xl font-black text-rose-300">تخطي</motion.span>

      <div className="absolute bottom-0 inset-x-0 p-5 pb-28">
        <h2 className="text-2xl font-extrabold">
          {card.flag} {card.name || `#${card.shortId}`}<span className="font-light">، {card.age}</span> {card.verified && <span title="موثّق" className="text-sky-300">☑️</span>}{card.tgv && !card.verified && <span title="حساب تيليجرام موثّق" className="text-sky-300">🔹</span>}
          {card.boosted && <span className="mr-2 text-sm">🚀</span>}
        </h2>
        <p className="text-sm text-white/70">{card.country}{card.city ? ` · ${card.city}` : ""}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[card.job && `💼 ${card.job}`, card.education && `🎓 ${card.education}`, card.maritalStatus && `💍 ${card.maritalStatus}`].filter(Boolean).map((t) => (
            <span key={t as string} className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] backdrop-blur">{t}</span>
          ))}
        </div>
        {card.photoLocked && isTop && (
          <button onPointerDown={(e) => e.stopPropagation()} onClick={onPhotoRequest} className="mt-3 rounded-full border border-[#e8b4a0]/50 px-3 py-1 text-[11px] text-[#f3cbbd]">🔒 اطلب رؤية الصورة</button>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------------------------
// 💬 Chats
type Thread = Card & { last: string; at: string; lastMine: boolean; unread: number; matched: boolean };
function ChatsTab({ api, say, hasProfile, goAnon, onCompliment, athar, onOpenChat, onRead }: { api: any; say: any; hasProfile: boolean; goAnon: () => void; onCompliment: (c: Card) => void; athar?: { bot: string; today: string; home?: string } | null; onOpenChat: (c: Card) => void; onRead?: () => void }) {
  const [seg, setSeg] = useState<"matches" | "requests">("matches");
  const [giftFor, setGiftFor] = useState<Card | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  useEffect(() => { if (hasProfile) api("dm_threads").then((r: any) => { setThreads(r.ok ? r.items : []); onRead?.(); }); else setThreads([]); }, [api, hasProfile]); // eslint-disable-line react-hooks/exhaustive-deps
  const reqThreads = (threads || []).filter((t) => !t.matched);
  const matchThreads = (threads || []).filter((t) => t.matched);
  const unreadOf = (l: Thread[]) => l.reduce((n, t) => n + t.unread, 0);
  const threadRow = (t: Thread) => (
    <motion.button key={"t" + t.ref} whileTap={{ scale: 0.98 }} onClick={() => onOpenChat(t)} className={`flex w-full items-center gap-3 rounded-3xl p-3 text-right ${GLASS}`}>
      <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl ${t.gender === "FEMALE" ? "bg-gradient-to-br from-[#ff7ab8] to-[#b76e79]" : "bg-gradient-to-br from-[#6d8cff] to-[#3b3f8f]"}`}>{t.gender === "FEMALE" ? "👩" : "👨"}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{t.flag} {t.name || `#${t.shortId}`} · {t.age}</p>
        <p className="truncate text-xs text-white/55">{t.lastMine ? "أنت: " : ""}{t.last}</p>
      </div>
      {t.unread > 0 && <span className="min-w-5 rounded-full bg-pink-500 px-1.5 text-center text-[10px] font-bold leading-5">{t.unread}</span>}
    </motion.button>
  );
  const [moments, setMoments] = useState<{ kind: string; day: string; link: string }[]>([]);
  useEffect(() => { if (athar) api("athar_moments").then((r: any) => r?.ok && setMoments(r.items || [])); }, [api, athar]);
  const [matches, setMatches] = useState<Card[] | null>(null);
  const [anon, setAnon] = useState<Poll | null>(null);
  const [likedMe, setLikedMe] = useState<(Card & { note?: string | null })[] | null>(null);
  useEffect(() => {
    api("anon_poll", { after: 0 }).then((r: any) => r.ok && setAnon(r));
    if (hasProfile) { api("matches").then((r: any) => setMatches(r.ok ? r.items : [])); api("liked_me").then((r: any) => setLikedMe(r.ok ? r.items : [])); }
    else { setMatches([]); setLikedMe([]); }
  }, [api, hasProfile]);

  const segBar = (
    <div className={`grid grid-cols-2 gap-1 rounded-2xl p-1 ${GLASS}`} role="tablist">
      {([["matches", "💞 المطابقات", unreadOf(matchThreads)], ["requests", "📨 طلبات من غرباء", unreadOf(reqThreads)]] as const).map(([k, l, n]) => (
        <button key={k} role="tab" aria-selected={seg === k} onClick={() => { haptic("select"); setSeg(k); }} className={`relative rounded-xl py-2 text-xs font-bold ${seg === k ? GRAD : "text-white/60"}`}>
          {l}{n > 0 && <span className="mr-1 rounded-full bg-white/25 px-1.5 text-[10px]">{n}</span>}
        </button>
      ))}
    </div>
  );
  if (seg === "requests") return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">المحادثات</h2>
      {segBar}
      <p className="text-[11px] text-white/45">رسائل من أعضاء لم يحدث بينكم إعجاب متبادل: 3 رسائل مجانية لكل طرف، ثم تُفتح المحادثة بترقية بسيطة.</p>
      {!threads && <RowSkeleton />}
      {threads && reqThreads.length === 0 && <p className="text-sm text-white/40">لا توجد طلبات بعد.</p>}
      {reqThreads.map(threadRow)}
    </div>
  );
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">المحادثات</h2>
      <AnimatePresence>{giftFor && <GiftSheet key="gift" api={api} say={say} card={giftFor} onClose={() => setGiftFor(null)} />}</AnimatePresence>
      {segBar}
      {athar && <AtharEntry athar={athar} api={api} where="chats" variant="full" title="هدية لا تُنسى لشريكك" />}
      {matchThreads.length > 0 && <div className="space-y-2">{matchThreads.map(threadRow)}</div>}
      <motion.button whileTap={{ scale: 0.98 }} onClick={goAnon} className={`flex w-full items-center gap-3 rounded-3xl p-4 text-right ${GLASS}`}>
        <div className={`grid h-12 w-12 place-items-center rounded-full ${GRAD}`}>🎭</div>
        <div className="flex-1">
          <p className="font-bold">الدردشة المجهولة</p>
          <p className="text-xs text-white/50">
            {anon?.state === "chatting" ? `محادثة نشطة · ${anon.messages?.length ?? 0} رسالة` : anon?.state === "waiting" ? "جارٍ البحث…" : "لا توجد محادثة نشطة — ابدأ واحدة"}
          </p>
        </div>
        {anon?.state === "chatting" && <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />}
      </motion.button>

      {moments.map((m) => (
        <div key={m.kind + m.day} className="relative rounded-3xl border border-[#e8b4a0]/40 bg-gradient-to-l from-[#ff2e93]/15 to-[#e8b4a0]/10 p-4 text-sm">
          <button onClick={() => { api("athar_dismiss", { kind: m.kind, day: m.day }); setMoments((x) => x.filter((y) => y !== m)); }} className="absolute left-3 top-2 text-white/40" aria-label="إخفاء">✕</button>
          <p className="font-bold">🎁 {m.kind === "proposal" ? "أهدِ شريكك ذكرى يوم القبول" : "أهدِ شريكك تاريخ أول محادثة"}</p>
          <p className="mt-1 text-[11px] text-white/60">{new Date(m.day + "T00:00:00Z").toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })} — ذكرى خاصة بكما في «أثر».</p>
          <button onClick={() => openAthar(m.link, "gift", api)} className={`mt-2 rounded-2xl px-4 py-2 text-xs font-bold ${GRAD}`}>🕰 افتح التاريخ في أثر</button>
        </div>
      ))}
      <h3 className="pt-2 text-sm text-white/60">💞 إعجابات متبادلة</h3>
      {!matches && <RowSkeleton tall />}
      {matches?.length === 0 && <p className="text-sm text-white/40">لا توجد إعجابات متبادلة بعد. استمر في التصفح 🔥</p>}
      {matches?.map((c) => (
        <motion.div key={c.ref} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-3xl p-4 ${GLASS}`}>
          <div className="flex items-center gap-3">
            <div className={`relative grid h-12 w-12 place-items-center rounded-full text-2xl ${c.gender === "FEMALE" ? "bg-gradient-to-br from-[#ff7ab8] to-[#b76e79]" : "bg-gradient-to-br from-[#6d8cff] to-[#3b3f8f]"}`}>
              {c.gender === "FEMALE" ? "👩" : "👨"}
              {c.presence.online && <span className="absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-[#0b1020] bg-emerald-400" />}
            </div>
            <div className="flex-1">
              <p className="font-bold">{c.flag} {c.name || `#${c.shortId}`} · {c.age}</p>
              <p className="text-xs text-white/50">{c.country}{c.compat != null ? ` · 💞 ${c.compat}%` : ""} · {c.presence.label}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => onOpenChat(c)} className={`flex-1 rounded-2xl py-2 text-sm font-bold ${GRAD}`}>💬 رسالة</button>
            <button aria-label="دردشة مجهولة" onClick={async () => { const r = await api("request", { target: c.ref }); say(r.ok ? `${r.message || "📨 أُرسل الطلب"} — عند القبول تُفتح المحادثة هنا في تبويب 🔀` : r.error, r.ok ? "success" : "error"); }} className="rounded-2xl border border-white/15 px-3 text-sm">🎭</button>
            <button onClick={async () => { const r = await api("swipe", { target: c.ref, kind: "propose" }); say(r.message || r.error, r.ok ? "success" : "error"); }} className="rounded-2xl border border-[#e8b4a0]/40 px-3 text-sm">💍</button>
            <button onClick={() => onCompliment(c)} className="rounded-2xl border border-white/15 px-3 text-sm">🌹</button>
            <button aria-label="هدية" onClick={() => { haptic("light"); setGiftFor(c); }} className="rounded-2xl border border-amber-300/40 bg-amber-400/10 px-3 text-sm">🎁</button>
            <button aria-label="مشاركة" onClick={async () => { const r = await api("share_match", { target: c.ref }); if (!r.ok) { say(r.error, "error"); return; } const u = `https://t.me/share/url?url=${encodeURIComponent(r.url)}&text=${encodeURIComponent("💞 تطابق جديد على توافق")}`; const w = tg(); if (w?.openTelegramLink) w.openTelegramLink(u); else window.open(u); }} className="rounded-2xl border border-white/15 px-3 text-sm">🔗</button>
          </div>
          {(c as any).metLink && (
            <button onClick={() => openAthar((c as any).metLink, "month", api)} className="mt-2 w-full rounded-2xl border border-[#e8b4a0]/30 bg-white/5 px-3 py-2 text-right text-[12px]">
              🗓 مرّ {Math.floor(((c as any).metDays || 30) / 30) > 1 ? `${Math.floor((c as any).metDays / 30)} أشهر` : "شهر"} على تعارفكما — احتفظا بذكرى يوم الإعجاب المتبادل في «أثر»
            </button>
          )}
        </motion.div>
      ))}
      <h3 className="pt-2 text-sm text-white/60">💌 من أعجب بي {likedMe?.length ? <span className="rounded-full bg-pink-500/80 px-1.5 text-[10px] font-bold text-white">{likedMe.length}</span> : null}</h3>
      {likedMe?.length === 0 && <p className="text-sm text-white/40">لا أحد بعد — ملف كامل بصورة يزيد الإعجابات ✨</p>}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {likedMe?.filter((c) => !matches?.some((m) => m.ref === c.ref)).map((c) => (
          <div key={c.ref} className={`min-w-[140px] rounded-3xl p-3 text-center ${GLASS}`}>
            <div className="text-2xl">{c.gender === "FEMALE" ? "👩" : "👨"}</div>
            <p className="text-sm font-bold">{c.flag} {c.name || `#${c.shortId}`} · {c.age}</p>
            {c.note && <p className="mt-1 line-clamp-2 text-[11px] text-[#f3cbbd]">⭐ «{c.note}»</p>}
            <button onClick={async () => { const r = await api("swipe", { target: c.ref, kind: "like" }); say(r.ok ? (r.match ? "💞 إعجاب متبادل!" : "❤️ تم") : r.error, r.ok ? "success" : "error"); if (r.ok) { setLikedMe((l) => l?.filter((x) => x.ref !== c.ref) ?? l); if (r.match) setMatches((m) => [...(m || []), c]); } }}
              className={`mt-2 w-full rounded-2xl py-1.5 text-xs font-bold ${GRAD}`}>❤️ أعجبني أيضاً</button>
          </div>
        ))}
      </div>
      {/* one quiet banner at the very bottom of the chats list: never over a profile, a chat or a payment */}
      <div className="flex justify-center pt-1" data-testid="chats-ad"><AdsterraBanner adKey="560a1eb1632771185b888243a7d36a07" width={320} height={50} /></div>
      <p className="text-center text-[11px] text-white/35">عند قبول طلب الدردشة تُفتح المحادثة داخل التطبيق (تبويب 🔀) ما دام التطبيق مفتوحاً، وإلا تصلك في البوت.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 👤 Profile, criteria, privacy, and ⭐ upgrades (the bot's own paid system)
function MeTab({ api, say, me, reload }: { api: any; say: any; me: any; reload: () => Promise<any> }) {
  const [section, setSection] = useState<"upgrades" | "profile" | "pref" | "privacy">(me?.profile ? "upgrades" : "profile");
  const [profile, setProfile] = useState<Record<string, any>>(blank(me?.profile, emptyProfile));
  const [pref, setPref] = useState<Record<string, any>>(blank(me?.preference, emptyPref));
  const busy = useRef(false);

  const save = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const w = tg();
    w?.MainButton?.showProgress?.();
    try {
      const r = section === "profile" ? await api("saveProfile", { profile }) : await api("savePref", { preference: pref });
      if (r.ok) { say(section === "profile" ? (r.status === "APPROVED" ? "✅ حُفظ ملفك" : "✅ حُفظ وهو قيد المراجعة") : "✅ حُفظت المواصفات"); reload(); }
      else say(r.error, "error");
    } finally { w?.MainButton?.hideProgress?.(); busy.current = false; }
  }, [api, profile, pref, reload, say, section]);

  useEffect(() => {
    const w = tg();
    if (!w?.MainButton) return;
    const show = section === "profile" || section === "pref";
    w.MainButton.setParams({ text: "💾 حفظ", color: "#ff2e93", text_color: "#ffffff", is_visible: show });
    w.MainButton.onClick(save);
    return () => { w.MainButton.offClick(save); w.MainButton.hide(); };
  }, [section, save]);

  const p = me?.profile;
  const ent = me?.ent || {};
  const set = (o: any, f: any, k: string) => (v: string) => f({ ...o, [k]: v });

  return (
    <div>
      {p && (
        <div className={`mb-4 flex items-center gap-3 rounded-3xl p-4 ${GLASS}`}>
          <div className={`grid h-14 w-14 place-items-center rounded-full text-3xl ${GRAD}`}>{p.gender === "FEMALE" ? "👩" : "👨"}</div>
          <div className="flex-1">
            <p className="font-bold">{p.flag} #{p.shortId} {p.verified && "☑️"} {ent.vip && <span className="text-amber-300 text-xs">👑</span>}</p>
            <p className="text-xs text-white/50">{p.status === "APPROVED" ? (p.isHidden ? "⏸ مخفي" : "🟢 ظاهر في البحث") : p.status === "PENDING" ? "⏳ قيد المراجعة" : "❌ مرفوض"}
              {ent.boosted ? " · 🚀 مرفوع" : ""}</p>
          </div>
        </div>
      )}
      {me?.athar && section !== "profile" && <AtharEntry athar={me.athar} api={api} where="me" />}
      <div className="mb-4 flex gap-1.5 overflow-x-auto">
        {([["upgrades", "⭐ الترقيات"], ["profile", "👤 ملفي"], ["pref", "💍 معايير الزواج"], ["privacy", "🔒 الخصوصية"]] as const).map(([k, l]) => (
          <Pill key={k} active={section === k} onClick={() => setSection(k)}>{l}</Pill>
        ))}
      </div>

      {section === "upgrades" && <UpgradeScreen api={api} say={say} me={me} reload={reload} />}

      {section === "profile" && me?.athar && <AtharBirthday api={api} say={say} athar={me.athar} />}
      {section === "profile" && (
        <div className={`rounded-3xl p-4 ${GLASS}`}>
          <div className="mb-3 flex gap-2">
            <Pill active={profile.gender === "MALE"} onClick={() => setProfile({ ...profile, gender: "MALE" })}>👨 ذكر</Pill>
            <Pill active={profile.gender === "FEMALE"} onClick={() => setProfile({ ...profile, gender: "FEMALE" })}>👩 أنثى</Pill>
          </div>
          <Field label="الاسم (لا يظهر لأحد خارج الإدارة)" value={profile.name} onChange={set(profile, setProfile, "name")} />
          <div className="flex gap-2">
            <div className="w-24"><Field label="العمر 18+" type="number" value={String(profile.age)} onChange={set(profile, setProfile, "age")} /></div>
            <div className="flex-1"><Field label="الدولة" value={profile.country} onChange={set(profile, setProfile, "country")} /></div>
          </div>
          <Field label="المدينة" value={profile.city} onChange={set(profile, setProfile, "city")} />
          <Field label="العمل" value={profile.job} onChange={set(profile, setProfile, "job")} />
          <Field label="التعليم" value={profile.education} onChange={set(profile, setProfile, "education")} />
          <Field label="الحالة الاجتماعية" value={profile.maritalStatus} onChange={set(profile, setProfile, "maritalStatus")} />
          <Field label="نبذة (بدون أرقام أو حسابات)" area value={profile.attributes} onChange={set(profile, setProfile, "attributes")} />
          <p className="mb-2 text-xs text-white/50">وسيلة التواصل — لا تُكشف إلا بموافقة الطرفين</p>
          <div className="mb-3 flex gap-2">
            <Pill active={profile.contactMethod === "TELEGRAM"} onClick={() => setProfile({ ...profile, contactMethod: "TELEGRAM" })}>تلجرام</Pill>
            <Pill active={profile.contactMethod === "WHATSAPP"} onClick={() => setProfile({ ...profile, contactMethod: "WHATSAPP" })}>واتساب</Pill>
          </div>
          <Field label={profile.contactMethod === "WHATSAPP" ? "رقم واتساب" : "معرّف تلجرام"} value={profile.contactValue} onChange={set(profile, setProfile, "contactValue")} />
          <p className="text-[11px] text-white/40">الصورة والتسجيل الصوتي يُضافان من داخل البوت. للبالغين 18+ فقط.</p>
          {!tg()?.MainButton && <button onClick={save} className={`mt-3 w-full rounded-2xl py-3 font-bold ${GRAD}`}>💾 حفظ</button>}
        </div>
      )}

      {section === "pref" && <QuizCard api={api} say={say} done={!!me?.quizDone} reload={reload} />}
      {section === "pref" && (
        <div className={`rounded-3xl p-4 ${GLASS}`}>
          <Field label="الدولة المفضلة" value={pref.country} onChange={set(pref, setPref, "country")} />
          <div className="flex gap-2">
            <div className="flex-1"><Field label="العمر من" type="number" value={String(pref.ageMin)} onChange={set(pref, setPref, "ageMin")} /></div>
            <div className="flex-1"><Field label="إلى" type="number" value={String(pref.ageMax)} onChange={set(pref, setPref, "ageMax")} /></div>
          </div>
          <Field label="العمل" value={pref.job} onChange={set(pref, setPref, "job")} />
          <Field label="التعليم" value={pref.education} onChange={set(pref, setPref, "education")} />
          <Field label="صفات أخرى (كلمات مفتاحية)" area value={pref.attributes} onChange={set(pref, setPref, "attributes")} />
          <div className={`mt-2 rounded-2xl border p-3 ${ent.advancedFilters ? "border-pink-400/30" : "border-white/10 opacity-60"}`}>
            <p className="mb-2 text-xs font-bold">🎯 فلاتر متقدمة {ent.advancedFilters ? "(مفعّلة)" : "— من «⭐ الترقيات»"}</p>
            {ent.advancedFilters ? <>
              <Field label="مدينة الشريك" value={pref.city} onChange={set(pref, setPref, "city")} />
              <Field label="الحالة الاجتماعية" value={pref.maritalStatus} onChange={set(pref, setPref, "maritalStatus")} />
            </> : <button onClick={() => setSection("upgrades")} className="text-xs text-[#f3cbbd]">فعّلها لإضافة المدينة والحالة الاجتماعية والبحث الدقيق ←</button>}
          </div>
          {!tg()?.MainButton && <button onClick={save} className={`mt-3 w-full rounded-2xl py-3 font-bold ${GRAD}`}>💾 حفظ</button>}
        </div>
      )}

      {section === "privacy" && (
        <div className={`divide-y divide-white/10 rounded-3xl px-4 ${GLASS}`}>
          {!p && <p className="py-4 text-sm text-white/50">أنشئ ملفك أولاً.</p>}
          {p && <>
            <Toggle on={!p.isHidden} label="إظهار ملفي في البحث" hint="يشمل البحث المضمّن والتطبيق" onChange={async (v) => { const r = await api("privacy", { visible: v }); say(r.ok ? "تم" : r.error); reload(); }} />
            <Toggle on={!!me?.privacy?.countryOnly} label="إظهار ملفي لدولتي فقط" onChange={async (v) => { const r = await api("privacy", { countryOnly: v }); say(r.ok ? "تم" : r.error); reload(); }} />
            {ent.incognitoAvailable
              ? <Toggle on={!!ent.incognitoOn} label="🕶 وضع التخفي (ضمن الذهبية)" hint="تتصفح دون تسجيل زيارتك" onChange={async (v) => { const r = await api("upgrade", { key: "incognito", on: v }); say(r.message || r.error, r.ok ? "success" : "error"); reload(); }} />
              : <p className="py-3 text-xs text-white/40">🕶 وضع التخفي متاح ضمن 👑 العضوية الذهبية.</p>}
          </>}
          <p className="py-3 text-[11px] leading-5 text-white/40">لا نعرض اسمك أو حسابك أو رقمك لأي عضو. الصورة تظهر فقط لمن تسمح له. الحظر والإبلاغ متاحان في كل بطاقة ومحادثة.</p>
        </div>
      )}
    </div>
  );
}

// ⭐ Upgrade screen — mirrors the bot's «⭐ الترقيات والمزايا» keyboard and its purchase path
// (balance in USD, topped up by the same Stars invoice / payment page / TON memo).
function UpgradeScreen({ api, say, me, reload }: { api: any; say: any; me: any; reload: () => Promise<any> }) {
  const ent = me?.ent || {};
  const [visitors, setVisitors] = useState<any[] | null>(null);
  const [ton, setTon] = useState<{ address: string; memo: string } | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const depositRef = useRef<HTMLDivElement>(null);

  const state = (key: string): string | null => {
    if (key === "vip") return ent.vip ? `مفعّلة حتى ${new Date(ent.vipUntil).toLocaleDateString("ar")}` : null;
    if (key === "boost") return ent.vip ? "ضمن الذهبية" : ent.boostedUntil ? `مرفوع حتى ${new Date(ent.boostedUntil).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}` : null;
    if (key === "filters") return ent.advancedFilters ? (ent.vip ? "ضمن الذهبية" : "مفعّلة") : null;
    if (key === "visitors") return ent.profileVisitors ? (ent.vip ? "ضمن الذهبية" : "مفعّلة") : null;
    if (key === "photos") return ent.extraPhotos ? (ent.vip ? "ضمن الذهبية" : "مفعّلة") : null;
    if (key === "anonFilters") return me?.anonFilters?.owned ? (me.anonFilters.viaVip ? "ضمن الذهبية" : `مفعّلة حتى ${new Date(me.anonFilters.until).toLocaleDateString("ar")}`) : null;
    if (key === "verify") return ent.verification === "VERIFIED" ? "موثّق ☑️" : ent.verification === "PENDING" ? "قيد المراجعة" : null;
    return null;
  };

  const buy = async (key: string, price: number) => {
    if (key === "visitors" && ent.profileVisitors) { openVisitors(); return; }
    const paidAlready = !!state(key) && key !== "photos" && key !== "verify";
    if (paidAlready && key !== "boost" && !(key === "anonFilters" && !me?.anonFilters?.viaVip)) return;
    if (key === "anonFilters" && me?.anonFilters?.viaVip) return;
    const ok = key === "verify" || key === "photos" && ent.extraPhotos ? true
      : await confirmTg(`تأكيد الشراء بـ $${price} من رصيدك؟`);
    if (!ok) return;
    setBuying(key); haptic("medium");
    const r = await api("upgrade", { key });
    setBuying(null);
    if (!r.ok && r.insufficient && r.stars) {
      // ⚡ One tap: pay only the shortfall in Stars; the feature activates automatically.
      if (await confirmTg(`${r.error}\n\n⚡ اشترِ الآن بـ ${r.stars} نجمة (الفرق $${Number(r.shortfall).toFixed(2)}) وتُفعَّل الميزة تلقائياً؟`)) { await buyStars(key); return; }
    } else say(r.message || r.error, r.ok ? "success" : "error");
    if (!r.ok && /لا يكفي/.test(r.error || "")) depositRef.current?.scrollIntoView({ behavior: "smooth" });
    if (r.toBot) tg()?.close?.();
    if (r.open === "visitors") openVisitors();
    reload();
  };
  const buyStars = async (key: string) => {
    setBuying(key); haptic("medium");
    const r = await api("buy_stars", { key });
    setBuying(null);
    if (!r.ok) { say(r.error, "error"); return; }
    if (r.direct) { say(r.message); reload(); return; }
    const w = tg();
    const done = (status: string) => {
      if (status === "paid") { say("✅ تم الدفع — تُفعَّل الميزة خلال لحظات"); [2500, 6000].forEach((ms) => window.setTimeout(reload, ms)); }
      else if (status === "failed") say("تعذّر الدفع", "error");
    };
    if (w?.openInvoice) w.openInvoice(r.link, done); else window.open(r.link);
  };
  useEffect(() => { api("track", { event: "upgrades_view" }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openVisitors = async () => { const r = await api("visitors"); if (r.ok) setVisitors(r.items); else say(r.error, "error"); };

  const payStars = async (stars: number) => {
    haptic("medium");
    const r = await api("deposit_stars", { stars });
    if (!r.ok) { say(r.error, "error"); return; }
    const w = tg();
    if (w?.openInvoice) w.openInvoice(r.link, (status: string) => { if (status === "paid") { say("✅ تم الدفع — يُضاف الرصيد خلال لحظات"); window.setTimeout(reload, 2500); } });
    else window.open(r.link);
  };

  return (
    <div className="space-y-3">
      <div className={`relative overflow-hidden rounded-3xl p-5 ${GLASS}`}>
        <div className={`absolute -left-8 -top-8 h-28 w-28 rounded-full opacity-40 blur-2xl ${GRAD}`} />
        <p className="text-xs text-white/50">💰 رصيدك</p>
        <p className="text-3xl font-black">${Number(ent.balance ?? 0).toFixed(2)}</p>
        <p className="mt-1 text-[11px] text-white/40">نفس رصيد البوت — كل الميزات تُخصم منه. ينقصك رصيد؟ «⚡ اشترِ الآن» يدفع الفرق فقط بالنجوم.</p>
      </div>
      {!!me?.firstDiscount && (
        <div className="rounded-3xl border border-[#e8b4a0]/40 bg-gradient-to-l from-[#ff2e93]/20 to-[#e8b4a0]/10 p-4 text-sm">
          🎁 <b>خصم {Math.round(me.firstDiscount * 100)}%</b> على أول ترقية تشتريها — يُطبّق تلقائياً مرة واحدة.
        </div>
      )}

      <div className="space-y-2">
        {(me?.catalogue || []).map((c: any) => {
          const st = state(c.key);
          const isVipCard = c.key === "vip";
          return (
            <motion.div key={c.key} layout className={`rounded-3xl p-4 ${GLASS} ${isVipCard ? "border-amber-300/40 shadow-[0_0_30px_rgba(251,191,36,0.15)]" : ""}`}>
              <div className="flex items-center gap-3">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl ${isVipCard ? "bg-gradient-to-br from-amber-300 to-amber-600" : "bg-white/10"}`}>{c.icon}</div>
                <div className="flex-1">
                  <p className="font-bold">{c.title} <span className="text-xs font-normal text-white/45">· {me?.firstDiscount && c.key !== "verify" ? <><s>${c.price}</s> <b className="text-[#f3cbbd]">${(Math.round(c.price * (1 - me.firstDiscount) * 100) / 100).toFixed(2)}</b></> : `$${c.price}`} / {c.unit}</span></p>
                  <p className="text-[11px] leading-5 text-white/50">{c.desc}</p>
                  {st && <p className="mt-0.5 text-[11px] text-emerald-300">✓ {st}</p>}
                </div>
                <motion.button whileTap={{ scale: 0.9 }} disabled={buying === c.key} onClick={() => buy(c.key, c.price)}
                  className={`shrink-0 rounded-2xl px-3 py-2 text-xs font-bold disabled:opacity-50 ${st && !["boost", "photos", "visitors"].includes(c.key) && !(c.key === "anonFilters" && !me?.anonFilters?.viaVip) ? "border border-white/15 text-white/50" : isVipCard ? "bg-gradient-to-l from-amber-300 to-amber-500 text-black" : GRAD}`}>
                  {buying === c.key ? "…" : c.key === "visitors" && ent.profileVisitors ? "عرض" : c.key === "photos" && ent.extraPhotos ? "رفع" : c.key === "anonFilters" && st && !me?.anonFilters?.viaVip ? "تمديد" : st && !["boost"].includes(c.key) ? "مفعّل" : c.key === "verify" ? "ابدأ" : isVipCard && ent.vip ? "تمديد" : "شراء"}
                </motion.button>
              </div>
              {(me?.buyNowKeys || []).includes(c.key) && !st && Number(ent.balance ?? 0) < c.price * (1 - (me?.firstDiscount || 0)) && (
                <button disabled={buying === c.key} onClick={() => buyStars(c.key)} className="mt-2 w-full rounded-2xl border border-[#e8b4a0]/40 bg-white/5 py-1.5 text-[11px] text-[#f3cbbd] disabled:opacity-50">
                  ⚡ اشترِ الآن بالنجوم — تدفع الفرق فقط وتُفعَّل تلقائياً
                </button>
              )}
            </motion.div>
          );
        })}
        {ent.vip && <p className="px-2 text-[11px] text-white/40">«🎯 بحث دقيق» في تبويب المطابقات، و«🕶 وضع التخفي» في الخصوصية.</p>}
      </div>

      <AnimatePresence>
        {visitors && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className={`rounded-3xl p-4 ${GLASS}`}>
            <div className="mb-2 flex justify-between"><p className="font-bold">👀 آخر زوار ملفك</p><button onClick={() => setVisitors(null)} className="text-white/40">✖</button></div>
            {visitors.length === 0 && <p className="text-sm text-white/50">😔 لا يوجد زوار لملفك حتى الآن.</p>}
            {visitors.map((v, i) => <p key={i} className="border-b border-white/5 py-2 text-sm">{v.flag || "👤"} #{v.shortId}{v.age ? ` · ${v.age} · ${v.country}` : ""} <span className="text-xs text-white/40">— {v.at}</span></p>)}
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={depositRef} className={`rounded-3xl p-4 ${GLASS}`}>
        <p className="font-bold">💳 شحن الرصيد</p>
        <p className="mb-3 text-[11px] text-white/45">⭐ نجوم تيليجرام (نفس فاتورة البوت) — 100 نجمة = $1</p>
        <div className="grid grid-cols-3 gap-2">
          {(me?.deposit?.stars || []).map((t: any) => (
            <motion.button key={t.stars} whileTap={{ scale: 0.92 }} onClick={() => payStars(t.stars)} className="rounded-2xl border border-[#e8b4a0]/30 bg-white/5 py-2.5 text-sm">
              ⭐ {t.stars}<span className="block text-[10px] text-white/45">${t.usd.toFixed(2)}</span>
            </motion.button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {me?.deposit?.web && <button onClick={() => (tg()?.openLink ? tg().openLink(me.deposit.web) : window.open(me.deposit.web))} className="flex-1 rounded-2xl border border-white/15 py-2.5 text-xs">🌐 دفع بالعملات الرقمية</button>}
          {me?.deposit?.ton && <button onClick={async () => { const r = await api("deposit_ton"); if (r.ok) setTon(r); else say(r.error, "error"); }} className="flex-1 rounded-2xl border border-white/15 py-2.5 text-xs">🔷 TON / USDT مباشر</button>}
        </div>
        {ton && (
          <div className="mt-3 space-y-2 rounded-2xl bg-black/30 p-3 text-[11px] leading-5">
            <p>أرسل TON أو USDT (شبكة TON فقط) مع المذكرة بالضبط — بدونها لن يُحتسب الإيداع:</p>
            <CopyRow label="العنوان" value={ton.address} say={say} />
            <CopyRow label="المذكرة" value={ton.memo} say={say} />
          </div>
        )}
      </div>

      {me?.referral?.link && (
        <div className={`rounded-3xl p-4 ${GLASS}`}>
          <p className="font-bold">🔗 ادعُ أصدقاءك</p>
          <p className="text-[11px] text-white/50">عند اعتماد ملف أي صديق دعوته تحصل على رفع مجاني لملفك 24 ساعة، بحد أقصى {me.referral.cap ?? 3} مكافآت كل 30 يوماً (استخدمت {me.referral.rewardsLast30d ?? 0}). حصلت عليه إجمالاً {me.referral.rewarded} مرة.</p>
          <button onClick={() => { haptic("medium"); const u = `https://t.me/share/url?url=${encodeURIComponent(me.referral.link)}&text=${encodeURIComponent("انضم معي لبوت التعارف بغرض الزواج 💍")}`; tg()?.openTelegramLink ? tg().openTelegramLink(u) : window.open(u); }}
            className={`mt-3 w-full rounded-2xl py-2.5 text-sm font-bold ${GRAD}`}>📤 مشاركة رابطي</button>
        </div>
      )}
    </div>
  );
}

function CopyRow({ label, value, say }: { label: string; value: string; say: any }) {
  return (
    <button onClick={() => { navigator.clipboard?.writeText(value).then(() => say("نُسخ ✅")); }} className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-right">
      <span className="text-white/50">{label}</span><span className="truncate font-mono" dir="ltr">{value}</span><span>📋</span>
    </button>
  );
}

function Stat({ n, l }: { n: number | string; l: string }) {
  return <div><p className="text-xl font-extrabold bg-gradient-to-l from-[#ff7ab8] to-[#e8b4a0] bg-clip-text text-transparent">{n}</p><p className="text-[10px] text-white/50">{l}</p></div>;
}

// ---------------------------------------------------------------------------------------------
// Modals
function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">{children}</div>
    </motion.div>
  );
}

function MatchModal({ card, onClose, onChat, athar, api }: { card: Card; onClose: () => void; onChat: () => void; athar?: { bot: string; today: string; home?: string } | null; api?: any }) {
  useEffect(() => { haptic("success"); }, []);
  const hearts = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ i, x: Math.random() * 100, d: 2 + Math.random() * 2, s: 14 + Math.random() * 18 })), []);
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[#0b1020]/95 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {hearts.map((h) => (
        <motion.span key={h.i} className="absolute bottom-0" style={{ left: `${h.x}%`, fontSize: h.s }} initial={{ y: 40, opacity: 0 }} animate={{ y: -900, opacity: [0, 1, 0] }} transition={{ duration: h.d, repeat: Infinity, delay: h.i * 0.15 }}>💗</motion.span>
      ))}
      <motion.div initial={{ scale: 0.6, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="relative text-center">
        <h2 className="text-4xl font-black bg-gradient-to-l from-[#ff2e93] to-[#e8b4a0] bg-clip-text text-transparent drop-shadow">إنه توافق! 🎉</h2>
        <p className="mt-2 text-white/70">أنت و {card.name || `#${card.shortId}`} أُعجب كلٌّ منكما بالآخر</p>
        <div className="my-6 flex items-center justify-center">
          <div className={`grid h-24 w-24 place-items-center rounded-full border-4 border-[#0b1020] text-4xl ${GRAD}`}>💞</div>
          <div className="-mr-6 grid h-24 w-24 place-items-center rounded-full border-4 border-[#0b1020] bg-gradient-to-br from-[#6d8cff] to-[#ff7ab8] text-4xl">{card.gender === "FEMALE" ? "👩" : "👨"}</div>
        </div>
        <p className="mb-4 text-xs text-white/50">أرسل البوت تنبيهاً لكما في تلجرام</p>
        {athar?.today && (
          <button onClick={() => openAthar(athar.today, "match", api)} className="mb-3 w-full rounded-2xl border border-[#e8b4a0]/40 bg-white/5 px-4 py-3 text-right text-sm">
            🕰 <b>يومكم في أثر</b> — {new Date().toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" })}
            <span className="block text-[11px] text-white/50">احتفظا بذكرى يوم تعارفكما في «أثر» 🎁</span>
          </button>
        )}
        <button onClick={onChat} className={`w-full rounded-2xl py-3.5 font-bold ${GRAD}`}>💬 أرسل رسالة الآن</button>
        <button onClick={onClose} className="mt-2 w-full rounded-2xl border border-white/15 py-3">متابعة التصفح</button>
      </motion.div>
    </motion.div>
  );
}

function SuperLikeSheet({ balance, onSend, onClose }: { balance: number; onSend: (note: string) => Promise<void>; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: "spring", damping: 26 }}
        className={`w-full rounded-t-[32px] p-5 pb-8 ${GLASS} bg-[#0f1530]/95`}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <h3 className="font-bold">⭐ إعجاب مميز — $1</h3>
        <p className="mb-3 text-xs text-white/50">اكتب رسالة قصيرة ترافق إعجابك (تظهر في «💌 من أعجب بي»). رصيدك: ${balance.toFixed(2)}</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} rows={3} placeholder="مثلاً: أعجبني جدّيتك وطموحك 🌹"
          className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none focus:border-pink-400/60" />
        <button disabled={!note.trim() || busy} onClick={async () => { setBusy(true); await onSend(note.trim()); setBusy(false); }}
          className={`mt-3 w-full rounded-2xl py-3 font-bold disabled:opacity-40 ${GRAD}`}>{busy ? "…" : "إرسال ($1)"}</button>
      </motion.div>
    </motion.div>
  );
}

function ComplimentSheet({ list, left, onPick, onClose }: { list: string[]; left?: number; onPick: (i: number) => void; onClose: () => void }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: "spring", damping: 26 }}
        className={`w-full rounded-t-[32px] p-5 pb-8 ${GLASS} bg-[#0f1530]/95`}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <h3 className="font-bold">💌 مجاملة من معجب سرّي</h3>
        <p className="mb-3 text-xs text-white/50">تصل بلا اسمك. عبارات جاهزة فقط · متبقٍ اليوم: {left ?? 0}</p>
        <div className="space-y-2">
          {list.map((t, i) => (
            <motion.button key={t} whileTap={{ scale: 0.97 }} onClick={() => onPick(i)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-right text-sm">{t}</motion.button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}


// ---------------------------------------------------------------------------------------------
// 👋 First-run onboarding (3 short steps, once per device).
function Onboarding({ hasProfile, goProfile }: { hasProfile: boolean; goProfile: () => void }) {
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => { try { if (!localStorage.getItem("match_onb_v1")) setStep(0); } catch { /* storage blocked */ } }, []);
  if (step === null) return null;
  const steps = [
    ["💞", "أهلاً بك في توافق", "تعارف جادّ بهدف الزواج — هويتك محمية، ولا تظهر بيانات تواصلك إلا بموافقتك."],
    ["🔥", "المطابقات", "اسحب يميناً للإعجاب ويساراً للتخطي. إذا أعجب الطرفان ببعضهما يظهر «إعجاب متبادل»."],
    ["🔀", "الدردشة المجهولة", "تحدّث فوراً مع شخص عشوائي دون كشف الهوية. بعد 15 رسالة يمكنكما تبادل التواصل الرسمي."],
  ] as const;
  const close = () => { try { localStorage.setItem("match_onb_v1", "1"); } catch { /* ignore */ } setStep(null); };
  const [icon, title, text] = steps[step];
  const last = step === steps.length - 1;
  return (
    <motion.div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-6 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} role="dialog" aria-label="مرحباً">
      <motion.div key={step} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className={`w-full max-w-sm rounded-[32px] p-6 text-center ${GLASS}`}>
        <div className="mb-3 text-5xl">{icon}</div>
        <p className="text-xl font-black">{title}</p>
        <p className="mt-2 text-sm leading-6 text-white/70">{text}</p>
        <div className="my-4 flex justify-center gap-1.5">{steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full ${i === step ? `w-6 ${GRAD}` : "w-1.5 bg-white/25"}`} />)}</div>
        <button onClick={() => { if (last) { close(); if (!hasProfile) goProfile(); } else setStep(step + 1); }} className={`w-full rounded-2xl py-3 font-bold ${GRAD}`}>
          {last ? (hasProfile ? "ابدأ الآن" : "أنشئ ملفك") : "التالي"}
        </button>
        {!last && <button onClick={close} className="mt-2 text-xs text-white/45">تخطي</button>}
      </motion.div>
    </motion.div>
  );
}

// 🔔 In-app notifications: new likes / matches / visitors since the last check (every 30s while visible).
function Notifier({ api, say, enabled, onOpen }: { api: any; say: (m: string) => void; enabled: boolean; onOpen: () => void }) {
  const [badge, setBadge] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const key = "match_notif_since";
    const tick = async () => {
      if (stop || document.visibilityState !== "visible") return;
      let since = 0; try { since = Number(localStorage.getItem(key)) || Date.now(); } catch { since = Date.now(); }
      const r = await api("notifications", { since });
      if (stop || !r?.ok) return;
      try { localStorage.setItem(key, String(r.now)); } catch { /* ignore */ }
      const parts = [r.matches ? `💞 ${r.matches} إعجاب متبادل` : "", r.likes ? `💌 ${r.likes} إعجاب جديد` : "", r.visitors ? `👀 ${r.visitors} زيارة` : ""].filter(Boolean);
      if (parts.length) { const m = parts.join(" · "); setBadge(m); say(m); haptic("success"); }
    };
    const first = window.setTimeout(tick, 4000);
    const id = window.setInterval(tick, 30000);
    return () => { stop = true; window.clearTimeout(first); window.clearInterval(id); };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!badge) return null;
  return (
    <button onClick={() => { setBadge(null); onOpen(); }} className={`fixed left-4 top-20 z-40 max-w-[60%] truncate rounded-full px-3 py-1.5 text-[11px] ${GLASS}`} aria-label="إشعارات">
      🔔 {badge}
    </button>
  );
}


// ---------------------------------------------------------------------------------------------
// 🕰 Athar (flag MATCH_ENABLE_ATHAR; me.athar === null → nothing renders). Links only — no payments.
type AtharCfg = { bot: string; today: string; home?: string };
type AtharDayInfo = { index: number; label: string; link: string; img: string; known: boolean; kinds: { name: string; free: boolean | null }[]; anyFree: boolean | null };
const atharDayMemo = new Map<string, AtharDayInfo>();
/** One live day of Athar (today, or the picked date): its picture and which kinds are still free. Remembered for the session. */
function useAtharDay(api: any, date: string): { day: AtharDayInfo | null; bad: boolean } {
  const [day, setDay] = useState<AtharDayInfo | null>(() => atharDayMemo.get(date) ?? null);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    let live = true;
    const hit = atharDayMemo.get(date);
    if (hit) { setDay(hit); setBad(false); return; }
    api("athar_day", date ? { date } : {}).then((r: any) => {
      if (!live) return;
      if (r?.ok && r.day) { atharDayMemo.set(date, r.day); setDay(r.day); setBad(false); } else setBad(!r?.hidden);
    }).catch(() => live && setBad(true));
    return () => { live = false; };
  }, [api, date]);
  return { day, bad };
}
function AtharToken({ day, size }: { day: AtharDayInfo | null; size: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [day?.img]);
  return (
    <span style={{ width: size, height: size }} className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-300/30 to-amber-600/20 ring-1 ring-amber-300/40">
      {day && !broken
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={day.img} alt={day.label} width={size} height={size} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        : <span className="text-2xl">💎</span>}
    </span>
  );
}
function KindChips({ day }: { day: AtharDayInfo }) {
  return (
    <span className="flex flex-wrap gap-1">
      {day.kinds.map((k) => (
        <span key={k.name} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${k.free === false ? "bg-white/5 text-white/35 line-through" : k.free ? "bg-emerald-400/15 text-emerald-200" : "bg-white/5 text-white/50"}`}>
          {k.free === false ? "🔒" : k.free ? "✓" : "•"} {k.name}
        </span>
      ))}
    </span>
  );
}
/**
 * 💎 Athar showcase. "slim": one tappable row with today's real token. "full": the live card — the day's token art, which kinds are still free,
 * a date picker that updates it in place (birthday, anniversary, a day you love) and one button to open that day in Athar's own app
 * (TonConnect and TON payment stay inside Athar). Gift / memory wording only: no prices, no returns.
 */
function AtharEntry({ athar, api, where, variant = "slim", title }: { athar: AtharCfg; api?: any; where: string; variant?: "slim" | "full"; title?: string }) {
  const [date, setDate] = useState("");
  const [picking, setPicking] = useState(false);
  const { day, bad } = useAtharDay(api, date);
  const link = day?.link || athar.home || athar.today;
  const free = day?.anyFree;
  const status = !day ? (bad ? "افتح أثر" : "…") : free === null ? "ذكرى لهذا اليوم" : free ? "✨ متاح للإهداء الآن" : "🔒 لهذا اليوم مالك — جرّب يوماً آخر";
  if (variant === "slim") {
    return (
      <button data-testid={`athar-entry-${where}`} onClick={() => openAthar(link, `entry_${where}`, api)}
        className="mb-4 flex w-full items-center gap-3 rounded-3xl border border-amber-300/30 bg-gradient-to-l from-amber-400/15 via-[#e8b4a0]/10 to-transparent p-3 text-right">
        <AtharToken day={day} size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">أثر — امتلك يوماً للأبد</span>
          <span className="block truncate text-[11px] text-white/60">{day ? `${day.label} · ${status}` : "ذكرى تبقى — افتح أثر"}</span>
        </span>
        <span className="text-white/40">‹</span>
      </button>
    );
  }
  return (
    <div data-testid={`athar-entry-${where}`} className="mb-4 overflow-hidden rounded-3xl border border-amber-300/30 bg-gradient-to-br from-amber-400/15 via-[#e8b4a0]/10 to-transparent">
      <div className="flex items-center gap-3 p-4">
        <AtharToken day={day} size={84} />
        <div className="min-w-0 flex-1 text-right">
          <p className="text-[10px] font-bold tracking-wide text-amber-200/80">🕰 أثر · رمز لكل يوم على TON</p>
          <p className="mt-0.5 font-bold leading-snug">{title || (date ? "يومك في أثر" : "يوم اليوم في أثر")}{day ? <span className="block text-sm font-normal text-white/80">{day.label}</span> : null}</p>
          <p className="mt-1 text-[11px] text-white/60">{status}</p>
        </div>
      </div>
      {day && <div className="px-4 pb-3"><KindChips day={day} /></div>}
      <div className="flex gap-2 border-t border-white/10 bg-black/10 p-3">
        <button onClick={() => openAthar(link, `entry_${where}`, api)} className={`flex-1 rounded-2xl px-3 py-2.5 text-sm font-bold ${GRAD}`}>افتح هذا اليوم ←</button>
        <button onClick={() => setPicking((v) => !v)} aria-expanded={picking} className="rounded-2xl border border-white/15 px-3 py-2.5 text-xs font-bold text-white/80">📅 اختر يومك</button>
      </div>
      {picking && (
        <div className="border-t border-white/10 p-3">
          <p className="mb-2 text-[11px] text-white/50">ميلادك، ذكرى زواجكما، أو أي يوم تحبه (1950–2049). لا يُحفظ شيء.</p>
          <input type="date" min="1950-01-01" max="2049-12-31" value={date} onChange={(e) => setDate(e.target.value)} aria-label="اختر يوماً"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 outline-none" />
          <button onClick={() => openAthar(athar.bot, `${where}_promo`, api)} className="mt-2 text-[11px] text-[#f3cbbd] underline">🕰 تعرّف على «أثر»</button>
        </div>
      )}
    </div>
  );
}
function openAthar(url: string, where: string, api?: any) {
  haptic("light");
  try { api?.("athar_click", { where }); } catch { /* analytics only */ }
  const w = tg();
  if (url.startsWith("https://t.me/") && w?.openTelegramLink) w.openTelegramLink(url);
  else if (w?.openLink) w.openLink(url); else window.open(url, "_blank");
}
function AtharBirthday({ api, athar }: { api: any; say?: any; athar: AtharCfg }) {
  return <AtharEntry athar={athar} api={api} where="birthday" variant="full" title="🎂 يوم ميلادك في أثر" />;
}


// ---------------------------------------------------------------------------------------------
// 🔔 Bell: likes, matches, profile decisions, report outcomes. Messages are NOT here (Chats badge).
function Bell({ api }: { api: any }) {
  const [items, setItems] = useState<{ kind: string; text: string; at: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const load = useCallback(async () => { const r = await api("notifications_feed"); if (r?.ok) setItems(r.items || []); }, [api]);
  useEffect(() => {
    try { setSeen(Number(localStorage.getItem("match_bell_seen")) || 0); } catch { /* ignore */ }
    load();
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), 45000);
    return () => window.clearInterval(id);
  }, [load]);
  const unread = items.filter((i) => new Date(i.at).getTime() > seen).length;
  const openIt = () => { haptic("light"); setOpen(true); const now = Date.now(); setSeen(now); try { localStorage.setItem("match_bell_seen", String(now)); } catch { /* ignore */ } };
  return (
    <>
      <motion.button whileTap={{ scale: 0.9 }} onClick={openIt} aria-label="الإشعارات" data-testid="bell" className={`relative grid h-10 w-10 place-items-center rounded-2xl ${GLASS}`}>
        🔔{unread > 0 && <span data-testid="bell-badge" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-pink-500 px-1 text-[9px] font-bold leading-4">{unread > 9 ? "9+" : unread}</span>}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: "spring", damping: 26 }} className={`max-h-[75vh] w-full overflow-y-auto rounded-t-[32px] p-5 pb-8 ${GLASS} bg-[#0f1530]/95`}>
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
              <h3 className="mb-3 font-bold">🔔 الإشعارات</h3>
              {items.length === 0 && <p className="text-sm text-white/45">لا إشعارات بعد.</p>}
              <div className="space-y-2">
                {items.map((i, k) => (
                  <div key={k} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
                    {i.text}<span className="block text-[10px] text-white/40">{new Date(i.at).toLocaleString("ar", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ℹ️ Info sheet: tap the photo → full-screen viewer. Report (reasons + note) and block live here.
function InfoSheet({ card, api, say, reasons, onClose, onMessage }: { card: Card; api: any; say: any; reasons: Record<string, string>; onClose: () => void; onMessage: () => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [rep, setRep] = useState<null | { code: string; note: string }>(null);
  const [why, setWhy] = useState<string | null>(null);
  useEffect(() => { if (card.photo) api("photo", { target: card.ref }).then((r: any) => r?.ok && setPhoto(r.src)); }, [api, card]);
  useEffect(() => { if (card.values != null) api("why", { target: card.ref }).then((r: any) => r?.ok && r.text && setWhy(r.text)); }, [api, card]);
  const rows: [string, string | null][] = [["🌍 الدولة", `${card.flag} ${card.country}`], ["🏙 المدينة", card.city], ["🎂 العمر", String(card.age)], ["💼 العمل", card.job], ["🎓 التعليم", card.education], ["💍 الحالة", card.maritalStatus]];
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }} transition={{ type: "spring", damping: 26 }} data-testid="info-sheet"
        className={`max-h-[88vh] w-full overflow-y-auto rounded-t-[32px] p-5 pb-8 ${GLASS} bg-[#0f1530]/95`}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <div className="flex items-center gap-4">
          <button onClick={() => photo && setFull(true)} aria-label="عرض الصورة" className={`relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-3xl text-5xl ${card.gender === "FEMALE" ? "bg-gradient-to-br from-[#ff7ab8] to-[#b76e79]" : "bg-gradient-to-br from-[#6d8cff] to-[#3b3f8f]"}`}>
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : card.gender === "FEMALE" ? "👩" : "👨"}
          </button>
          <div>
            <p className="text-xl font-extrabold">{card.name || `#${card.shortId}`} {card.verified && <span className="text-sky-300">☑️</span>}</p>
            <p className="text-xs text-white/55">{card.presence.online ? "● " : ""}{card.presence.label}{card.compat != null ? ` · 💞 ${card.compat}%` : ""}</p>
            {card.values != null && <p className="mt-1 text-xs text-violet-200">🧠 تطابق القيم {card.values}%{why ? ` · ${why}` : ""}</p>}
            {card.photoLocked && <button onClick={async () => { const r = await api("photo_request", { target: card.ref }); say(r.message || r.error); }} className="mt-2 rounded-full border border-[#e8b4a0]/50 px-3 py-1 text-[11px] text-[#f3cbbd]">🔒 اطلب رؤية الصورة</button>}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="rounded-2xl bg-white/5 px-3 py-2"><span className="block text-[10px] text-white/45">{k}</span>{v}</div>)}
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={async () => { const r = await api("swipe", { target: card.ref, kind: "like" }); say(r.ok ? (r.match ? "💞 إعجاب متبادل!" : "❤️ تم الإعجاب") : r.error, r.ok ? "success" : "error"); }} className={`flex-1 rounded-2xl py-3 font-bold ${GRAD}`}>❤️ إعجاب</button>
          <button onClick={onMessage} className="flex-1 rounded-2xl border border-white/15 py-3 font-bold">💬 رسالة</button>
        </div>
        {!rep ? (
          <div className="mt-3 flex justify-center gap-4 text-xs text-white/50">
            <button onClick={() => setRep({ code: "", note: "" })}>🚩 إبلاغ</button>
            <button onClick={async () => { if (!(await confirmTg("حظر هذا العضو؟ لن يظهر لك ولن يراسلك."))) return; const r = await api("block", { target: card.ref }); say(r.message || r.error); onClose(); }}>⛔ حظر</button>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-500/5 p-3" data-testid="report-form">
            <p className="mb-2 text-sm font-bold">🚩 سبب البلاغ</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(reasons).map(([k, l]) => <button key={k} onClick={() => setRep({ ...rep, code: k })} className={`rounded-full px-3 py-1 text-xs ${rep.code === k ? "bg-red-500/80" : "border border-white/15"}`}>{l}</button>)}
            </div>
            <textarea value={rep.note} onChange={(e) => setRep({ ...rep, note: e.target.value })} maxLength={200} rows={2} placeholder="ملاحظة اختيارية" className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 p-2 text-sm outline-none" />
            <button disabled={!rep.code} onClick={async () => { const r = await api("report", { target: card.ref, code: rep.code, note: rep.note }); say(r.message || r.error, r.ok ? "success" : "error"); if (r.ok) onClose(); }} className="mt-2 w-full rounded-xl bg-red-500/80 py-2 text-sm font-bold disabled:opacity-40">إرسال البلاغ</button>
          </div>
        )}
      </motion.div>
      <AnimatePresence>
        {full && photo && (
          <motion.div className="fixed inset-0 z-[70] grid place-items-center bg-black" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={(e) => { e.stopPropagation(); setFull(false); }} data-testid="photo-viewer">
            <img src={photo} alt="" className="max-h-full max-w-full object-contain" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// 💬 Direct messages: matches free; strangers 3 per side, then unlock (balance) or Gold.
function ChatSheet({ card, api, say, onClose, onUpgrade }: { card: Card; api: any; say: any; onClose: () => void; onUpgrade: () => void }) {
  type DM = { id: number; mine: boolean; text: string; at: string; read: boolean };
  const [msgs, setMsgs] = useState<DM[]>([]);
  const [state, setState] = useState<any>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const last = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const poll = useCallback(async () => {
    const r = await api("dm_thread", { target: card.ref, after: last.current });
    if (!r?.ok) return;
    if (r.messages?.length) { last.current = r.messages[r.messages.length - 1].id; setMsgs((m) => [...m, ...r.messages]); }
    setState(r.state);
  }, [api, card.ref]);
  useEffect(() => { poll(); const id = window.setInterval(() => document.visibilityState === "visible" && poll(), 5000); return () => window.clearInterval(id); }, [poll]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api("dm_send", { target: card.ref, text });
    setBusy(false);
    if (r.state) setState(r.state);
    if (!r.ok) { say(r.error, "error"); return; }
    setText(""); haptic("light"); poll();
  };
  const unlock = async () => {
    const r = await api("dm_unlock", { target: card.ref });
    if (!r.ok) { say(r.error, "error"); return; }
    say(r.message); setState(r.state);
  };
  const locked = state && !state.allowed;
  return (
    <motion.div className="fixed inset-0 z-[55] flex flex-col bg-[#0b1020]" initial={{ y: 30 }} animate={{ y: 0 }} exit={{ y: 30 }} transition={{ duration: 0.15 }} data-testid="chat-sheet" dir="rtl">
      <div className={`flex items-center gap-3 p-4 ${GLASS}`}>
        <button onClick={onClose} aria-label="رجوع" className="text-xl">→</button>
        <div className={`grid h-10 w-10 place-items-center rounded-full ${card.gender === "FEMALE" ? "bg-gradient-to-br from-[#ff7ab8] to-[#b76e79]" : "bg-gradient-to-br from-[#6d8cff] to-[#3b3f8f]"}`}>{card.gender === "FEMALE" ? "👩" : "👨"}</div>
        <div className="flex-1">
          <p className="font-bold">{card.flag} {card.name || `#${card.shortId}`} · {card.age}</p>
          <p className="text-[11px] text-white/50">{state?.matched ? "💞 إعجاب متبادل — مراسلة مفتوحة" : state?.unlocked || state?.vip ? "🔓 محادثة مفتوحة" : state ? `📨 طلب تعارف · متبقٍ لك ${state.freeLeft} رسائل مجانية` : "…"}</p>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {msgs.length === 0 && <p className="mt-10 text-center text-sm text-white/40">ابدأ بتحية لطيفة 🌹 — لا تشارك أرقامك قبل أن تطمئن.</p>}
        {msgs.map((m) => (
          <div key={m.id} className={`flex ${m.mine ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${m.mine ? GRAD : "bg-white/10"}`}>{m.text}
              <span className="mt-0.5 block text-[9px] opacity-60">{new Date(m.at).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" })}{m.mine ? (m.read ? " ✓✓" : " ✓") : ""}</span>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {locked ? (
        <div className={`m-3 rounded-3xl p-4 text-center ${GLASS}`} data-testid="dm-paywall">
          <p className="font-bold">🔒 انتهت رسائلك المجانية الثلاث</p>
          <p className="mt-1 text-xs text-white/55">افتح هذه المحادثة بـ ${state.price} من رصيدك، أو اشترك في الذهبية لمراسلة بلا حدود. الإعجاب المتبادل يفتحها مجاناً.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={unlock} className={`flex-1 rounded-2xl py-2.5 text-sm font-bold ${GRAD}`}>🔓 فتح بـ ${state.price}</button>
            <button onClick={onUpgrade} className="flex-1 rounded-2xl border border-amber-300/40 py-2.5 text-sm">👑 الذهبية</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} maxLength={1000} placeholder="اكتب رسالة…" aria-label="رسالة"
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none focus:border-pink-400/60" />
          <button onClick={send} disabled={busy || !text.trim()} className={`rounded-2xl px-4 font-bold disabled:opacity-40 ${GRAD}`}>إرسال</button>
        </div>
      )}
    </motion.div>
  );
}

// 📢 Admin: one-shot «update your profile» campaign (preview → confirm → send; resumable, never double-sends).
function UpdateCampaign({ api, say }: { api: any; say: any }) {
  const [p, setP] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("admin_update_broadcast_preview").then((r: any) => r?.ok && setP(r)); }, [api]);
  if (!p) return null;
  return (
    <div className={`mb-3 rounded-3xl p-4 text-sm ${GLASS}`} data-testid="update-campaign">
      <p className="font-bold">📢 حملة «حدّث ملفك» (مع زر فتح التطبيق)</p>
      <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-white/5 p-3 font-sans text-xs text-white/75">{p.text}</pre>
      <p className="mt-2 text-xs text-white/55">الجمهور: {p.total} · لم يُرسل لهم بعد: {p.pending}</p>
      <button disabled={busy || !p.pending} onClick={async () => {
        if (!(await confirmTg(`إرسال الحملة إلى ${p.pending} مستخدم؟`))) return;
        setBusy(true);
        const r = await api("admin_update_broadcast_send", { confirm: true });
        setBusy(false);
        say(r.message || r.error, r.ok ? "success" : "error");
        const n = await api("admin_update_broadcast_preview"); if (n?.ok) setP(n);
      }} className={`mt-2 w-full rounded-2xl py-2.5 font-bold disabled:opacity-50 ${GRAD}`}>{busy ? "جارٍ الإرسال…" : p.pending ? "إرسال الحملة" : "✅ أُرسلت للجميع"}</button>
    </div>
  );
}


/** Loading placeholders shaped like what is coming (a card with its buttons; a list row), so the screen does not jump when data arrives. */
function DeckSkeleton() {
  return (
    <div className={`sk sk-dark relative mt-2 h-[460px] rounded-[32px] ${GLASS}`} aria-hidden>
      <div className="absolute inset-x-5 bottom-28 space-y-2">
        <div className="h-6 w-2/3 rounded-full bg-white/10" />
        <div className="h-3 w-1/3 rounded-full bg-white/10" />
        <div className="flex gap-2 pt-2"><div className="h-7 w-20 rounded-full bg-white/10" /><div className="h-7 w-16 rounded-full bg-white/10" /></div>
      </div>
      <div className="absolute inset-x-8 bottom-5 flex justify-between">
        {[44, 44, 60, 44, 44].map((s, i) => <div key={i} className="rounded-full bg-white/10" style={{ width: s, height: s }} />)}
      </div>
    </div>
  );
}
function RowSkeleton({ tall }: { tall?: boolean }) {
  return (
    <div className={`sk sk-dark flex items-center gap-3 rounded-3xl p-3 ${tall ? "h-20" : "h-16"} ${GLASS}`} aria-hidden>
      <div className="h-11 w-11 shrink-0 rounded-full bg-white/10" />
      <div className="flex-1 space-y-2"><div className="h-3 w-1/2 rounded-full bg-white/10" /><div className="h-3 w-3/4 rounded-full bg-white/10" /></div>
    </div>
  );
}


/** 🧠 Six short questions about values. Optional; it only adds a separate chip («🧠 قيم X%») between people who both answered, and never changes the existing 💞 percent. */
function QuizCard({ api, say, done, reload }: { api: any; say: any; done: boolean; reload: () => Promise<any> }) {
  const [open, setOpen] = useState(false);
  const [qs, setQs] = useState<{ id: string; q: string; options: string[] }[] | null>(null);
  const [ans, setAns] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    haptic("light");
    const r = await api("quiz_get");
    if (!r.ok) { say(r.error, "error"); return; }
    setQs(r.questions); setAns(r.answers ?? r.questions.map(() => -1)); setOpen(true);
  };
  const save = async () => {
    setBusy(true);
    const r = await api("quiz_save", { answers: ans });
    setBusy(false);
    if (!r.ok) { say(r.error, "error"); return; }
    haptic("success"); say(r.message); setOpen(false); void reload();
  };
  return (
    <div className={`rounded-3xl p-4 ${GLASS}`}>
      <p className="font-bold">🧠 اختبار القيم {done && <span className="text-xs text-emerald-300">· مكتمل</span>}</p>
      <p className="text-[11px] text-white/50">ست أسئلة قصيرة (اختياري). تظهر نسبة «تطابق القيم» مع من أجاب مثلك، وتُحفظ أجوبتك خاصة بك ولا يراها أحد.</p>
      {!open && <button onClick={start} className={`mt-3 w-full rounded-2xl py-2.5 text-sm font-bold ${GRAD}`}>{done ? "تعديل أجوبتي" : "ابدأ الاختبار"}</button>}
      {open && qs && (
        <div className="mt-3 space-y-4">
          {qs.map((q, i) => (
            <div key={q.id}>
              <p className="text-sm font-semibold">{i + 1}. {q.q}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {q.options.map((o, j) => (
                  <button key={j} onClick={() => { haptic("select"); setAns((a) => a.map((v, k) => (k === i ? j : v))); }}
                    className={`rounded-full px-3 py-1.5 text-xs ${ans[i] === j ? GRAD : "border border-white/20 text-white/80"}`}>{o}</button>
                ))}
              </div>
            </div>
          ))}
          <button disabled={busy || ans.some((v) => v < 0)} onClick={save} className={`w-full rounded-2xl py-2.5 text-sm font-bold disabled:opacity-40 ${GRAD}`}>{busy ? "جارٍ الحفظ…" : "حفظ"}</button>
        </div>
      )}
    </div>
  );
}


/** 🎤 Record up to 30 s and send it (anonymous chat, both people in the app). Needs the phone's microphone permission. */
function VoiceButton({ api, say, onSent }: { api: any; say: any; onSent: () => void }) {
  const [rec, setRec] = useState(false);
  const [sec, setSec] = useState(0);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0 = useRef(0);
  const cancelled = useRef(false);
  const stopTimer = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  const start = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { say("التسجيل غير مدعوم على جهازك", "error"); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = []; cancelled.current = false;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopTimer(); setRec(false);
        const dur = Math.max(1, Math.round((Date.now() - t0.current) / 1000));
        if (cancelled.current) return;
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" });
        const data = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(blob); });
        const out = await api("anon_voice_send", { mime: blob.type || mime || "audio/webm", dur: Math.min(30, dur), data });
        if (!out.ok) { say(out.error, "error"); return; }
        haptic("light"); onSent();
      };
      mr.current = r; t0.current = Date.now(); r.start(); setRec(true); setSec(0); haptic("medium");
      timer.current = setInterval(() => { const s = Math.round((Date.now() - t0.current) / 1000); setSec(s); if (s >= 30) r.stop(); }, 500);
    } catch { say("اسمح باستخدام الميكروفون لإرسال رسالة صوتية", "error"); }
  };
  if (!rec) return <motion.button type="button" whileTap={{ scale: 0.9 }} onClick={start} aria-label="رسالة صوتية" className="rounded-2xl bg-sky-500 px-4 font-bold">🎤</motion.button>;
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => { cancelled.current = true; mr.current?.stop(); }} className="rounded-2xl bg-slate-600 px-3 text-sm">✕</button>
      <motion.button type="button" animate={{ opacity: [1, 0.6, 1] }} transition={{ repeat: Infinity, duration: 1 }} onClick={() => mr.current?.stop()} className="rounded-2xl bg-rose-600 px-4 text-sm font-bold">⏹ {sec}s · إرسال</motion.button>
    </div>
  );
}

/** A voice note in the chat: tap to fetch and play (it exists only while the conversation lasts). */
function VoiceBubble({ api, text }: { api: any; text: string }) {
  const [, id, dur] = text.split(":");
  const [state, setState] = useState<"idle" | "loading" | "playing" | "gone">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const play = async () => {
    if (state === "playing") { audio.current?.pause(); setState("idle"); return; }
    setState("loading");
    const r = await api("anon_voice_get", { id: Number(id) });
    if (!r.ok) { setState("gone"); return; }
    const a = new Audio(`data:${r.mime};base64,${r.b64}`);
    audio.current = a;
    a.onended = () => setState("idle");
    a.play().then(() => setState("playing")).catch(() => setState("idle"));
  };
  if (state === "gone") return <span className="text-xs opacity-70">🎤 الرسالة الصوتية لم تعد متاحة</span>;
  return <button type="button" onClick={play} className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-full bg-white/20">{state === "loading" ? "…" : state === "playing" ? "⏸" : "▶"}</span><span className="text-sm">🎤 {dur}s</span></button>;
}


/** 🎁 Virtual gifts between matched people, paid from the member's balance (which Telegram Stars can top up). The recipient is notified in the app and the bot. */
function GiftSheet({ api, say, card, onClose }: { api: any; say: any; card: Card; onClose: () => void }) {
  const [gifts, setGifts] = useState<{ key: string; emoji: string; name: string; price: number }[]>([]);
  const [busy, setBusy] = useState("");
  useEffect(() => { api("me").then((r: any) => r?.ok && setGifts(r.gifts || [])); }, [api]);
  const send = async (key: string) => {
    setBusy(key); haptic("medium");
    const r = await api("gift_send", { target: card.ref, gift: key });
    setBusy("");
    if (!r.ok) { say(r.error, "error"); return; }
    haptic("success"); say(r.message); onClose();
  };
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ y: 300 }} animate={{ y: 0 }} exit={{ y: 300 }} transition={{ type: "spring", damping: 26 }} className={`w-full rounded-t-[32px] p-5 pb-8 ${GLASS} bg-[#0f1530]/95`}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-white/20" />
        <p className="font-bold">🎁 أرسل هدية إلى {card.name || `#${card.shortId}`}</p>
        <p className="text-[11px] text-white/50">تُخصم من رصيدك، وتصل للطرف الآخر في التطبيق والبوت. بين المتطابقين فقط.</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {gifts.map((g) => (
            <button key={g.key} disabled={!!busy} onClick={() => send(g.key)} className="rounded-2xl border border-white/15 bg-white/5 p-3 text-center disabled:opacity-50">
              <div className="text-3xl">{g.emoji}</div>
              <div className="mt-1 text-xs">{g.name}</div>
              <div className="text-[11px] text-amber-300">${g.price}</div>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
