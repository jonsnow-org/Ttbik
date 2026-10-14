"use client";

/**
 * Premium hybrid Telegram Mini App for MARRIAGE_BOT bots (/match-app/<botId>).
 * State: plain React state per tab + a single `api()` helper (POST with
 * Telegram initData, verified server-side). Anonymous chat uses short
 * polling (no paid realtime). Telegram MainButton/BackButton/haptics wired.
 */
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tab = "anon" | "discover" | "chats" | "me" | "admin";
type Card = {
  ref: string; shortId: string; gender: "MALE" | "FEMALE"; age: number; country: string; city: string | null; job: string | null;
  education: string | null; maritalStatus: string | null; verified: boolean; flag: string; compat: number | null;
  presence: { online: boolean; label: string }; photo: boolean; photoLocked: boolean; likedYou?: boolean; boosted?: boolean;
};
type Msg = { id: number; mine: boolean; text: string; at: string };
type Poll = { state: "idle" | "waiting" | "timeout" | "fake" | "chatting" | "ended"; sessionId?: string; filter?: string | null; messages?: Msg[]; contact?: "hidden" | "offered" | "requested_by_me" | "requested_by_partner" };

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

export default function MatchMiniApp({ botId }: { botId: string }) {
  const [boot, setBoot] = useState<"loading" | "outside" | "start" | "phone" | "ready">("loading");
  const [tab, setTab] = useState<Tab>("discover");
  const [me, setMe] = useState<any>(null);
  const [toast, setToast] = useState("");
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
    reloadMe().then((r) => { if (r && r.registered && !r.profile) setTab("me"); });
  }, [reloadMe]);

  // BackButton: closes a modal, otherwise returns to discovery.
  useEffect(() => {
    const w = tg();
    if (!w?.BackButton) return;
    const show = !!modal || tab !== "discover";
    if (show) w.BackButton.show(); else w.BackButton.hide();
    const h = () => { haptic("light"); if (modal) setModal(null); else setTab("discover"); };
    w.BackButton.onClick(h);
    return () => w.BackButton.offClick(h);
  }, [modal, tab]);

  if (boot !== "ready") {
    const text = {
      loading: "جارٍ التحميل…",
      outside: toast || "افتح هذا التطبيق من زر القائمة داخل البوت في تلجرام.",
      start: "اضغط «ابدأ» في البوت أولاً ثم ارجع للتطبيق.",
      phone: "وثّق رقم هاتفك داخل البوت أولاً (خطوة أمان إلزامية) ثم ارجع.",
    }[boot];
    return (
      <Shell>
        <div className="grid min-h-[80vh] place-items-center text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} rounded-3xl p-8 max-w-xs`}>
            <div className="text-5xl mb-3">{boot === "loading" ? "💞" : "🔒"}</div>
            <p className="text-white/80 leading-7">{text}</p>
            {boot === "loading" && <div className="mt-4 h-1 overflow-hidden rounded bg-white/10"><motion.div className={`h-full w-1/3 ${GRAD}`} animate={{ x: ["-100%", "300%"] }} transition={{ repeat: Infinity, duration: 1.2 }} /></div>}
          </motion.div>
        </div>
      </Shell>
    );
  }

  const hasProfile = me?.profile?.status === "APPROVED";

  return (
    <Shell>
      <Header me={me} onUpgrade={() => setTab("me")} />
      <AnimatePresence mode="wait">
        <motion.section key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }} className="pb-32">
          {tab === "anon" && <AnonTab api={api} say={say} me={me} active={tab === "anon"} onUsed={reloadMe} />}
          {tab === "discover" && (hasProfile
            ? <DiscoverTab api={api} say={say} me={me} onMatch={(card) => setModal({ kind: "match", card })} onCompliment={(card) => setModal({ kind: "compliment", card })} onSuper={(card, done) => setModal({ kind: "super", card, done })} onUsed={reloadMe} />
            : <Empty icon="👤" text="أنشئ ملفك أولاً لتظهر لك المطابقات" action="إنشاء الملف" onAction={() => setTab("me")} />)}
          {tab === "chats" && <ChatsTab api={api} say={say} hasProfile={hasProfile} goAnon={() => setTab("anon")} onCompliment={(card) => setModal({ kind: "compliment", card })} />}
          {tab === "me" && (me?.registered === false ? <Empty icon="🛡" text="حساب الإدارة بلا ملف عضو" /> : <MeTab api={api} say={say} me={me} reload={reloadMe} />)}
          {tab === "admin" && me?.isAdmin && <AdminTab api={api} say={say} onChange={reloadMe} />}
        </motion.section>
      </AnimatePresence>

      <BottomNav tab={tab} setTab={(t) => { haptic("select"); setTab(t); }} admin={me?.isAdmin ? (me?.adminBadges?.total ?? 0) : null} />

      <AnimatePresence>
        {modal?.kind === "match" && <MatchModal card={modal.card} onClose={() => setModal(null)} onChat={async () => { const r = await api("request", { target: modal.card.ref }); say(r.message || r.error, r.ok ? "success" : "error"); setModal(null); }} />}
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
    <main dir="rtl" className="relative min-h-screen overflow-x-hidden bg-[#0b1020] text-white font-sans selection:bg-pink-500/40">
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute -top-32 -right-24 h-80 w-80 rounded-full bg-[#ff2e93]/25 blur-[100px]" />
        <div className="absolute top-1/3 -left-24 h-72 w-72 rounded-full bg-[#e8b4a0]/15 blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-indigo-600/20 blur-[100px]" />
      </div>
      <div className="relative mx-auto max-w-md px-4 pt-4">{children}</div>
    </main>
  );
}

