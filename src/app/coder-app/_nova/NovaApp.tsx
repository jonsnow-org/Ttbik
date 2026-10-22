"use client";
// Nova AI Mini App, 2026-10-21 redesign: Mira's structure (floating pill nav Home / Chats / Schedules / Settings, a Home with a gradient
// header, model pill, Get Pro, greeting by first name, plan card, highlights, tools with + buttons, grouped Settings cards) in Fadaa's
// colours (./theme.ts: Auto / Light / Black (Fadaa) / Deep black). Every row opens a real feature in code; nothing here sends prepared
// text to the model (no "skills", no canned prompts) and nothing shows made-up numbers. Regular users see their plan and one usage
// percentage; the owner sees "∞" and never a limit. Same server API (/api/coder/app, signed initData, checked on the server).
// telegram-ui's AppRoot wraps every screen, the first spinner included ("[TGUI] Wrap your app with <AppRoot>" crashed the app once).
// The previous screens stay reachable: ?ui=native (telegram-ui lists) and ?ui=classic.
import "./nova.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppRoot, List, Spinner, Switch, Input } from "@telegram-apps/telegram-ui";
import { STR, type Lang, type Str } from "../i18n";
import {
  addToHome, bindBack, bioSupported, bioWanted, canAddToHome, closeApp, getLaunch, guard, haptic, homeStatus, isApple, isDark, openExternal,
  payInvoice, setBio, startTma,
} from "../_tma/sdk";
import { NSTR, fill, type NStr } from "./strings";
import { THEME_MODES, leaveFullscreen, loadMode, paintTelegram, resolveMode, saveMode, themeVars, type Resolved, type ThemeMode } from "./theme";
import {
  BillingPage, BrandIcon, ConnectorsTab, EventsTimeline, Fail, Loading, MemoryTab, PanelPage, PendingBanner, PolicySection, ScheduleForm, Sheet,
  ago, api, fmtTime, srcIcon, tx,
  type ConnView, type Me, type Pending, type PubModel, type PubPlan, type PubUsage, type Sched, type Task, type Ev,
} from "./parts";

type Tab = "home" | "chats" | "auto" | "settings";
type Page = { k: "billing" | "pricing" | "panel" | "connect" | "memory" | "policy" } | { k: "thread"; id: string; title: string } | null;
type Thread = { id: string; title: string; legacy: boolean; messages_count?: number; created_at: string; updated_at: string };
type Threads = { threads: Thread[]; current: string | null; currentEmpty: boolean; live: (Task & { thread_id?: string })[]; runs: Task[]; pending: Pending[] };
type Billing = { usage: PubUsage; plans: PubPlan[] };
type Models = { models: PubModel[]; owner?: (PubModel & { visible: boolean; isDefault: boolean; ready: boolean })[] };
type Ctx = { t: Str; n: NStr; lang: Lang; me: Me; owner: boolean; go: (tab: Tab) => void; open: (p: Page) => void; reload: () => void; mode: Resolved };

const TABS: Tab[] = ["home", "chats", "auto", "settings"];
const NAV_KEY: Record<Tab, keyof NStr> = { home: "navHome", chats: "navChats", auto: "navSchedules", settings: "navSettings" };
const NAV_ICON: Record<Tab, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9v11h4.5v-6h4v6h4.5V9",
  chats: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z",
  auto: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
};
/** Old links keep working: ?tab= / start param → Nova's tab + sub-page. */
function routeFrom(want: string): { tab: Tab; page: Page } {
  if (want === "panel") return { tab: "settings", page: { k: "panel" } };
  if (want === "plans" || want === "billing") return { tab: "settings", page: { k: "billing" } };
  if (want === "connectors" || want === "connect") return { tab: "home", page: { k: "connect" } };
  if (want === "memory") return { tab: "settings", page: { k: "memory" } };
  if (want === "tasks" || want === "chats") return { tab: "chats", page: null };
  if (want === "schedules" || want === "auto") return { tab: "auto", page: null };
  if (want === "settings") return { tab: "settings", page: null };
  return { tab: "home", page: null };
}