function Header({ me, onUpgrade }: { me: any; onUpgrade: () => void }) {
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
      <motion.button whileTap={{ scale: 0.92 }} onClick={() => { haptic("medium"); onUpgrade(); }}
        className={`flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm ${GLASS}`} aria-label="الرصيد والترقيات">
        <span>💰</span><b>${Number(me?.ent?.balance ?? 0).toFixed(2)}</b><span className="text-[#f3cbbd]">⭐</span>
      </motion.button>
    </header>
  );
}

function BottomNav({ tab, setTab, admin }: { tab: Tab; setTab: (t: Tab) => void; admin: number | null }) {
  const items: [Tab, string, string][] = [["anon", "🔀", "دردشة مجهولة"], ["discover", "🔥", "المطابقات"], ["chats", "💬", "محادثاتي"], ["me", "👤", "ملفي"]];
  if (admin !== null) items.push(["admin", "🛡", "لوحة القيادة"]);
  return (
    <nav className={`fixed bottom-4 inset-x-4 z-40 mx-auto max-w-md rounded-[28px] p-1.5 ${GLASS}`} style={{ paddingBottom: "max(6px, env(safe-area-inset-bottom))" }}>
      <ul className={`grid gap-1 ${admin !== null ? "grid-cols-5" : "grid-cols-4"}`}>
        {items.map(([t, icon, label]) => (
          <li key={t}>
            <button onClick={() => setTab(t)} className="relative w-full rounded-3xl py-2 text-center">
              {tab === t && <motion.span layoutId="navpill" className={`absolute inset-0 rounded-3xl ${GRAD} opacity-90`} transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
              <span className="relative block text-lg leading-none">{icon}</span>
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
      className={`flex-1 rounded-2xl px-3 py-2 text-sm transition ${active ? `${GRAD} font-bold text-white shadow-[0_0_20px_rgba(255,46,147,0.35)]` : "bg-white/5 text-white/70 border border-white/10"}`}>
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
function AnonTab({ api, say, me, active, onUsed }: { api: any; say: any; me: any; active: boolean; onUsed: () => void }) {
  const af = me?.anonFilters || { owned: false, filter: {} };
  const [filter, setFilter] = useState<{ gender?: string; country: string; ageMin: string; ageMax: string }>(() => ({
    gender: af.filter?.gender, country: af.filter?.country ?? "", ageMin: af.filter?.ageMin != null ? String(af.filter.ageMin) : "", ageMax: af.filter?.ageMax != null ? String(af.filter.ageMax) : "",
  }));
  const [poll, setPoll] = useState<Poll>({ state: "idle" });
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [exitOpen, setExitOpen] = useState(false);
  const lastId = useRef(0);
  const sessionRef = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);

  const apply = useCallback((r: any) => {
    if (!r?.ok) { if (r?.error) say(r.error, "error"); return; }
    if (r.state === "chatting" && r.sessionId !== sessionRef.current) { sessionRef.current = r.sessionId; lastId.current = 0; setMsgs([]); haptic("success"); }
    if (r.messages?.length) {
      lastId.current = r.messages[r.messages.length - 1].id;
      setMsgs((m) => { const seen = new Set(m.map((x) => x.id)); return [...m, ...r.messages.filter((x: Msg) => !seen.has(x.id))]; });
      if (r.messages.some((x: Msg) => !x.mine)) haptic("light");
    }
    if (r.state === "ended" && sessionRef.current) { say("انتهت المحادثة"); sessionRef.current = undefined; }
    setPoll(r);
  }, [say]);

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
        delay = r?.messages?.length ? 4000 : Math.min(12000, Math.round(delay * 1.5));
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
        .subscribe((status: string) => { rtLive.current = status === "SUBSCRIBED"; });
      cleanup = () => { rtLive.current = false; client.removeChannel(ch); };
    }).catch(() => { rtLive.current = false; });
    return () => { cancelled = true; cleanup?.(); };
  }, [active, rtTopic, poll.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (poll.state !== "chatting") setRtTopic(null); }, [poll.state]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs.length]);

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
  const send = async (t = text) => {
    const v = t.trim();
    if (!v) return;
    setText("");
    const r = await api("anon_send", { text: v });
    if (!r.ok) { say(r.error, "error"); setText(v); return; }
    haptic("light");
    pollNow();
  };
  const end = async (reason: string) => { setExitOpen(false); await api("anon_end", { reason }); setPoll({ state: "idle" }); sessionRef.current = undefined; };

  useEffect(() => {
    const w = tg();
    if (!w?.MainButton) return;
    const show = active && (poll.state === "idle" || poll.state === "ended" || poll.state === "timeout");
    w.MainButton.setParams({ text: "🔀 مراسلة عشوائية", color: "#ff2e93", text_color: "#ffffff", is_visible: show });
    const h = () => start();
    if (show) w.MainButton.onClick(h);
    return () => { w.MainButton.offClick(h); w.MainButton.hide(); };
  }, [active, poll.state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (poll.state === "fake") {
    return (
      <div className={`mt-6 rounded-3xl p-5 text-center ${GLASS}`}>
        <p className="font-bold">💬 محادثتك جارية داخل البوت</p>
        <p className="mt-1 text-sm text-white/60">تابعها من محادثة البوت مباشرة.</p>
        <button onClick={() => tg()?.close?.()} className={`mt-4 rounded-2xl px-6 py-3 font-bold ${GRAD}`}>فتح البوت</button>
      </div>
    );
  }

  if (poll.state === "chatting") {
    return (
      <div className={`flex h-[calc(100vh-190px)] flex-col rounded-3xl ${GLASS}`}>
        <div className="flex items-center justify-between border-b border-white/10 p-3">
          <div className="flex items-center gap-2">
            <div className={`grid h-10 w-10 place-items-center rounded-full ${GRAD}`}>🎭</div>
            <div>
              <p className="text-sm font-bold">شخص مجهول</p>
              <p className="text-[11px] text-emerald-300">● مجهولة الهوية بالكامل</p>
            </div>
          </div>
          <div className="flex gap-1">
            <IconBtn title="إبلاغ" onClick={async () => { const r = await api("anon_report"); say(r.message || r.error); }}>🚩</IconBtn>
            <IconBtn title="حظر" onClick={async () => { if (await confirmTg("حظر هذا الشخص وإنهاء المحادثة؟")) { const r = await api("anon_block"); setPoll({ state: "idle" }); sessionRef.current = undefined; say(r.message || "⛔ تم الحظر"); } }}>⛔</IconBtn>
            <IconBtn title="إنهاء المحادثة" onClick={() => setExitOpen(true)}>⏹</IconBtn>
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
              {m.text}
            </motion.div>
          ))}
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
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب رسالتك (نص فقط)…" className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-pink-400/60" />
          <motion.button whileTap={{ scale: 0.9 }} className={`rounded-2xl px-4 font-bold ${GRAD}`}>إرسال</motion.button>
        </form>
      </div>
    );
  }

  const waiting = poll.state === "waiting";
  return (
    <div>
      <div className="relative mx-auto my-6 grid h-56 w-56 place-items-center">
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
          {!tg()?.MainButton && <button onClick={() => start()} className={`mt-4 w-full rounded-2xl py-3 font-bold ${GRAD}`}>🔀 مراسلة عشوائية</button>}
          <div className={`mt-6 rounded-3xl p-4 ${GLASS}`}>
            <p className="mb-1 text-sm font-bold">🎛 فلاتر الدردشة العشوائية</p>
            {!af.owned ? (
              <>
                <p className="text-[12px] leading-5 text-white/55">اختر جنس ودولة وعمر من تُطابَق معه. $2 لمدة 30 يوماً — مشمولة في العضوية الذهبية. بدون تجديد تلقائي.</p>
                <button onClick={buyFilters} className={`mt-3 w-full rounded-2xl py-2.5 text-sm font-bold ${GRAD}`}>تفعيل ($2 / 30 يوماً)</button>
              </>
            ) : (
              <>
                <p className="mb-2 text-[11px] text-emerald-300">✓ {af.viaVip ? "ضمن العضوية الذهبية" : `مفعّلة حتى ${new Date(af.until).toLocaleDateString("ar")}`}</p>
                <div className="mb-3 flex gap-2">
                  <Pill active={!filter.gender} onClick={() => setFilter({ ...filter, gender: undefined })}>الكل</Pill>
                  <Pill active={filter.gender === "MALE"} onClick={() => setFilter({ ...filter, gender: "MALE" })}>👨 ذكر</Pill>
                  <Pill active={filter.gender === "FEMALE"} onClick={() => setFilter({ ...filter, gender: "FEMALE" })}>👩 أنثى</Pill>
                </div>
                <Field label="الدولة" value={filter.country} onChange={(v) => setFilter({ ...filter, country: v })} placeholder="فارغ = أي دولة" />
                <div className="flex gap-2">
                  <div className="flex-1"><Field label="العمر من" type="number" value={filter.ageMin} onChange={(v) => setFilter({ ...filter, ageMin: v })} /></div>
                  <div className="flex-1"><Field label="إلى" type="number" value={filter.ageMax} onChange={(v) => setFilter({ ...filter, ageMax: v })} /></div>
                </div>
                <p className="text-[11px] text-white/40">تتم المطابقة فقط مع من يحقق فلاترك، وإن كان لديه فلاتر فيجب أن تحققها أنت أيضاً.</p>
                <button onClick={saveFilter} className="mt-2 w-full rounded-2xl border border-white/15 py-2.5 text-sm">حفظ الفلاتر</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 🛡 Admin dashboard — every call is re-checked server-side (isMatchAdmin); actions = the bot's own.
function AdminTab({ api, say, onChange }: { api: any; say: any; onChange: () => void }) {
  type Sec = "overview" | "profiles" | "verify" | "rsearch" | "rchat" | "inbox" | "users" | "broadcast" | "audit";
  const [sec, setSec] = useState<Sec>("overview");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [lookup, setLookup] = useState<any>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [bc, setBc] = useState("");

  const load = useCallback(async (s: Sec = sec) => {
    const act = { overview: "admin_overview", profiles: "admin_profiles", verify: "admin_verifications", rsearch: "admin_reports", rchat: "admin_reports", inbox: "admin_inbox", users: null, broadcast: null, audit: "admin_audit" }[s];
    if (!act) { setData(null); return; }
    const r = await api(act, { source: s === "rchat" ? "RANDOM_CHAT" : "SEARCH" });
    if (!r.ok) { say(r.error, "error"); return; }
    setData(r);
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

  const b = data?.badges || {};
  const secs: [Sec, string, number?][] = [
    ["overview", "📊 نظرة عامة"], ["profiles", "📋 الملفات", b.profiles], ["verify", "☑️ التوثيق", b.verifications],
    ["rsearch", "🚩 بلاغات المطابقة", b.reportsSearch], ["rchat", "🚩 بلاغات العشوائية", b.reportsChat], ["inbox", "📥 الوارد", b.inbox],
    ["users", "🔎 مستخدم / رفع حظر"], ["broadcast", "📢 بث"], ["audit", "🧾 السجل"],
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

      {sec === "profiles" && (data?.items?.length ? data.items.map((p: any) => (
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
        {data?.items?.length ? data.items.map((p: any) => (
          <div key={p.userId} className={`flex items-center justify-between rounded-3xl p-4 text-sm ${GLASS}`}>
            <span>{p.name} <span className="text-white/40">#{p.shortId}</span></span>
            <span className="flex gap-2">
              <Btn tone="bg-emerald-500/80" onClick={() => act("admin_verify_decide", { userId: p.userId, approve: true })}>☑️ توثيق</Btn>
              <Btn tone="bg-red-500/70" onClick={() => act("admin_verify_decide", { userId: p.userId, approve: false }, "رفض طلب التوثيق؟")}>رفض</Btn>
            </span>
          </div>
        )) : data && <Empty icon="☑️" text="لا توجد طلبات توثيق معلقة." />}
      </>)}

      {(sec === "rsearch" || sec === "rchat") && (data?.items?.length ? data.items.map((r: any) => (
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

      {sec === "inbox" && (data?.items?.length ? data.items.map((m: any) => (
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

      {sec === "broadcast" && (
        <div className={`rounded-3xl p-4 text-sm ${GLASS}`}>
          <textarea value={bc} onChange={(e) => setBc(e.target.value)} rows={5} placeholder="📢 نص الرسالة لجميع المستخدمين المُفعّلين" className="w-full rounded-xl border border-white/10 bg-white/5 p-3 outline-none" />
          <button disabled={busy || !bc.trim()} onClick={async () => { await act("admin_broadcast", { text: bc }, "إرسال هذا البث لجميع المستخدمين؟"); setBc(""); }} className={`mt-2 w-full rounded-2xl py-2.5 font-bold disabled:opacity-50 ${GRAD}`}>إرسال البث</button>
        </div>
      )}

      {sec === "audit" && (data?.items?.length ? (
        <div className={`rounded-3xl p-3 text-[12px] ${GLASS}`}>
          {data.items.map((a: any) => (
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
function DiscoverTab({ api, say, me, onMatch, onCompliment, onSuper, onUsed }: { api: any; say: any; me: any; onMatch: (c: Card) => void; onCompliment: (c: Card) => void; onSuper: (c: Card, done: () => void) => void; onUsed: () => void }) {
  const [deck, setDeck] = useState<Card[] | null>(null);
  const [strict, setStrict] = useState(false);
  const [photos, setPhotos] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setDeck(null);
    const r = await api("discover", { strict });
    if (!r.ok) { say(r.error, "error"); setDeck([]); return; }
    setDeck(r.items);
  }, [api, say, strict]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const top = deck?.[0];
    if (top) api("seen", { target: top.ref }); // same visit tracking as the bot's card
    if (top?.photo && !photos[top.ref]) api("photo", { target: top.ref }).then((r: any) => r.ok && setPhotos((p) => ({ ...p, [top.ref]: r.src })));
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
    const r = await api("swipe", { target: card.ref, kind });
    if (!r.ok) { say(r.error, "error"); return; }
    if (r.message) say(r.message);
    if (r.match) onMatch({ ...card, ...r.card });
  };

  const strictBar = (
    <div className="mb-2 flex items-center justify-between text-xs">
      <span className="text-white/50">{strict ? "🎯 بحث دقيق: كل مواصفاتك" : "🔍 البحث عن شريك (نفس ترتيب البوت)"}</span>
      {me?.ent?.advancedFilters
        ? <button onClick={() => { haptic("select"); setStrict((v) => !v); }} className={`rounded-full px-3 py-1 ${strict ? GRAD : "border border-white/15"}`}>🎯 بحث دقيق</button>
        : <span className="rounded-full border border-white/10 px-3 py-1 text-white/35">🎯 بحث دقيق (للمشتركين)</span>}
    </div>
  );
  if (!deck) return <div>{strictBar}<div className={`mt-2 h-[460px] animate-pulse rounded-[32px] ${GLASS}`} /></div>;
  if (deck.length === 0) return <div>{strictBar}<Empty icon="✨" text="شاهدت كل المطابقات الحالية. عد لاحقاً أو وسّع مواصفات الشريك." action="تحديث" onAction={load} /></div>;

  return (
    <div>
      {strictBar}
      <div className="relative mt-2 h-[470px]">
        <AnimatePresence>
          {deck.slice(0, 3).reverse().map((c, i, arr) => (
            <SwipeCard key={c.ref} card={c} photo={photos[c.ref]} isTop={i === arr.length - 1} depth={arr.length - 1 - i}
              onSwipe={(dir) => act(dir === "right" ? "like" : dir === "up" ? "super" : "pass")}
              onPhotoRequest={async () => { const r = await api("photo_request", { target: c.ref }); say(r.message || r.error); }} />
          ))}
        </AnimatePresence>
      </div>
      <div className="mt-5 flex items-center justify-center gap-4">
        <ActionBtn label="تخطي" size="md" onClick={() => act("pass")}>✖️</ActionBtn>
        <ActionBtn label="مميز $1" size="sm" glow="#60a5fa" onClick={() => act("super")}>⭐</ActionBtn>
        <ActionBtn label="إعجاب" size="lg" glow="#ff2e93" gradient onClick={() => act("like")}>❤️</ActionBtn>
        <ActionBtn label="طلب زواج" size="sm" glow="#e8b4a0" onClick={() => act("propose")}>💍</ActionBtn>
        <ActionBtn label="مجاملة" size="md" onClick={() => deck[0] && onCompliment(deck[0])}>💌</ActionBtn>
      </div>
      <p className="mt-3 text-center text-[11px] text-white/35">اسحب يميناً للإعجاب · يساراً للتخطي · للأعلى للإعجاب المميز</p>
    </div>
  );
}

function ActionBtn({ children, onClick, label, size, glow, gradient }: { children: React.ReactNode; onClick: () => void; label: string; size: "sm" | "md" | "lg"; glow?: string; gradient?: boolean }) {
  const dim = size === "lg" ? "h-16 w-16 text-2xl" : size === "md" ? "h-13 w-13 h-[52px] w-[52px] text-xl" : "h-11 w-11 text-lg";
  return (
    <div className="flex flex-col items-center gap-1">
      <motion.button whileTap={{ scale: 0.85 }} whileHover={{ scale: 1.06 }} onClick={onClick} aria-label={label}
        className={`grid place-items-center rounded-full ${dim} ${gradient ? GRAD : GLASS}`} style={glow ? { boxShadow: `0 0 24px ${glow}55` } : undefined}>{children}</motion.button>
      <span className="text-[10px] text-white/45">{label}</span>
    </div>
  );
}

function SwipeCard({ card, photo, isTop, depth, onSwipe, onPhotoRequest }: { card: Card; photo?: string; isTop: boolean; depth: number; onSwipe: (d: "left" | "right" | "up") => void; onPhotoRequest: () => void }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-14, 14]);
  const likeOp = useTransform(x, [30, 120], [0, 1]);
  const nopeOp = useTransform(x, [-120, -30], [1, 0]);
  const superOp = useTransform(y, [-120, -30], [1, 0]);
  const [exit, setExit] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const end = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.y < -110 || velocity.y < -700) { setExit({ x: 0, y: -700 }); onSwipe("up"); }
    else if (offset.x > 110 || velocity.x > 700) { setExit({ x: 600, y: 0 }); onSwipe("right"); }
    else if (offset.x < -110 || velocity.x < -700) { setExit({ x: -600, y: 0 }); onSwipe("left"); }
  };

  return (
    <motion.div
      className={`absolute inset-0 overflow-hidden rounded-[32px] border border-white/10 ${isTop ? "cursor-grab active:cursor-grabbing" : ""}`}
      style={{ x, y, rotate, zIndex: 10 - depth, touchAction: "none" }}
      drag={isTop} dragElastic={0.7} dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }} onDragEnd={end}
      initial={{ scale: 0.92, opacity: 0, y: 20 }}
      animate={{ scale: 1 - depth * 0.05, y: depth * 14, opacity: 1 }}
      exit={{ x: exit.x || (Math.random() > 0.5 ? 600 : -600), y: exit.y, opacity: 0, transition: { duration: 0.3 } }}
      transition={{ type: "spring", stiffness: 300, damping: 28 }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#1b2340] via-[#141a33] to-[#2a1530]" />
      {photo
        ? <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        : (
          <div className="absolute inset-0 grid place-items-center">
            <div className={`grid h-40 w-40 place-items-center rounded-full text-7xl shadow-[0_0_60px_rgba(255,46,147,0.35)] ${card.gender === "FEMALE" ? "bg-gradient-to-br from-[#ff7ab8] to-[#b76e79]" : "bg-gradient-to-br from-[#6d8cff] to-[#3b3f8f]"}`}>
              {card.gender === "FEMALE" ? "👩" : "👨"}
            </div>
          </div>
        )}
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

      <div className="absolute top-4 inset-x-4 flex items-start justify-between">
        <span className={`rounded-full px-3 py-1 text-xs backdrop-blur-md ${card.presence.online ? "bg-emerald-500/25 text-emerald-200" : "bg-black/30 text-white/70"}`}>
          {card.presence.online ? "● " : ""}{card.presence.label}
        </span>
        <div className="flex flex-col items-end gap-1">
          {card.compat != null && <span className={`rounded-full px-3 py-1 text-xs font-bold ${GRAD}`}>💞 {card.compat}%</span>}
        </div>
      </div>

      <motion.span style={{ opacity: likeOp }} className="absolute top-20 left-6 -rotate-12 rounded-xl border-4 border-emerald-400 px-3 py-1 text-2xl font-black text-emerald-300">إعجاب</motion.span>
      <motion.span style={{ opacity: nopeOp }} className="absolute top-20 right-6 rotate-12 rounded-xl border-4 border-rose-400 px-3 py-1 text-2xl font-black text-rose-300">تخطي</motion.span>
      <motion.span style={{ opacity: superOp }} className="absolute bottom-40 inset-x-0 mx-auto w-fit rounded-xl border-4 border-sky-400 px-3 py-1 text-2xl font-black text-sky-300">⭐ مميز</motion.span>

      <div className="absolute bottom-0 inset-x-0 p-5">
        <h2 className="text-2xl font-extrabold">
          {card.flag} #{card.shortId}<span className="font-light">، {card.age}</span> {card.verified && <span title="موثّق" className="text-sky-300">☑️</span>}
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
function ChatsTab({ api, say, hasProfile, goAnon, onCompliment }: { api: any; say: any; hasProfile: boolean; goAnon: () => void; onCompliment: (c: Card) => void }) {
  const [matches, setMatches] = useState<Card[] | null>(null);
  const [anon, setAnon] = useState<Poll | null>(null);
  useEffect(() => {
    api("anon_poll", { after: 0 }).then((r: any) => r.ok && setAnon(r));
    if (hasProfile) api("matches").then((r: any) => setMatches(r.ok ? r.items : []));
    else setMatches([]);
  }, [api, hasProfile]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">المحادثات</h2>
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

      <h3 className="pt-2 text-sm text-white/60">💞 إعجابات متبادلة</h3>
      {!matches && <div className={`h-20 animate-pulse rounded-3xl ${GLASS}`} />}
      {matches?.length === 0 && <p className="text-sm text-white/40">لا توجد إعجابات متبادلة بعد. استمر في التصفح 🔥</p>}
      {matches?.map((c) => (
        <motion.div key={c.ref} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-3xl p-4 ${GLASS}`}>
          <div className="flex items-center gap-3">
            <div className={`relative grid h-12 w-12 place-items-center rounded-full text-2xl ${c.gender === "FEMALE" ? "bg-gradient-to-br from-[#ff7ab8] to-[#b76e79]" : "bg-gradient-to-br from-[#6d8cff] to-[#3b3f8f]"}`}>
              {c.gender === "FEMALE" ? "👩" : "👨"}
              {c.presence.online && <span className="absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-[#0b1020] bg-emerald-400" />}
            </div>
            <div className="flex-1">
              <p className="font-bold">{c.flag} #{c.shortId} · {c.age}</p>
              <p className="text-xs text-white/50">{c.country}{c.compat != null ? ` · 💞 ${c.compat}%` : ""} · {c.presence.label}</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={async () => { const r = await api("request", { target: c.ref }); say(r.message || r.error, r.ok ? "success" : "error"); }} className={`flex-1 rounded-2xl py-2 text-sm font-bold ${GRAD}`}>💌 دردشة مجهولة</button>
            <button onClick={async () => { const r = await api("swipe", { target: c.ref, kind: "propose" }); say(r.message || r.error, r.ok ? "success" : "error"); }} className="rounded-2xl border border-[#e8b4a0]/40 px-3 text-sm">💍</button>
            <button onClick={() => onCompliment(c)} className="rounded-2xl border border-white/15 px-3 text-sm">🌹</button>
          </div>
        </motion.div>
      ))}
      <p className="text-center text-[11px] text-white/35">عند الإعجاب المتبادل يرسل البوت تنبيهاً لكما في تلجرام.</p>
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
      <div className="mb-4 flex gap-1.5 overflow-x-auto">
        {([["upgrades", "⭐ الترقيات"], ["profile", "👤 ملفي"], ["pref", "💍 معايير الزواج"], ["privacy", "🔒 الخصوصية"]] as const).map(([k, l]) => (
          <Pill key={k} active={section === k} onClick={() => setSection(k)}>{l}</Pill>
        ))}
      </div>

      {section === "upgrades" && <UpgradeScreen api={api} say={say} me={me} reload={reload} />}

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
    say(r.message || r.error, r.ok ? "success" : "error");
    if (!r.ok && /لا يكفي/.test(r.error || "")) depositRef.current?.scrollIntoView({ behavior: "smooth" });
    if (r.toBot) tg()?.close?.();
    if (r.open === "visitors") openVisitors();
    reload();
  };
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
        <p className="mt-1 text-[11px] text-white/40">نفس رصيد البوت — كل الميزات تُخصم منه.</p>
      </div>

      <div className="space-y-2">
        {(me?.catalogue || []).map((c: any) => {
          const st = state(c.key);
          const isVipCard = c.key === "vip";
          return (
            <motion.div key={c.key} layout className={`rounded-3xl p-4 ${GLASS} ${isVipCard ? "border-amber-300/40 shadow-[0_0_30px_rgba(251,191,36,0.15)]" : ""}`}>
              <div className="flex items-center gap-3">
                <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl ${isVipCard ? "bg-gradient-to-br from-amber-300 to-amber-600" : "bg-white/10"}`}>{c.icon}</div>
                <div className="flex-1">
                  <p className="font-bold">{c.title} <span className="text-xs font-normal text-white/45">· ${c.price} / {c.unit}</span></p>
                  <p className="text-[11px] leading-5 text-white/50">{c.desc}</p>
                  {st && <p className="mt-0.5 text-[11px] text-emerald-300">✓ {st}</p>}
                </div>
                <motion.button whileTap={{ scale: 0.9 }} disabled={buying === c.key} onClick={() => buy(c.key, c.price)}
                  className={`shrink-0 rounded-2xl px-3 py-2 text-xs font-bold disabled:opacity-50 ${st && !["boost", "photos", "visitors"].includes(c.key) && !(c.key === "anonFilters" && !me?.anonFilters?.viaVip) ? "border border-white/15 text-white/50" : isVipCard ? "bg-gradient-to-l from-amber-300 to-amber-500 text-black" : GRAD}`}>
                  {buying === c.key ? "…" : c.key === "visitors" && ent.profileVisitors ? "عرض" : c.key === "photos" && ent.extraPhotos ? "رفع" : c.key === "anonFilters" && st && !me?.anonFilters?.viaVip ? "تمديد" : st && !["boost"].includes(c.key) ? "مفعّل" : c.key === "verify" ? "ابدأ" : isVipCard && ent.vip ? "تمديد" : "شراء"}
                </motion.button>
              </div>
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
          <p className="text-[11px] text-white/50">عند اعتماد ملف أي صديق دعوته تحصل تلقائياً على رفع مجاني لملفك 24 ساعة (نظام البوت). حصلت عليه {me.referral.rewarded} مرة.</p>
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

function MatchModal({ card, onClose, onChat }: { card: Card; onClose: () => void; onChat: () => void }) {
  useEffect(() => { haptic("success"); }, []);
  const hearts = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ i, x: Math.random() * 100, d: 2 + Math.random() * 2, s: 14 + Math.random() * 18 })), []);
  return (
    <motion.div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-[#0b1020]/95 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {hearts.map((h) => (
        <motion.span key={h.i} className="absolute bottom-0" style={{ left: `${h.x}%`, fontSize: h.s }} initial={{ y: 40, opacity: 0 }} animate={{ y: -900, opacity: [0, 1, 0] }} transition={{ duration: h.d, repeat: Infinity, delay: h.i * 0.15 }}>💗</motion.span>
      ))}
      <motion.div initial={{ scale: 0.6, rotate: -6 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="relative text-center">
        <h2 className="text-4xl font-black bg-gradient-to-l from-[#ff2e93] to-[#e8b4a0] bg-clip-text text-transparent drop-shadow">إنه توافق! 🎉</h2>
        <p className="mt-2 text-white/70">أنت و #{card.shortId} أُعجب كلٌّ منكما بالآخر</p>
        <div className="my-6 flex items-center justify-center">
          <div className={`grid h-24 w-24 place-items-center rounded-full border-4 border-[#0b1020] text-4xl ${GRAD}`}>💞</div>
          <div className="-mr-6 grid h-24 w-24 place-items-center rounded-full border-4 border-[#0b1020] bg-gradient-to-br from-[#6d8cff] to-[#ff7ab8] text-4xl">{card.gender === "FEMALE" ? "👩" : "👨"}</div>
        </div>
        <p className="mb-4 text-xs text-white/50">أرسل البوت تنبيهاً لكما في تلجرام</p>
        <button onClick={onChat} className={`w-full rounded-2xl py-3.5 font-bold ${GRAD}`}>💌 ابدأ دردشة مجهولة</button>
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