// ---------------------------------------------------------------- small pieces
const Chev = () => (
  <svg className="n-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
);
function Mark({ size = 54, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M15 12l-7 8 7 8M25 12l7 8-7 8" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="2.8" fill={color} />
    </svg>
  );
}
function Row({ icon, title, sub, value, badge, after, onClick, chevron = true, tone }: {
  icon?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; value?: React.ReactNode; badge?: React.ReactNode; after?: React.ReactNode;
  onClick?: (el: HTMLElement) => void; chevron?: boolean; tone?: string;
}) {
  const inner = (
    <>
      {icon !== undefined && <span className="n-ico" aria-hidden="true">{icon}</span>}
      <span className="n-body">
        <span className="n-t" style={tone ? { color: tone } : undefined}><span dir="auto">{title}</span>{badge}</span>
        {sub && <span className="n-s" dir="auto">{sub}</span>}
      </span>
      {value !== undefined && value !== null && value !== "" && <span className="n-val" dir="auto">{value}</span>}
      {after}
      {onClick && chevron && !after && <Chev />}
    </>
  );
  return onClick ? <button type="button" className="n-row" onClick={(e) => { haptic("light"); onClick(e.currentTarget); }}>{inner}</button> : <div className="n-row">{inner}</div>;
}
function Card({ title, cap, children, className = "" }: { title?: string; cap?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`n-card ${className}`}>
      {title && <span className="n-card-title">{title}</span>}
      {cap && <span className="n-card-cap">{cap}</span>}
      {children}
    </section>
  );
}
function Head({ lang, title, action }: { lang: Lang; title: string; action?: React.ReactNode }) {
  return <div className="n-h" lang={lang}><h2>{title}</h2>{action}</div>;
}
/** Option list in a bottom sheet (theme, language, accuracy, section). */
function Options<T extends string>({ open, title, value, items, onPick, onClose }: {
  open: boolean; title: string; value: T; items: { id: T; label: string; sub?: string; icon?: string }[]; onPick: (v: T) => void; onClose: () => void;
}) {
  useEffect(() => (open ? bindBack(true, onClose) : undefined), [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="n-scrim" onClick={onClose} />
      <div className="n-sheet" role="dialog" aria-label={title}>
        <div className="n-grip" />
        <h3>{title}</h3>
        {items.map((it) => (
          <button key={it.id} type="button" className={`n-opt${it.id === value ? " n-sel" : ""}`} aria-pressed={it.id === value}
            onClick={() => { haptic("select"); onPick(it.id); onClose(); }}>
            {it.icon && <span className="n-ico" aria-hidden="true">{it.icon}</span>}
            <span className="n-body"><span className="n-t">{it.label}</span>{it.sub && <span className="n-s">{it.sub}</span>}</span>
            {it.id === value && <span className="n-check" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- model popover (Mira: anchored under the pill)
function useModels() {
  const [d, setD] = useState<Models | null>(null);
  const load = useCallback(() => api<Models>("models").then(setD).catch(() => setD((x) => x || { models: [] })), []);
  useEffect(() => { void load(); }, [load]);
  return { d, load };
}
const modelName = (d: Models | null, lang: Lang) => {
  const l = d ? d.owner || d.models : [];
  const m = l.find((x) => x.selected) || l[0];
  return m ? m.name[lang] : "Nova AI";
};
type Anchor = { top?: number; bottom?: number } | null;
/** Under the anchor; if the anchor sits low on the screen, above it instead. */
const anchorOf = (el: HTMLElement): Anchor => {
  const r = el.getBoundingClientRect();
  return r.bottom > window.innerHeight * 0.5 ? { bottom: Math.max(16, window.innerHeight - r.top + 4) } : { top: r.bottom + 8 };
};
function ModelPopover({ at, d, lang, n, onPicked, onClose }: { at: Anchor; d: Models | null; lang: Lang; n: NStr; onPicked: () => void; onClose: () => void }) {
  useEffect(() => (at !== null ? bindBack(true, onClose) : undefined), [at, onClose]);
  if (at === null) return null;
  const list = d ? d.owner || d.models : [];
  const pick = async (id: string) => {
    haptic("select");
    try { await api("settings", { model: id }); haptic("success"); } catch { haptic("error"); }
    onPicked();
    onClose();
  };
  return (
    <>
      <div className="n-scrim" style={{ background: "transparent" }} onClick={onClose} />
      <div className="n-pop" role="listbox" aria-label={n.modelPick} style={at}>
        {!d ? <Loading /> : list.map((m) => {
          const o = d.owner?.find((x) => x.id === m.id);
          return (
            <button key={m.id} type="button" role="option" aria-selected={m.selected} className={`n-opt${m.selected ? " n-sel" : ""}`} onClick={() => pick(m.id)}>
              <span className="n-body">
                <span className="n-t">{m.name[lang]}{m.price_stars ? <span className="n-pro">{n.pro}</span> : null}{o && !o.visible ? <span className="n-chip">{n.hidden}</span> : null}</span>
                <span className="n-s">{m.desc[lang]}</span>
              </span>
              {m.selected && <span className="n-check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Home
const CAT: Record<string, "cat_dev" | "cat_prod"> = { github: "cat_dev", vercel: "cat_dev", supabase: "cat_dev", gmail: "cat_prod", google_drive: "cat_prod", notion: "cat_prod", slack: "cat_prod", discord: "cat_prod" };
function useBilling(on: boolean) {
  const [b, setB] = useState<Billing | null>(null);
  const load = useCallback(() => api<Billing>("billing").then(setB).catch(() => null), []);
  useEffect(() => { if (on) void load(); }, [on, load]);
  return { b, load };
}
function PlanCard({ c, b }: { c: Ctx; b: Billing | null }) {
  const { n, lang, owner } = c;
  if (owner) {
    return (
      <Card className="n-raise">
        <div className="n-token">
          <div className="n-body"><div className="n-lbl">{n.yourPlan}</div><div className="n-big"><span aria-hidden="true">∞</span>{n.unlimitedOwner}</div></div>
          <span className="n-chip n-on">{n.ownerChip}</span>
        </div>
      </Card>
    );
  }
  const u = b?.usage;
  return (
    <Card className="n-raise">
      <div className="n-token">
        <div className="n-body">
          <div className="n-lbl">{n.yourPlan}{u ? ` · ${u.plan.name[lang]}` : ""}</div>
          <div className="n-big">{!u ? "…" : u.unlimited ? <><span aria-hidden="true">∞</span>{c.t.unlimited}</> : fill(n.usedPct, { p: u.percent })}</div>
          {u && !u.unlimited && <div className="n-bar" role="progressbar" aria-valuenow={u.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(2, u.percent)}%` }} /></div>}
        </div>
        <button type="button" className="n-btn" onClick={() => { haptic("medium"); c.open({ k: "billing" }); }}>{n.topUp}</button>
      </div>
    </Card>
  );
}
function Home({ c, firstName, models, reloadModels }: { c: Ctx; firstName: string; models: Models | null; reloadModels: () => void }) {
  const { t, n, lang, me, owner, open, go } = c;
  const { b } = useBilling(!owner);
  const [conns, setConns] = useState<ConnView[] | null>(null);
  const [busy, setBusy] = useState("");
  const [live, setLive] = useState<Threads | null>(null);
  const [pop, setPop] = useState<Anchor>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const liveLoading = useRef(false);
  const loadConns = useCallback(() => api<{ connectors: ConnView[] }>("connectors").then((d) => setConns(d.connectors)).catch(() => setConns((x) => x || [])), []);
  const loadLive = useCallback(async () => {
    // The home screen refreshes on a timer and on app focus; never stack slow requests.
    if (liveLoading.current || document.visibilityState !== "visible") return;
    liveLoading.current = true;
    try {
      try {
        setLive(await api<Threads>("threads", { limit: 1 }));
      } catch {
        const d = await api<{ tasks: Task[]; pending: Pending[] }>("tasks", { limit: 10 });
        setLive({ threads: [], current: null, currentEmpty: true, live: d.tasks.filter((x) => x.status === "running" || x.status === "waiting"), runs: [], pending: d.pending });
      }
    } catch {
      // Keep the last good snapshot on transient network/API errors.
    } finally {
      liveLoading.current = false;
    }
  }, []);
  useEffect(() => {
    void loadConns();
    void loadLive();
    const on = () => { if (document.visibilityState === "visible") { void loadConns(); void loadLive(); } };
    document.addEventListener("visibilitychange", on);
    const iv = setInterval(() => document.visibilityState === "visible" && loadLive(), 5000);
    return () => { document.removeEventListener("visibilitychange", on); clearInterval(iv); };
  }, [loadConns, loadLive]);
  const start = async (x: ConnView) => {
    if (x.status !== "available") return;
    haptic("medium");
    setBusy(x.id);
    try { const { url } = await api<{ url: string }>("connector_start", { id: x.id }); openExternal(url); } catch { haptic("error"); } finally { setBusy(""); }
  };
  const top = b ? Math.max(0, ...b.plans.map((p) => p.tier)) : 0;
  const cur = b?.plans.find((p) => p.current);
  const showPro = !owner && b && b.plans.some((p) => p.price_stars) && (!cur || cur.tier < top);
  const gh = me.connections.github;
  return (
    <>
      <div className="n-hero">
        <div className="n-top">
          <button ref={pill} type="button" className="n-pill-model" aria-haspopup="listbox" aria-expanded={pop !== null}
            onClick={() => { haptic("light"); setPop(pill.current ? anchorOf(pill.current) : { top: 80 }); }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{modelName(models, lang)}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {owner ? <span className="n-chip-owner">∞ {n.ownerChip}</span>
            : showPro ? <button type="button" className="n-pill-pro" onClick={() => { haptic("medium"); open({ k: "billing" }); }}><span aria-hidden="true">⚡</span>{n.getPro}</button> : null}
        </div>
        <div className="n-mark"><Mark size={56} /></div>
        <h1 className="n-hi" lang={lang} dir="auto">{firstName ? fill(n.hi, { name: firstName }) : n.welcome}</h1>
      </div>
      <div className="n-wrap">
        <PlanCard c={c} b={b} />
        {live && (live.pending.length > 0 || live.live.length > 0) && (
          <>
            <Head lang={lang} title={n.runningNow} />
            {live.pending.map((p) => <div key={p.nonce} className="n-card n-tg"><List><PendingBanner p={p} t={t} cats={me.prefs.categories} lang={lang} onDone={loadLive} /></List></div>)}
            {live.live.length > 0 && (
              <Card>
                {live.live.map((x) => (
                  <Row key={x.run_id} icon={srcIcon(x.source)} title={x.title || "—"} sub={`${tx(t, `status_${x.status}`)} · ${ago(x.updated_at, t)}`}
                    after={<span className="n-dot" aria-hidden="true" />} onClick={() => (x.thread_id ? open({ k: "thread", id: x.thread_id, title: x.title }) : go("chats"))} />
                ))}
              </Card>
            )}
          </>
        )}
        <Head lang={lang} title={n.highlights} />
        <Card>
          <Row icon="💬" title={n.h_ask} sub={n.h_askSub} onClick={() => closeApp()} />
          {gh.linked
            ? <Row icon="🐙" title={n.h_repo} sub={n.h_repoSub} value={<span dir="ltr">{me.settings.repo || gh.login || "—"}</span>} onClick={() => open({ k: "connect" })} />
            : <Row icon="🐙" title={n.h_gh} sub={n.h_ghSub} onClick={() => open({ k: "connect" })} />}
          <Row icon="⏰" title={n.h_sched} sub={n.h_schedSub} badge={<span className="n-new">{n.isNew}</span>} onClick={() => go("auto")} />
          <Row icon="🔌" title={n.h_conn} sub={n.h_connSub} badge={<span className="n-new">{n.isNew}</span>} onClick={() => open({ k: "connect" })} />
          <Row icon="🧠" title={n.h_mem} sub={n.h_memSub} onClick={() => open({ k: "memory" })} />
        </Card>
        <Head lang={lang} title={n.tools} action={<button type="button" className="n-link" onClick={() => { haptic("light"); open({ k: "connect" }); }}>{n.showAll}</button>} />
        <Card cap={n.toolsSub}>
          {!conns ? <Loading /> : conns.slice(0, 6).map((x) => (
            <Row key={x.id} icon={<BrandIcon c={x} />} title={x.name} sub={x.status === "connected" ? `${t.connected}${x.label ? ` · ${x.label}` : ""}` : x.desc[lang]}
              badge={CAT[x.id] ? <span className="n-cat">{n[CAT[x.id]]}</span> : undefined}
              after={x.status === "connected" ? <span className="n-plus n-ok" aria-label={t.connected}>✓</span>
                : x.status === "soon" ? <span className="n-chip">{t.soon}</span>
                : <button type="button" className="n-plus" aria-label={`${t.connect} ${x.name}`} disabled={busy === x.id} onClick={(e) => { e.stopPropagation(); void start(x); }}>{busy === x.id ? "…" : "+"}</button>} />
          ))}
        </Card>
        <Head lang={lang} title={n.can} />
        <Card>
          <Row icon="🐙" title={n.c_gh} sub={n.c_ghSub} onClick={() => open({ k: "connect" })} />
          <Row icon="🧪" title={n.c_box} sub={n.c_boxSub} />
          <Row icon="🌐" title={n.c_web} sub={n.c_webSub} />
          <Row icon="🧠" title={n.c_mem} sub={n.c_memSub} onClick={() => open({ k: "memory" })} />
          <Row icon="⏰" title={n.c_sched} sub={n.c_schedSub} onClick={() => go("auto")} />
          <Row icon="🔌" title={n.c_mcp} sub={n.c_mcpSub} onClick={() => open({ k: "connect" })} />
        </Card>
      </div>
      <ModelPopover at={pop} d={models} lang={lang} n={n} onPicked={reloadModels} onClose={() => setPop(null)} />
    </>
  );
}

// ---------------------------------------------------------------- Chats (conversation threads; falls back to the request list)
function Chats({ c }: { c: Ctx }) {
  const { t, n, lang, me, open } = c;
  const [d, setD] = useState<Threads | null>(null);
  const [fallback, setFallback] = useState<Task[] | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current || document.visibilityState !== "visible") return;
    loading.current = true;
    try {
      try { setD(await api<Threads>("threads", { limit: 40 })); setFallback(null); setErr(""); }
      catch (e: any) {
        try { const x = await api<{ tasks: Task[]; pending: Pending[] }>("tasks", { limit: 30 }); setFallback(x.tasks); setErr(""); }
        catch { setErr(e instanceof Error ? e.message : "تعذّر تحميل المحادثات."); }
      }
    } finally {
      loading.current = false;
    }
  }, []);
  useEffect(() => {
    void load();
    const iv = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    return () => clearInterval(iv);
  }, [load]);
  const fresh = async () => {
    if (busy) return;
    setBusy(true);
    haptic("medium");
    try { await api("thread_new"); setNote(true); haptic("success"); void load(); } catch { haptic("error"); } finally { setBusy(false); }
  };
  const isLive = (s: string) => s === "running" || s === "waiting";
  return (
    <div className="n-page">
      <div className="n-ph" lang={lang}>
        <h1>{n.chatsTitle}</h1>
        {!fallback && <button type="button" className="n-fab" aria-label={t.newChat} onClick={fresh} disabled={busy}>+</button>}
      </div>
      {note && (
        <div className="n-note" role="status">
          {t.newChatStarted}
          <div style={{ marginTop: 10 }}><button type="button" className="n-btn" onClick={() => closeApp()}>{n.goChat}</button></div>
        </div>
      )}
      {err && !d && !fallback ? <Fail t={t} msg={err} retry={load} />
        : fallback ? (
          <>
            <Head lang={lang} title={n.tasksFallback} />
            <Card>{fallback.length ? fallback.map((x) => <Row key={x.run_id} icon={srcIcon(x.source)} title={x.title || "—"} sub={`${tx(t, `status_${x.status}`)} · ${ago(x.updated_at, t)}`} />) : <div className="n-empty">{t.noTasks}</div>}</Card>
          </>
        )
        : !d ? <Loading /> : (
          <>
            {d.pending.map((p) => <div key={p.nonce} className="n-card n-tg"><List><PendingBanner p={p} t={t} cats={me.prefs.categories} lang={lang} onDone={load} /></List></div>)}
            {d.threads.length === 0 ? (
              <Card>
                <div className="n-empty">
                  <div className="n-mark"><Mark size={52} color="var(--n-primary)" /></div>
                  <div style={{ marginBottom: 14 }}>{t.noChats}</div>
                  <button type="button" className="n-btn" onClick={fresh}>+ {n.startChat}</button>
                </div>
              </Card>
            ) : (
              <Card>
                {d.threads.map((h) => {
                  const running = d.live.some((x) => x.thread_id === h.id && isLive(x.status));
                  return (
                    <Row key={h.id} icon={h.legacy ? "🗂️" : "💬"} title={h.title || t.untitled}
                      badge={h.id === d.current ? <span className="n-chip n-on">{t.currentChat}</span> : undefined}
                      sub={`${ago(h.updated_at, t)}${h.messages_count ? ` · ${h.messages_count} ${n.messages}` : ""}`}
                      after={running ? <span className="n-dot" aria-hidden="true" /> : undefined}
                      onClick={() => open({ k: "thread", id: h.id, title: h.title || t.untitled })} />
                  );
                })}
              </Card>
            )}
            {d.runs.length > 0 && (
              <>
                <Head lang={lang} title={t.scheduledRuns} />
                <Card>{d.runs.map((x) => <Row key={x.run_id} icon={srcIcon(x.source)} title={x.title || "—"} sub={`${tx(t, `src_${x.source}`)} · ${ago(x.updated_at, t)}`} value={tx(t, `status_${x.status}`)} />)}</Card>
              </>
            )}
          </>
        )}
    </div>
  );
}
type ThreadTask = { run_id: string; title: string; status: string; started_at: string; finished_at: string | null; events: Ev[] };
function ThreadPage({ c, id, onGone }: { c: Ctx; id: string; onGone: () => void }) {
  const { t, n } = c;
  const [d, setD] = useState<{ thread: Thread; current: boolean; tasks: ThreadTask[] } | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const load = useCallback(async () => {
    if (loading.current || document.visibilityState !== "visible") return;
    loading.current = true;
    try { setD(await api("thread", { id })); setErr(""); }
    catch (e: any) { setErr(e instanceof Error ? e.message : "تعذّر تحميل المحادثة."); }
    finally { loading.current = false; }
  }, [id]);
  useEffect(() => {
    void load();
    const iv = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    return () => clearInterval(iv);
  }, [load]);
  if (err && !d) return <div className="n-page"><Fail t={t} msg={err} retry={load} /></div>;
  if (!d) return <Loading />;
  const live = (s: string) => s === "running" || s === "waiting";
  const cont = async () => { setBusy(true); haptic("medium"); try { await api("thread_open", { id }); closeApp(); } finally { setBusy(false); } };
  return (
    <div style={{ paddingTop: 8 }}>
      {!d.tasks.length && <div className="n-empty">{t.noMessages}</div>}
      {d.tasks.map((k) => (
        <div key={k.run_id}>
          {k.events.map((e) => (
            e.kind === "start" ? <div key={e.id} className="n-bubble n-me" dir="auto">{e.text.slice(0, 4000)}</div>
              : e.kind === "text" ? <div key={e.id} className="n-bubble n-bot" dir="auto">{e.text.slice(0, 4000)}</div>
              : <div key={e.id} className="n-meta" dir="auto">{e.kind === "failed" ? "⚠️" : e.kind === "confirm" ? "❓" : "•"} {tx(t, `ev_${e.kind}`)}: {e.text.slice(0, 300)}</div>
          ))}
          <div className="n-meta">{ago(k.started_at, t)}{live(k.status) ? ` · ${tx(t, `status_${k.status}`)}` : ""}</div>
          {live(k.status) && <div className="n-wrap"><button type="button" className="n-btn n-ghost" onClick={async () => { haptic("warning"); await api("stop", { runId: k.run_id, slot: "" }); void load(); }}>⏹ {t.stop}</button></div>}
        </div>
      ))}
      <div className="n-wrap" style={{ marginTop: 16 }}>
        <button type="button" className="n-btn n-wide" disabled={busy} onClick={cont}>💬 {d.current ? `${t.continueHere} · ${t.currentChat}` : t.continueHere}</button>
        <p className="n-meta" style={{ margin: "8px 4px 16px" }}>{t.continueHint}</p>
        <Card>
          {name === null ? <Row icon="✏️" title={t.rename} onClick={() => setName(d.thread.title)} />
            : (
              <div className="n-tg">
                <List>
                  <Input header={t.rename} value={name} maxLength={80} dir="auto" onChange={(e) => setName(e.target.value)} />
                </List>
                <div style={{ padding: "0 16px 14px" }}>
                  <button type="button" className="n-btn" disabled={!name.trim()} onClick={async () => { await api("thread_rename", { id, title: name }); haptic("success"); setName(null); void load(); }}>{t.save}</button>
                </div>
              </div>
            )}
          <Row icon="🗑" title={t.hideChat} sub={t.hideChatQ} tone="var(--n-danger)" chevron={false}
            onClick={async () => { if (!(await guard(t.hideChat))) return; await api("thread_delete", { id }); haptic("success"); onGone(); }} />
        </Card>
              </div>
    </div>
  );
}

// ---------------------------------------------------------------- Schedules
function Schedules({ c }: { c: Ctx }) {
  const { t, n, lang, me } = c;
  const [rows, setRows] = useState<Sched[] | null>(null);
  const [form, setForm] = useState<Sched | "new" | null>(null);
  const [menu, setMenu] = useState<Sched | null>(null);
  const load = useCallback(async () => setRows((await api<{ schedules: Sched[] }>("schedules")).schedules), []);
  useEffect(() => { void load().catch(() => setRows([])); }, [load]);
  const closeForm = useCallback(() => setForm(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  return (
    <div className="n-page">
      <div className="n-ph" lang={lang}>
        <h1>{n.schedTitle}</h1>
        <button type="button" className="n-fab" aria-label={t.newSchedule} onClick={() => { haptic("light"); setForm("new"); }}>+</button>
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? (
        <Card>
          <div className="n-empty">
            <div style={{ fontSize: 44, marginBottom: 8 }} aria-hidden="true">🗓️</div>
            <div style={{ marginBottom: 14 }}>{t.noSchedules}</div>
            <button type="button" className="n-btn" onClick={() => setForm("new")}>+ {t.newSchedule}</button>
          </div>
        </Card>
      ) : (
        <Card>
          {rows.map((s) => (
            <Row key={s.id} icon={s.kind === "cron" ? "⏰" : "⚡"} title={s.title} onClick={() => setMenu(s)}
              sub={<>{s.describe}{s.kind === "cron" && !s.paused ? ` · ${n.nextRun}: ${fmtTime(s.next_run_at, s.tz, lang)}` : ""}{s.last_status ? ` · ${t.last}: ${tx(t, `status_${s.last_status}`)}` : ""}</>}
              badge={s.paused ? <span className="n-chip">{n.paused}</span> : undefined}
              after={<span dir="ltr" style={{ display: "inline-flex" }} onClick={(e) => e.stopPropagation()}><Switch checked={!s.paused} aria-label={s.paused ? t.resume : t.pause}
                onChange={async (e) => { haptic("select"); await api("schedule_pause", { id: s.id, paused: !e.currentTarget.checked }); void load(); }} /></span>} />
          ))}
        </Card>
      )}
      <Sheet open={!!menu} onClose={closeMenu} title={menu?.title}>
        {menu && (
          <div className="n-wrap">
            <Card>
              <Row icon="▶" title={t.runNow} chevron={false} onClick={async () => { haptic("medium"); await api("schedule_run", { id: menu.id }); setMenu(null); }} />
              <Row icon="✏️" title={t.edit} chevron={false} onClick={() => { const s = menu; setMenu(null); setForm(s); }} />
              <Row icon="🗑" title={t.delete} sub={t.deleteQ} tone="var(--n-danger)" chevron={false}
                onClick={async () => { if (!(await guard(t.delete))) return; await api("schedule_delete", { id: menu.id, confirm: true }); haptic("success"); setMenu(null); void load(); }} />
            </Card>
          </div>
        )}
      </Sheet>
      <Sheet open={!!form} onClose={closeForm} title={form && form !== "new" ? t.edit : t.newSchedule}>
        {form && <ScheduleForm t={t} lang={lang} me={me} initial={form === "new" ? null : form} onSaved={() => { setForm(null); void load(); }} />}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- Settings (Mira's grouped cards)
function Settings({ c, mode, setMode, models, reloadModels }: { c: Ctx; mode: ThemeMode; setMode: (m: ThemeMode) => void; models: Models | null; reloadModels: () => void }) {
  const { t, n, lang, me, owner, open, reload } = c;
  const [s, setS] = useState(me.settings);
  const [sheet, setSheet] = useState<"" | "theme" | "lang" | "acc" | "section" | "tz">("");
  const [pop, setPop] = useState<Anchor>(null);
  const [memCount, setMemCount] = useState<number | null>(null);
  const [home, setHome] = useState("");
  const [bio, setBioState] = useState<{ on: boolean; ok: boolean | null }>({ on: bioWanted(), ok: null });
  const [status, setStatus] = useState("");
  const { b } = useBilling(!owner);
  useEffect(() => {
    void api<{ memories: unknown[] }>("memories").then((d) => setMemCount(d.memories.length)).catch(() => null);
    void homeStatus().then(setHome);
    void bioSupported().then((ok) => setBioState((x) => ({ ...x, ok })));
  }, []);
  const set = async (p: Partial<Me["settings"]>) => {
    const prev = s;
    setS({ ...s, ...p });
    try { await api("settings", p); haptic("success"); if (p.lang || p.mode || p.tz) reload(); } catch { setS(prev); haptic("error"); }
  };
  const closeSheet = useCallback(() => setSheet(""), []);
  const acc = s.accuracy || "balanced";
  const themeLabel = { auto: n.th_auto, light: n.th_light, black: n.th_black, oled: n.th_oled }[mode];
  const planLabel = owner ? `∞ ${n.unlimitedOwner}` : b ? b.usage.plan.name[lang] : "…";
  const gh = me.connections.github;
  return (
    <div className="n-page">
      <div className="n-ph" lang={lang}><h1>{n.navSettings}</h1></div>
      <Card title={n.g_nova}>
        <Row icon="🧠" title={n.s_think} sub={t.thinkingHint} after={<span dir="ltr" style={{ display: "inline-flex" }}><Switch checked={s.think} aria-label={n.s_think} onChange={(e) => set({ think: e.currentTarget.checked })} /></span>} />
        <Row icon="🎯" title={n.s_acc} value={tx(t, `acc_${acc}`)} onClick={() => setSheet("acc")} />
        <Row icon="🛡️" title={n.s_policy} onClick={() => open({ k: "policy" })} />
        {me.features?.sham && <Row icon="🗂" title={n.s_section} value={s.mode === "sham" ? t.sham : t.coder} onClick={() => setSheet("section")} />}
      </Card>
      <Card title={n.g_profile}>
        <Row icon="👤" title={n.s_mem} value={memCount === null ? "" : String(memCount)} onClick={() => open({ k: "memory" })} />
        <Row icon="💎" title={n.s_plan} value={planLabel} tone={owner ? undefined : "var(--n-primary)"} onClick={() => open({ k: "billing" })} />
        <Row icon="🐙" title={n.s_github} value={gh.linked ? <span dir="ltr">{gh.login || t.linked}</span> : n.notLinked} onClick={() => open({ k: "connect" })} />
      </Card>
      <Card title={n.g_app}>
        <Row icon="🤖" title={n.s_model} value={modelName(models, lang)} onClick={(el) => setPop(anchorOf(el))} />
        <Row icon="🌐" title={n.s_lang} value={lang === "ar" ? "العربية" : "English"} onClick={() => setSheet("lang")} />
        <Row icon="🎨" title={n.s_theme} value={themeLabel} onClick={() => setSheet("theme")} />
        <Row icon="🕒" title={n.s_tz} value={<span dir="ltr">{s.tz || "—"}</span>} onClick={() => setSheet("tz")} />
        {(canAddToHome() || home === "added") && <Row icon="📲" title={n.s_home} value={home === "added" ? "✓" : ""} onClick={home === "added" ? undefined : () => addToHome()} />}
        <Row icon="🔒" title={n.s_bio} sub={bio.ok === false ? t.biometricNo : t.biometricHint}
          after={<span dir="ltr" style={{ display: "inline-flex" }}><Switch checked={bio.on} disabled={bio.ok === false} aria-label={n.s_bio} onChange={async (e) => { const v = e.currentTarget.checked; const ok = await setBio(v); setBioState({ on: v && ok, ok: v ? ok : bio.ok }); haptic(ok ? "success" : "error"); }} /></span>} />
        <Row icon="🩺" title={n.s_status} value={status} chevron={false} onClick={async () => {
          setStatus("…");
          try { const d = await api<Record<string, unknown>>("status"); setStatus(d.available === false ? `⚠️ ${t.serviceDown}` : `✅ ${t.serviceOk}`); } catch { setStatus(`⚠️ ${t.serviceDown}`); }
        }} />
      </Card>
      {owner && (
        <Card title={n.g_owner}>
          <Row icon="🛠️" title={n.s_panel} onClick={() => open({ k: "panel" })} />
          <Row icon="🏷️" title={n.s_pricing} onClick={() => open({ k: "pricing" })} />
        </Card>
      )}
      <Options open={sheet === "theme"} title={n.s_theme} value={mode} onClose={closeSheet} onPick={setMode}
        items={THEME_MODES.map((m) => ({ id: m, icon: { auto: "🌓", light: "☀️", black: "🌌", oled: "⚫" }[m], label: { auto: n.th_auto, light: n.th_light, black: n.th_black, oled: n.th_oled }[m], sub: { auto: n.th_autoSub, light: n.th_lightSub, black: n.th_blackSub, oled: n.th_oledSub }[m] }))} />
      <Options open={sheet === "lang"} title={n.s_lang} value={lang} onClose={closeSheet} onPick={(v) => set({ lang: v })}
        items={[{ id: "ar" as Lang, label: "العربية" }, { id: "en" as Lang, label: "English" }]} />
      <Options open={sheet === "acc"} title={n.s_acc} value={acc} onClose={closeSheet} onPick={(v) => set({ accuracy: v })}
        items={(["fast", "balanced", "precise"] as const).map((a) => ({ id: a, label: tx(t, `acc_${a}`), sub: tx(t, `accHint_${a}`) }))} />
      <Options open={sheet === "tz"} title={n.s_tz} value={s.tz || "Europe/Istanbul"} onClose={closeSheet} onPick={(v) => set({ tz: v })}
        items={[
          { id: "Europe/Istanbul", label: "Europe/Istanbul", sub: "تركيا" },
          { id: "Asia/Damascus", label: "Asia/Damascus", sub: "سوريا" },
          { id: "Asia/Riyadh", label: "Asia/Riyadh", sub: "السعودية" },
          { id: "Asia/Dubai", label: "Asia/Dubai", sub: "الإمارات" },
          { id: "Europe/London", label: "Europe/London", sub: "المملكة المتحدة" },
          { id: "UTC", label: "UTC", sub: "التوقيت العالمي" },
          { id: "America/New_York", label: "America/New_York", sub: "الولايات المتحدة — الساحل الشرقي" },
        ]} />
      <Options open={sheet === "section"} title={n.s_section} value={s.mode} onClose={closeSheet} onPick={(v) => set({ mode: v })}
        items={[{ id: "coder" as const, label: t.coder }, { id: "sham" as const, label: t.sham }]} />
      <ModelPopover at={pop} d={models} lang={lang} n={n} onPicked={reloadModels} onClose={() => setPop(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- Billing (plan card + plans; Stars invoice unchanged)
function Billing({ c }: { c: Ctx }) {
  const { t, n, lang, me, owner } = c;
  const { b, load } = useBilling(true);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const buy = async (p: PubPlan) => {
    if (!(await guard(t.upgrade))) return;
    setBusy(p.id);
    setNote("");
    try {
      const { url } = await api<{ url: string }>("buy", { planId: p.id });
      const st = await payInvoice(url);
      if (st === "paid") { haptic("success"); setNote(t.paid); setTimeout(() => void load(), 2500); }
      else if (st === "cancelled") setNote(t.payCancelled);
      else if (st === "failed") { haptic("error"); setNote(t.payFailed); }
    } catch (e: any) { haptic("error"); setNote(e.message); } finally { setBusy(""); }
  };
  if (!b) return <Loading />;
  const u = b.usage;
  return (
    <div className="n-page" style={{ paddingTop: 8 }}>
      <Card>
        <div className="n-token">
          <div className="n-body">
            <div className="n-lbl">{t.currentPlan}</div>
            <div className="n-big">{owner || u.unlimited ? <><span aria-hidden="true">∞</span>{owner ? n.unlimitedOwner : t.unlimited}</> : u.plan.name[lang]}</div>
            {!owner && !u.unlimited && (
              <>
                <div className="n-s" style={{ marginTop: 8 }}>{fill(n.usedPct, { p: u.percent })} · {u.level === "full" ? t.usageFull : u.level === "high" ? t.usageHigh : t.usageOk}</div>
                <div className="n-bar"><i style={{ width: `${Math.max(2, u.percent)}%` }} /></div>
                {u.renewsAt && <div className="n-s" style={{ marginTop: 6 }}>{t.renewsAt}: {fmtTime(u.renewsAt, me.settings.tz, lang)}</div>}
              </>
            )}
            {u.periodEnd && <div className="n-s" style={{ marginTop: 6 }}>{t.planUntil}: {fmtTime(u.periodEnd, me.settings.tz, lang)}</div>}
          </div>
        </div>
      </Card>
      <Head lang={lang} title={n.plansTitle} />
      <div className="n-plans">
        {b.plans.map((p) => (
          <div key={p.id} className={`n-plan${p.current ? " n-cur" : ""}`}>
            <div className="n-pe" aria-hidden="true">{p.tier === 0 ? "🌱" : p.tier === 1 ? "⚡" : "🚀"}</div>
            <div className="n-pn">{p.name[lang]}</div>
            <div className="n-pp">{p.price_stars ? <>⭐ {p.price_stars} · {fill(n.per30, { d: p.days })}</> : p.id === "free" ? n.free : t.notForSale}</div>
            {p.current ? <span className="n-chip n-on" style={{ display: "inline-block", marginTop: 10 }}>{n.current}</span>
              : !owner && p.price_stars && p.id !== "free" ? <button type="button" className="n-btn" disabled={!!busy} onClick={() => buy(p)}>{busy === p.id ? "…" : `${t.upgrade} ⭐`}</button> : null}
            {p.current && !owner && p.price_stars && p.id !== "free" ? <div><button type="button" className="n-btn n-ghost" disabled={!!busy} onClick={() => buy(p)}>＋ ⭐</button></div> : null}
          </div>
        ))}
      </div>
      {note && <div className="n-note" role="status">{note}</div>}
      <p className="n-meta" style={{ margin: "0 4px" }}>{t.billingHint}</p>
    </div>
  );
}

// ---------------------------------------------------------------- shell
const SAFE = {
  "--safe-top": "calc(max(var(--tg-viewport-safe-area-inset-top, 0px), env(safe-area-inset-top, 0px)) + var(--tg-viewport-content-safe-area-inset-top, 0px))",
  "--safe-bottom": "calc(max(var(--tg-viewport-safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px)) + var(--tg-viewport-content-safe-area-inset-bottom, 0px))",
} as React.CSSProperties;
function useFonts() {
  useEffect(() => {
    if (document.getElementById("nova-fonts")) return;
    const l = document.createElement("link");
    l.id = "nova-fonts";
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Amiri:wght@700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);
}

export default function NovaApp() {
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "base">("base");
  const [tgDark, setTgDark] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>(() => loadMode());
  const [tab, setTab] = useState<Tab>("home");
  const [page, setPage] = useState<Page>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState("");
  const { d: models, load: reloadModels } = useModels();
  useFonts();
  const reload = useCallback(async () => {
    try { setMe(await api<Me>("me")); setErr(""); } catch (e: any) { setErr(e.status === 401 ? "__tg" : e.message); }
  }, []);
  useEffect(() => {
    let alive = true;
    void startTma().then((lp) => {
      if (!alive) return;
      setPlatform(isApple() ? "ios" : "base");
      leaveFullscreen();
      const r = routeFrom(new URLSearchParams(window.location.search).get("tab") || lp.startParam || "");
      setTab(r.tab);
      setPage(r.page);
      setMounted(true);
      void reload();
    }).catch(() => {
      // Never leave the Mini App on an infinite spinner if the Telegram SDK fails during startup.
      if (alive) { setErr("تعذّر تهيئة التطبيق. أغلقه وافتحه مجدداً من داخل Telegram."); setMounted(true); }
    });
    const apply = () => setTgDark(isDark() || (!getLaunch().inTelegram && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches)));
    apply();
    const id = setInterval(apply, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [reload]);
  useEffect(() => {
    if (me && !me.settings.tz) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) void api("settings", { tz }).then(reload);
    }
  }, [me, reload]);
  const resolved = resolveMode(mode, tgDark);
  const onHero = tab === "home" && !page;
  useEffect(() => { paintTelegram(resolved, onHero && !!me); }, [resolved, onHero, me]);
  const closePage = useCallback(() => setPage(null), []);
  useEffect(() => (page ? bindBack(true, closePage) : undefined), [page, closePage]);
  useEffect(() => { window.scrollTo(0, 0); }, [tab, page]);
  const setMode = useCallback((m: ThemeMode) => { setModeState(m); saveMode(m); haptic("success"); }, []);
  const vars = useMemo(() => ({ ...SAFE, ...themeVars(resolved) }) as React.CSSProperties, [resolved]);
  const code = getLaunch().languageCode;
  const lang: Lang = me?.settings.lang || (code === "ar" || !code ? "ar" : "en");
  const t = STR[lang];
  const n = NSTR[lang];
  const appearance = resolved === "light" ? "light" : "dark";
  if (!mounted) {
    return (
      <AppRoot appearance={appearance} platform={platform} className="nova" style={vars}>
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><Spinner size="l" /></div>
      </AppRoot>
    );
  }
  const owner = me?.tier === "owner";
  const go = (x: Tab) => { haptic("select"); setPage(null); setTab(x); };
  const open = (p: Page) => setPage(p);
  const ctx: Ctx | null = me ? { t, n, lang, me, owner, go, open, reload: () => void reload(), mode: resolved } : null;
  const pageTitle = !page ? "" : page.k === "thread" ? page.title : page.k === "billing" ? t.billing : page.k === "pricing" ? n.s_pricing : page.k === "panel" ? n.s_panel
    : page.k === "connect" ? t.tabConnectors : page.k === "memory" ? n.s_mem : n.s_policy;
  return (
    <AppRoot appearance={appearance} platform={platform} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="nova"
      style={{ ...vars, paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <main className={`n-main${page ? " n-sub" : ""}`}>
        {err === "__tg" ? <div className="n-page"><Card><div className="n-empty"><div className="n-mark"><Mark size={52} color="var(--n-primary)" /></div>{t.openInTelegram}</div></Card></div>
          : err ? <div className="n-page"><Fail t={t} msg={err} retry={err.startsWith("تعذّر تهيئة التطبيق") ? () => window.location.reload() : reload} /></div>
          : !ctx ? <div style={{ minHeight: "80vh", display: "grid", placeItems: "center" }}><Spinner size="l" /></div>
          : page ? (
            <>
              <div className="n-page" style={{ paddingBottom: 0 }}>
                <div className="n-ph" lang={lang} style={{ justifyContent: "flex-start" }}>
                  {!getLaunch().inTelegram && <button type="button" className="n-plus" aria-label="back" onClick={closePage}><span style={{ display: "inline-block", transform: lang === "ar" ? "none" : "scaleX(-1)" }}>➜</span></button>}
                  <h1 style={{ fontSize: 22 }} dir="auto">{pageTitle.slice(0, 60)}</h1>
                </div>
              </div>
              {page.k === "thread" ? <ThreadPage key={page.id} c={ctx} id={page.id} onGone={closePage} />
                : page.k === "billing" ? <Billing c={ctx} />
                : page.k === "pricing" ? (owner ? <div className="n-tg"><BillingPage t={t} lang={lang} me={ctx.me} /></div> : <Billing c={ctx} />)
                : page.k === "panel" ? (owner ? <div className="n-tg"><PanelPage lang={lang} /></div> : <Fail t={t} msg="—" retry={closePage} />)
                : page.k === "connect" ? <div className="n-tg"><ConnectorsTab t={t} me={ctx.me} lang={lang} reload={ctx.reload} /></div>
                : page.k === "memory" ? <div className="n-tg"><MemoryTab t={t} lang={lang} me={ctx.me} /></div>
                : <div className="n-tg"><List><PolicySection t={t} me={ctx.me} lang={lang} /></List></div>}
            </>
          )
          : tab === "home" ? <Home c={ctx} firstName={getLaunch().firstName} models={models} reloadModels={reloadModels} />
          : tab === "chats" ? <Chats c={ctx} />
          : tab === "auto" ? <Schedules c={ctx} />
          : <Settings key={lang} c={ctx} mode={mode} setMode={setMode} models={models} reloadModels={reloadModels} />}
      </main>
      {!page && ctx && (
        <nav className="n-nav" aria-label="Nova">
          {TABS.map((id) => (
            <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tab === id ? 2.4 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={NAV_ICON[id]} /></svg>
              {n[NAV_KEY[id]]}
            </button>
          ))}
        </nav>
      )}
    </AppRoot>
  );
}
