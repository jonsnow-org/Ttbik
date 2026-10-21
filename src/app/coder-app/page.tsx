"use client";
// The coder's Telegram Mini App: live tasks with streaming steps, confirmations synced with the chat buttons, task history,
// scheduled / event tasks, ready-made connectors, model settings with the confirmation policy, and a separate Billing section
// (Telegram Stars). Own visual identity ("signal" mark, ink + mint accent), following Telegram's theme (light/dark). Arabic RTL and English.
// 2026-10-21 rebuild: the official tma.js SDK (@tma.js/sdk-react, ./_tma/sdk.ts) instead of the raw telegram-web-app.js global,
// @telegram-apps/telegram-ui's AppRoot (platform-aware: iOS look on Apple, Material ripple on Android, automatic dark/light),
// full screen on phones, safe-area / content-safe-area insets, back button, home-screen shortcut and an optional biometric lock.
// Every API call carries the signed initData, validated on the server (src/lib/tmaInitData.ts); what a user may see (the Sham
// section, owner tools, usage details) is decided by the server from the verified Telegram id.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppRoot, Button as TgButton, Cell, Input, Section, Switch } from "@telegram-apps/telegram-ui";
import { STR, type Lang, type Str } from "./i18n";
import NativeApp from "./_native/NativeApp";
import NovaApp from "./_nova/NovaApp";
import { addToHome, bioSupported, bioWanted, canAddToHome, getLaunch, guard, haptic, homeStatus, isAndroid, isApple, isDark, openExternal, payInvoice, rawInitData, setBio, startTma, bindBack } from "./_tma/sdk";

type Tab = "tasks" | "schedules" | "memory" | "connect" | "settings" | "billing" | "panel";
type Mem = { id: number; scope: string; kind: "preference" | "fact" | "decision"; text: string; source_run: string | null; created_at: string; updated_at: string };
type Task = { run_id: string; slot: string; source: "interactive" | "scheduled" | "event"; schedule_id: string | null; title: string; status: string; steps?: number; started_at: string; updated_at: string; finished_at: string | null };
type Ev = { id: number; run_id: string; kind: string; text: string; created_at: string };
type Pending = { runId: string; nonce: string; reason: string; summary: string; tool: string; categories: string[]; title: string; slot: string; at: number | null };
type Rule = { category: string; repo: string; context: string; policy: "ask" | "allow" | "deny" };
type Cat = { id: string; label: { ar: string; en: string }; tierDefault: "ask" | "run" };
type Accuracy = "fast" | "balanced" | "precise";
type Me = { tier: "owner" | "user"; features?: { sham: boolean; ownerTools: boolean }; settings: { mode: "coder" | "sham"; think: boolean; accuracy?: Accuracy; lang: Lang; tz: string; repo: string }; connections: { github: { linked: boolean; login?: string; source?: string } }; oauth: boolean; prefs: { rules: Rule[]; categories: Cat[] }; events: string[] };
type Sched = { id: string; title: string; prompt: string; kind: "cron" | "event"; cron: string | null; tz: string; repo: string | null; events: string[]; paused: boolean; next_run_at: string | null; last_run_at: string | null; last_status: string | null; hook_id: number | null; describe: string };
type Repo = { full_name: string; private: boolean; default_branch: string; pushed_at: string | null; description: string };

async function api<T = any>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/coder/app", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() }, body: JSON.stringify({ op, ...body }), cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { status: r.status });
  return d as T;
}

function ago(iso: string | null, t: Str): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso.replace(" ", "T").replace(/\+00$/, "Z")).getTime()) / 1000);
  if (s < 45) return t.justNow;
  if (s < 3600) return `${Math.round(s / 60)}${t.min}`;
  if (s < 86400) return `${Math.round(s / 3600)}${t.hr}`;
  return `${Math.round(s / 86400)}${t.day}`;
}
const fmtTime = (iso: string | null, tz: string, lang: Lang) => {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SY" : "en-GB", { timeZone: tz || undefined, weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(new Date(iso.replace(" ", "T").replace(/\+00$/, "Z")));
  } catch {
    return iso.slice(0, 16);
  }
};

// ---------------------------------------------------------------- small UI kit
function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="cm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--c-accent)" />
          <stop offset="1" stopColor="var(--c-accent2)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="url(#cm)" />
      <path d="M15 13l-6 7 6 7M25 13l6 7-6 7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="20" cy="20" r="2.4" fill="#fff" />
    </svg>
  );
}
const Card = ({ children, className = "", ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={`rounded-2xl bg-[var(--c-card)] ring-1 ring-[var(--c-line)] ${className}`}>{children}</div>
);
function Btn({ kind = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "primary" | "ghost" | "danger" | "soft" }) {
  const k = {
    primary: "bg-[var(--c-accent)] text-[var(--c-on-accent)] shadow-sm",
    soft: "bg-[var(--c-accent-soft)] text-[var(--c-accent-ink)]",
    ghost: "bg-transparent text-[var(--c-text)] ring-1 ring-[var(--c-line)]",
    danger: "bg-[var(--c-danger-soft)] text-[var(--c-danger)]",
  }[kind];
  return <button {...p} className={`min-h-[40px] rounded-xl px-4 text-[15px] font-semibold transition active:scale-[.97] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)] ${k} ${className}`} />;
}
const Skel = ({ className = "" }: { className?: string }) => <div className={`coder-skel rounded-xl ${className}`} aria-hidden="true" />;
function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-xl bg-[var(--c-sunken)] p-1">
      {options.map((o) => (
        <button key={o.v} role="radio" aria-checked={value === o.v} onClick={() => { haptic("select"); onChange(o.v); }}
          className={`flex-1 rounded-lg px-2 py-1.5 text-[13px] font-semibold transition ${value === o.v ? "bg-[var(--c-card)] text-[var(--c-text)] shadow-sm" : "text-[var(--c-hint)]"}`}>
          {o.l}
        </button>
      ))}
    </div>
  );
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => { haptic("select"); onChange(!on); }}
      className={`relative h-7 w-12 rounded-full transition ${on ? "bg-[var(--c-accent)]" : "bg-[var(--c-line)]"}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "start-[22px]" : "start-0.5"}`} />
    </button>
  );
}
const STATUS_TONE: Record<string, string> = {
  running: "bg-[var(--c-accent-soft)] text-[var(--c-accent-ink)]", waiting: "bg-[var(--c-warn-soft)] text-[var(--c-warn)]", done: "bg-[var(--c-ok-soft)] text-[var(--c-ok)]",
  failed: "bg-[var(--c-danger-soft)] text-[var(--c-danger)]", stopped: "bg-[var(--c-sunken)] text-[var(--c-hint)]", ceiling: "bg-[var(--c-warn-soft)] text-[var(--c-warn)]",
};
function StatusPill({ s, t }: { s: string; t: Str }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_TONE[s] || STATUS_TONE.stopped}`}>
      {s === "running" && <span className="coder-pulse h-1.5 w-1.5 rounded-full bg-current" />}
      {(t as any)[`status_${s}`] || s}
    </span>
  );
}
const EV_ICON: Record<string, string> = { start: "💬", text: "📝", tool: "🔧", confirm: "⚠️", approved: "✅", declined: "❌", auto_allowed: "🟢", auto_denied: "⛔", stall: "🔁", segment: "🧭", done: "🏁", failed: "⚠️", info: "ℹ️" };
function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: React.ReactNode; label: string }) {
  useEffect(() => (open ? bindBack(true, onClose) : undefined), [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/40 coder-fade" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
        className="coder-rise max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-[var(--c-bg)] p-4 pb-[calc(16px+var(--safe-bottom))] shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--c-line)]" />
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- tasks
function PendingCard({ p, t, onDone, cats, lang }: { p: Pending; t: Str; onDone: () => void; cats: Cat[]; lang: Lang }) {
  const label = (p.categories || []).map((c) => cats.find((x) => x.id === c)?.label[lang]).filter(Boolean).join(" · ") || p.reason;
  const [busy, setBusy] = useState<string>("");
  const act = async (answer: "yes" | "all" | "no") => {
    setBusy(answer);
    haptic(answer === "no" ? "warning" : "success");
    try {
      await api("resolve", { runId: p.runId, nonce: p.nonce, answer });
    } finally {
      setBusy("");
      onDone();
    }
  };
  return (
    <Card className="coder-rise overflow-hidden ring-2 ring-[var(--c-warn)]/40" aria-live="polite">
      <div className="flex items-center gap-2 bg-[var(--c-warn-soft)] px-4 py-2 text-[13px] font-bold text-[var(--c-warn)]">⚠️ {t.needsYou}{p.title ? ` · ${p.title}` : ""}</div>
      <div className="space-y-2 p-4">
        <div className="text-[15px] font-bold text-[var(--c-text)]">{label}</div>
        <code className="block truncate text-[12px] text-[var(--c-hint)]" dir="ltr">{p.tool}</code>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--c-sunken)] p-3 text-[12px] leading-5 text-[var(--c-text)]" dir="ltr">{p.summary}</pre>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Btn disabled={!!busy} onClick={() => act("yes")}>✅ {t.approve}</Btn>
          <Btn kind="danger" disabled={!!busy} onClick={() => act("no")}>❌ {t.deny}</Btn>
          <Btn kind="soft" className="col-span-2" disabled={!!busy} onClick={() => act("all")}>✅ {t.approveAll}</Btn>
        </div>
      </div>
    </Card>
  );
}

function Timeline({ runId, live, t }: { runId: string; live: boolean; t: Str }) {
  const [evs, setEvs] = useState<Ev[] | null>(null);
  const last = useRef(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stop = false;
    last.current = 0;
    setEvs(null);
    const pull = async () => {
      try {
        const d = await api<{ events: Ev[] }>("events", { runId, after: last.current });
        if (stop) return;
        if (d.events.length) {
          last.current = d.events[d.events.length - 1].id;
          setEvs((x) => [...(x || []), ...d.events]);
        } else setEvs((x) => x || []);
      } catch {
        setEvs((x) => x || []);
      }
    };
    void pull();
    const id = live ? setInterval(pull, 1500) : null;
    return () => { stop = true; if (id) clearInterval(id); };
  }, [runId, live]);
  useEffect(() => { if (live) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [evs?.length, live]);
  if (!evs) return <div className="space-y-2 py-2"><Skel className="h-4 w-2/3" /><Skel className="h-4 w-1/2" /><Skel className="h-4 w-3/4" /></div>;
  return (
    <ol className="relative space-y-3 border-s-2 border-[var(--c-line)] ps-4" aria-live={live ? "polite" : "off"}>
      {evs.map((e) => (
        <li key={e.id} className="coder-fade relative">
          <span className="absolute -start-[25px] top-0.5 grid h-5 w-5 place-items-center rounded-full bg-[var(--c-bg)] text-[11px]">{EV_ICON[e.kind] || "•"}</span>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--c-hint)]">{(t as any)[`ev_${e.kind}`] || e.kind}</div>
          <div className={`whitespace-pre-wrap break-words text-[13px] leading-6 text-[var(--c-text)] ${e.kind === "text" ? "" : "line-clamp-4"}`} dir="auto">{e.text}</div>
        </li>
      ))}
      {live && <li className="relative"><span className="absolute -start-[23px] top-1 h-3 w-3 coder-pulse rounded-full bg-[var(--c-accent)]" /><div className="text-[12px] text-[var(--c-hint)]">…</div></li>}
      <div ref={end} />
    </ol>
  );
}

function TaskRow({ task, t, onOpen }: { task: Task; t: Str; onOpen: () => void }) {
  return (
    <button onClick={() => { haptic("light"); onOpen(); }} className="flex w-full items-center gap-3 px-4 py-3 text-start transition active:bg-[var(--c-sunken)]">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--c-sunken)] text-[16px]" aria-hidden="true">{task.source === "interactive" ? "💬" : task.source === "event" ? "⚡" : "⏰"}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-[var(--c-text)]" dir="auto">{task.title || "—"}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-[var(--c-hint)]">
          <StatusPill s={task.status} t={t} />
          <span>{(t as any)[`src_${task.source}`]}</span>{task.steps !== undefined && <>·<span>{task.steps} {t.steps}</span></>}·<span>{ago(task.updated_at, t)}</span>
        </div>
      </div>
    </button>
  );
}

function TasksTab({ t, me, lang }: { t: Str; me: Me; lang: Lang }) {
  const [data, setData] = useState<{ tasks: Task[]; pending: Pending[] } | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Task | null>(null);
  const [older, setOlder] = useState<Task[]>([]);
  const load = useCallback(async () => {
    try {
      setData(await api("tasks", { limit: 30 }));
      setErr("");
    } catch (e: any) {
      setErr(e.message);
    }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 3000);
    return () => clearInterval(id);
  }, [load]);
  if (err && !data) return <ErrorBox t={t} msg={err} retry={load} />;
  if (!data) return <div className="space-y-3"><Skel className="h-28" /><Skel className="h-16" /><Skel className="h-16" /><Skel className="h-16" /></div>;
  const all = [...data.tasks, ...older.filter((o) => !data.tasks.some((x) => x.run_id === o.run_id))];
  const live = all.filter((x) => x.status === "running" || x.status === "waiting");
  const hist = all.filter((x) => !(x.status === "running" || x.status === "waiting"));
  return (
    <div className="space-y-5">
      {data.pending.map((p) => <PendingCard key={p.nonce} p={p} t={t} onDone={load} cats={me.prefs.categories} lang={lang} />)}
      {live.length > 0 && (
        <section aria-label={t.live} className="space-y-3">
          <h2 className="px-1 text-[13px] font-bold text-[var(--c-hint)]">{t.live}</h2>
          {live.map((x) => (
            <Card key={x.run_id} className="coder-rise overflow-hidden">
              <TaskRow task={x} t={t} onOpen={() => setOpen(x)} />
              <div className="max-h-64 overflow-y-auto px-4 pb-4"><Timeline runId={x.run_id} live t={t} /></div>
            </Card>
          ))}
        </section>
      )}
      <section aria-label={t.history} className="space-y-2">
        <h2 className="px-1 text-[13px] font-bold text-[var(--c-hint)]">{t.history}</h2>
        {hist.length === 0 && live.length === 0 ? (
          <Card className="p-6 text-center text-[14px] leading-7 text-[var(--c-hint)]"><div className="mb-2 text-3xl">🛰️</div>{t.noTasks}</Card>
        ) : (
          <Card className="divide-y divide-[var(--c-line)] overflow-hidden">{hist.map((x) => <TaskRow key={x.run_id} task={x} t={t} onOpen={() => setOpen(x)} />)}</Card>
        )}
        {all.length >= 30 && (
          <Btn kind="ghost" className="w-full" onClick={async () => { const d = await api<{ tasks: Task[] }>("tasks", { limit: 30, before: all[all.length - 1].started_at }); setOlder((o) => [...o, ...d.tasks]); }}>{t.loadMore}</Btn>
        )}
      </section>
      <Sheet open={!!open} onClose={() => setOpen(null)} label={open?.title || ""}>
        {open && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="text-[17px] font-bold text-[var(--c-text)]" dir="auto">{open.title}</div><div className="mt-1 flex gap-2 text-[12px] text-[var(--c-hint)]"><StatusPill s={open.status} t={t} />{open.steps !== undefined && `${open.steps} ${t.steps}`}</div></div>
              {(open.status === "running" || open.status === "waiting") && <Btn kind="danger" onClick={async () => { haptic("warning"); await api("stop", { runId: open.run_id, slot: open.slot }); setOpen(null); load(); }}>{t.stop}</Btn>}
            </div>
            <Timeline runId={open.run_id} live={open.status === "running" || open.status === "waiting"} t={t} />
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- schedules
const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0];
const dayName = (d: number, lang: Lang) => (lang === "ar" ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])[d];
const DAY_TOKENS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function ScheduleForm({ t, lang, me, initial, onSaved, onCancel }: { t: Str; lang: Lang; me: Me; initial?: Sched | null; onSaved: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"cron" | "event">(initial?.kind || "cron");
  const [title, setTitle] = useState(initial?.title || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [freq, setFreq] = useState<"daily" | "weekdays" | "weekly" | "custom">(initial?.cron ? "custom" : "daily");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<number[]>([1]);
  const [cron, setCron] = useState(initial?.cron || "0 9 * * *");
  const [repo, setRepo] = useState(initial?.repo || me.settings.repo || "");
  const [events, setEvents] = useState<string[]>(initial?.events?.length ? initial.events : ["pull_request"]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const tz = me.settings.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const recurrence = freq === "custom" ? cron : freq === "weekly" ? `weekly ${days.map((d) => DAY_TOKENS[d]).join(",")} ${time}` : `${freq} ${time}`;
  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      if (initial) await api("schedule_update", { id: initial.id, title, prompt, recurrence: kind === "cron" ? recurrence : undefined, events: kind === "event" ? events : undefined, tz });
      else await api("schedule_create", { kind, title, prompt, recurrence, tz, repo: repo || undefined, events });
      haptic("success");
      onSaved();
    } catch (e: any) {
      haptic("error");
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const field = "w-full rounded-xl bg-[var(--c-sunken)] px-3 py-2.5 text-[15px] text-[var(--c-text)] outline-none ring-1 ring-transparent focus:ring-[var(--c-accent)]";
  return (
    <div className="space-y-4">
      <h2 className="text-[18px] font-bold text-[var(--c-text)]">{initial ? t.edit : t.newSchedule}</h2>
      {!initial && <Seg label={t.recurrence} value={kind} onChange={setKind} options={[{ v: "cron", l: `⏰ ${t.kindCron}` }, { v: "event", l: `⚡ ${t.kindEvent}` }]} />}
      <label className="block space-y-1"><span className="text-[13px] font-semibold text-[var(--c-hint)]">{t.title}</span><input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} dir="auto" /></label>
      <label className="block space-y-1"><span className="text-[13px] font-semibold text-[var(--c-hint)]">{t.prompt}</span><textarea className={`${field} min-h-[96px]`} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={4000} dir="auto" /></label>
      {kind === "cron" ? (
        <div className="space-y-3">
          <Seg label={t.recurrence} value={freq} onChange={setFreq} options={[{ v: "daily", l: t.daily }, { v: "weekdays", l: t.weekdays }, { v: "weekly", l: t.weekly }, { v: "custom", l: "cron" }]} />
          {freq === "weekly" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.days}>
              {DAY_KEYS.map((d) => (
                <button key={d} aria-pressed={days.includes(d)} onClick={() => { haptic("select"); setDays((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : [...x, d])); }}
                  className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${days.includes(d) ? "bg-[var(--c-accent)] text-[var(--c-on-accent)]" : "bg-[var(--c-sunken)] text-[var(--c-hint)]"}`}>{dayName(d, lang)}</button>
              ))}
            </div>
          )}
          {freq === "custom" ? <input className={`${field} font-mono`} dir="ltr" value={cron} onChange={(e) => setCron(e.target.value)} aria-label="cron" placeholder="0 9 * * 1-5" />
            : <label className="flex items-center justify-between gap-3"><span className="text-[14px] text-[var(--c-text)]">{t.time}</span><input type="time" className={`${field} w-32`} value={time} onChange={(e) => setTime(e.target.value)} dir="ltr" /></label>}
          <div className="text-[12px] text-[var(--c-hint)]">{t.tz}: <span dir="ltr">{tz}</span></div>
        </div>
      ) : (
        <div className="space-y-3">
          <RepoPicker t={t} value={repo} onChange={setRepo} disabled={!!initial} />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t.events}>
            {me.events.map((e) => (
              <button key={e} aria-pressed={events.includes(e)} onClick={() => { haptic("select"); setEvents((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e])); }}
                className={`rounded-full px-3 py-1.5 font-mono text-[12px] ${events.includes(e) ? "bg-[var(--c-accent)] text-[var(--c-on-accent)]" : "bg-[var(--c-sunken)] text-[var(--c-hint)]"}`} dir="ltr">{e}</button>
            ))}
          </div>
        </div>
      )}
      {err && <div role="alert" className="rounded-xl bg-[var(--c-danger-soft)] p-3 text-[13px] text-[var(--c-danger)]">{err}</div>}
      <div className="grid grid-cols-2 gap-2"><Btn kind="ghost" onClick={onCancel}>{t.cancel}</Btn><Btn disabled={busy || !prompt.trim()} onClick={save}>{initial ? t.save : t.create}</Btn></div>
    </div>
  );
}

function SchedulesTab({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
  const [rows, setRows] = useState<Sched[] | null>(null);
  const [form, setForm] = useState<Sched | "new" | null>(null);
  const [del, setDel] = useState<Sched | null>(null);
  const load = useCallback(async () => setRows((await api<{ schedules: Sched[] }>("schedules")).schedules), []);
  useEffect(() => { void load().catch(() => setRows([])); }, [load]);
  if (!rows) return <div className="space-y-3"><Skel className="h-24" /><Skel className="h-24" /></div>;
  return (
    <div className="space-y-3">
      <Btn className="w-full" onClick={() => { haptic("light"); setForm("new"); }}>＋ {t.newSchedule}</Btn>
      {rows.length === 0 && <Card className="p-6 text-center text-[14px] leading-7 text-[var(--c-hint)]"><div className="mb-2 text-3xl">🗓️</div>{t.noSchedules}</Card>}
      {rows.map((s) => (
        <Card key={s.id} className={`coder-rise p-4 transition ${s.paused ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--c-accent-soft)] text-[18px]" aria-hidden="true">{s.kind === "cron" ? "⏰" : "⚡"}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-bold text-[var(--c-text)]" dir="auto">{s.title}</div>
              <div className="text-[13px] text-[var(--c-hint)]" dir="auto">{s.describe}</div>
              <div className="mt-1 text-[12px] text-[var(--c-hint)]">{s.kind === "cron" && !s.paused ? `${t.next}: ${fmtTime(s.next_run_at, s.tz, lang)}` : ""}{s.last_status ? ` · ${t.last}: ${(t as any)[`status_${s.last_status}`] || s.last_status}` : ""}</div>
            </div>
            <Toggle on={!s.paused} label={s.paused ? t.resume : t.pause} onChange={async (on) => { await api("schedule_pause", { id: s.id, paused: !on }); load(); }} />
          </div>
          <div className="mt-3 flex gap-2">
            <Btn kind="soft" className="flex-1" onClick={async () => { haptic("medium"); await api("schedule_run", { id: s.id }); }}>▶ {t.runNow}</Btn>
            <Btn kind="ghost" onClick={() => setForm(s)}>{t.edit}</Btn>
            <Btn kind="danger" aria-label={t.delete} onClick={() => { haptic("warning"); setDel(s); }}>🗑</Btn>
          </div>
        </Card>
      ))}
      <Sheet open={!!form} onClose={() => setForm(null)} label={t.newSchedule}>
        {form && <ScheduleForm t={t} lang={lang} me={me} initial={form === "new" ? null : form} onCancel={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
      </Sheet>
      <Sheet open={!!del} onClose={() => setDel(null)} label={t.delete}>
        {del && (
          <div className="space-y-4 text-center">
            <div className="text-4xl">🗑️</div>
            <div className="text-[16px] font-bold text-[var(--c-text)]" dir="auto">{del.title}</div>
            <p className="text-[14px] text-[var(--c-hint)]">{t.deleteQ}</p>
            <div className="grid grid-cols-2 gap-2"><Btn kind="ghost" onClick={() => setDel(null)}>{t.cancel}</Btn><Btn kind="danger" onClick={async () => { if (!(await guard(t.delete))) return; await api("schedule_delete", { id: del.id, confirm: true }); haptic("success"); setDel(null); load(); }}>{t.delete}</Btn></div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- connect
function RepoPicker({ t, value, onChange, disabled }: { t: Str; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !repos) void api<{ repos: Repo[] }>("repos").then((d) => setRepos(d.repos)).catch(() => setRepos([])); }, [open, repos]);
  const list = (repos || []).filter((r) => !q || r.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="space-y-2">
      <button disabled={disabled} onClick={() => setOpen((x) => !x)} className="flex w-full items-center justify-between rounded-xl bg-[var(--c-sunken)] px-3 py-2.5 text-start disabled:opacity-60" aria-expanded={open}>
        <span className="text-[13px] font-semibold text-[var(--c-hint)]">{t.repo}</span>
        <span className="truncate font-mono text-[13px] text-[var(--c-text)]" dir="ltr">{value || t.none} ▾</span>
      </button>
      {open && (
        <Card className="coder-fade overflow-hidden">
          <input className="w-full border-b border-[var(--c-line)] bg-transparent px-3 py-2.5 text-[14px] text-[var(--c-text)] outline-none" placeholder={t.searchRepos} value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" autoFocus />
          <div className="max-h-56 overflow-y-auto">
            {!repos ? <div className="space-y-2 p-3"><Skel className="h-8" /><Skel className="h-8" /><Skel className="h-8" /></div>
              : list.map((r) => (
                <button key={r.full_name} onClick={() => { haptic("select"); onChange(r.full_name); setOpen(false); }} className={`flex w-full items-center gap-2 px-3 py-2.5 text-start active:bg-[var(--c-sunken)] ${r.full_name === value ? "bg-[var(--c-accent-soft)]" : ""}`}>
                  <span aria-hidden="true">{r.private ? "🔒" : "📦"}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-mono text-[13px] text-[var(--c-text)]" dir="ltr">{r.full_name}</span>{r.description && <span className="block truncate text-[11px] text-[var(--c-hint)]" dir="auto">{r.description}</span>}</span>
                </button>
              ))}
            {repos && <button onClick={() => { onChange(""); setOpen(false); }} className="w-full px-3 py-2 text-start text-[13px] text-[var(--c-hint)]">{t.none}</button>}
          </div>
        </Card>
      )}
    </div>
  );
}

function GithubTokenCard({ t, me, reload }: { t: Str; me: Me; reload: () => void }) {
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const gh = me.connections.github;
  const signIn = async () => {
    haptic("medium");
    try {
      const { url } = await api<{ url: string }>("github_start", { redirect: `${location.origin}/api/coder/app/github/callback` });
      openExternal(url);
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--c-text)] text-[var(--c-bg)]" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
          </div>
          <div className="min-w-0 flex-1"><div className="text-[16px] font-bold text-[var(--c-text)]">{t.github}</div><div className="text-[13px] text-[var(--c-hint)]" dir="auto">{gh.linked ? `${t.linked}${gh.login ? ` · @${gh.login}` : ""}${gh.source === "owner-env" ? ` · ${t.ownerToken}` : ""}` : t.notLinked}</div></div>
          <span className={`h-2.5 w-2.5 rounded-full ${gh.linked ? "bg-[var(--c-ok)]" : "bg-[var(--c-line)]"}`} aria-hidden="true" />
        </div>
        {gh.source !== "owner-env" && (
          <div className="mt-4 space-y-3">
            {gh.linked ? <Btn kind="danger" className="w-full" onClick={async () => { await api("github_unlink"); haptic("success"); reload(); }}>{t.unlink}</Btn> : (
              <>
                {me.oauth && <Btn className="w-full" onClick={signIn}>{t.signIn}</Btn>}
                <div className="text-[12px] leading-5 text-[var(--c-hint)]">{me.oauth ? t.pasteToken : t.tokenHelp}</div>
                <div className="flex gap-2"><input className="min-w-0 flex-1 rounded-xl bg-[var(--c-sunken)] px-3 py-2.5 font-mono text-[13px] text-[var(--c-text)] outline-none" dir="ltr" type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="token" />
                  <Btn disabled={!token} onClick={async () => { try { await api("github_token", { token }); setToken(""); haptic("success"); reload(); } catch (e: any) { haptic("error"); setMsg(e.message); } }}>{t.link}</Btn></div>
              </>
            )}
            {msg && <div role="alert" className="text-[13px] text-[var(--c-danger)]">{msg}</div>}
          </div>
        )}
      </Card>
      {gh.linked && (
        <Card className="space-y-2 p-4">
          <div className="text-[14px] font-bold text-[var(--c-text)]">{t.pickRepo}</div>
          <RepoPicker t={t} value={me.settings.repo} onChange={async (v) => { await api("settings", { repo: v }); reload(); }} />
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- settings
function LegacySettingsTab({ t, me, lang, reload }: { t: Str; me: Me; lang: Lang; reload: () => void }) {
  const [rules, setRules] = useState<Rule[]>(me.prefs.rules);
  const [scoped, setScoped] = useState({ category: me.prefs.categories[0]?.id || "delete", repo: "", context: "*", policy: "allow" as Rule["policy"] });
  const set = async (b: Record<string, unknown>) => { await api("settings", b); haptic("success"); reload(); };
  const pref = async (category: string, policy: string, repo = "*", context = "*") => setRules((await api<{ rules: Rule[] }>("pref", { category, policy, repo, context })).rules);
  const g = (c: string) => rules.find((r) => r.category === c && r.repo === "*" && r.context === "*")?.policy || "default";
  const field = "rounded-xl bg-[var(--c-sunken)] px-3 py-2 text-[14px] text-[var(--c-text)] outline-none";
  return (
    <div className="space-y-4">
      <Card className="divide-y divide-[var(--c-line)]">
        <div className="space-y-2 p-4"><div className="text-[14px] font-bold text-[var(--c-text)]">{t.section}</div><Seg label={t.section} value={me.settings.mode} onChange={(v) => set({ mode: v })} options={[{ v: "coder", l: t.coder }, { v: "sham", l: t.sham }]} /></div>
        <div className="flex items-center justify-between gap-3 p-4"><div><div className="text-[14px] font-bold text-[var(--c-text)]">{t.thinking}</div><div className="text-[12px] text-[var(--c-hint)]">{t.thinkingHint}</div></div><Toggle on={me.settings.think} label={t.thinking} onChange={(v) => set({ think: v })} /></div>
        <div className="space-y-2 p-4"><div className="text-[14px] font-bold text-[var(--c-text)]">{t.language}</div><Seg label={t.language} value={lang} onChange={(v) => set({ lang: v })} options={[{ v: "ar", l: "العربية" }, { v: "en", l: "English" }]} /></div>
        <div className="flex items-center justify-between gap-3 p-4"><div className="text-[14px] font-bold text-[var(--c-text)]">{t.tz}</div><span className="font-mono text-[13px] text-[var(--c-hint)]" dir="ltr">{me.settings.tz || "—"}</span></div>
      </Card>
      <PlansCard t={t} lang={lang} me={me} />
      <ExtrasCard t={t} me={me} />
      <Card className="p-4">
        <div className="text-[15px] font-bold text-[var(--c-text)]">🔐 {t.perms}</div>
        <p className="mt-1 text-[12px] leading-5 text-[var(--c-hint)]">{t.permsHint}</p>
        <div className="mt-3 space-y-3">
          {me.prefs.categories.map((c) => (
            <div key={c.id} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2"><span className="text-[14px] font-semibold text-[var(--c-text)]">{c.label[lang]}</span><span className="text-[11px] text-[var(--c-hint)]">{c.tierDefault === "run" ? t.runsByDefault : t.asksByDefault}</span></div>
              <Seg label={c.label[lang]} value={g(c.id)} onChange={(v) => pref(c.id, v)} options={[{ v: "default", l: t.p_default }, { v: "ask", l: t.p_ask }, { v: "allow", l: t.p_allow }, { v: "deny", l: t.p_deny }]} />
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-2 border-t border-[var(--c-line)] pt-4">
          <div className="text-[13px] font-bold text-[var(--c-hint)]">{t.rules}</div>
          {rules.filter((r) => r.repo !== "*" || r.context !== "*").map((r) => (
            <div key={`${r.category}|${r.repo}|${r.context}`} className="flex items-center gap-2 rounded-xl bg-[var(--c-sunken)] px-3 py-2 text-[12px] text-[var(--c-text)]">
              <span className="font-semibold">{me.prefs.categories.find((c) => c.id === r.category)?.label[lang]}</span>
              <span className="font-mono text-[var(--c-hint)]" dir="ltr">{r.repo === "*" ? t.anyRepo : r.repo}</span>
              <span className="text-[var(--c-hint)]">{r.context === "*" ? t.anyContext : (t as any)[r.context]}</span>
              <span className="ms-auto font-bold">{(t as any)[`p_${r.policy}`]}</span>
              <button aria-label={t.delete} className="px-1 text-[var(--c-danger)]" onClick={() => pref(r.category, "default", r.repo, r.context)}>✕</button>
            </div>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <select className={field} value={scoped.category} onChange={(e) => setScoped({ ...scoped, category: e.target.value })} aria-label={t.perms}>{me.prefs.categories.map((c) => <option key={c.id} value={c.id}>{c.label[lang]}</option>)}</select>
            <select className={field} value={scoped.policy} onChange={(e) => setScoped({ ...scoped, policy: e.target.value as Rule["policy"] })} aria-label="policy"><option value="ask">{t.p_ask}</option><option value="allow">{t.p_allow}</option><option value="deny">{t.p_deny}</option></select>
            <input className={`${field} font-mono`} dir="ltr" placeholder="owner/repo" value={scoped.repo} onChange={(e) => setScoped({ ...scoped, repo: e.target.value })} aria-label={t.repo} />
            <select className={field} value={scoped.context} onChange={(e) => setScoped({ ...scoped, context: e.target.value })} aria-label="context"><option value="*">{t.anyContext}</option><option value="interactive">{t.interactive}</option><option value="scheduled">{t.scheduled}</option></select>
          </div>
          <Btn kind="soft" className="w-full" onClick={() => pref(scoped.category, scoped.policy, scoped.repo || "*", scoped.context)}>＋ {t.add}</Btn>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- memory
function MemoryTab({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
  const [list, setList] = useState<Mem[] | null>(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Mem | null>(null);
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState<Mem | null>(null);
  const [form, setForm] = useState({ text: "", kind: "preference" as Mem["kind"], repo: "" });
  const load = useCallback(async () => setList((await api<{ memories: Mem[] }>("memories")).memories), []);
  useEffect(() => { void load(); }, [load]);
  const open = (m: Mem | null) => { setForm(m ? { text: m.text, kind: m.kind, repo: m.scope.startsWith("repo:") ? m.scope.slice(5) : "" } : { text: "", kind: "preference", repo: me.settings.repo ? "" : "" }); setEdit(m); setAdding(!m); };
  const save = async () => {
    if (edit) await api("memory_update", { id: edit.id, text: form.text, kind: form.kind, repo: form.repo });
    else await api("memory_add", { text: form.text, kind: form.kind, repo: form.repo || undefined });
    haptic("success"); setEdit(null); setAdding(false); load();
  };
  const field = "w-full rounded-xl bg-[var(--c-sunken)] px-3 py-2.5 text-[14px] text-[var(--c-text)] outline-none focus:ring-2 focus:ring-[var(--c-accent)]";
  const shown = (list || []).filter((m) => !q || m.text.toLowerCase().includes(q.toLowerCase()) || m.scope.includes(q.toLowerCase()));
  const icon = { preference: "💡", fact: "📌", decision: "⚖️" } as const;
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="text-[15px] font-bold text-[var(--c-text)]">🧠 {t.memory}</div>
        <p className="mt-1 text-[12px] leading-5 text-[var(--c-hint)]">{t.memoryHint}</p>
        <div className="mt-3 flex gap-2">
          <input className={field} placeholder={t.searchMemories} aria-label={t.searchMemories} value={q} onChange={(e) => setQ(e.target.value)} />
          <Btn className="shrink-0" onClick={() => { haptic("light"); open(null); }}>＋</Btn>
        </div>
      </Card>
      {list === null ? <><Skel className="h-16" /><Skel className="h-16" /></>
        : !shown.length ? <Card className="p-6 text-center text-[13px] leading-6 text-[var(--c-hint)]">{t.noMemories}</Card>
        : shown.map((m) => (
          <Card key={m.id} className="coder-rise p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--c-accent-soft)] text-[16px]" aria-hidden="true">{icon[m.kind]}</div>
              <div className="min-w-0 flex-1">
                <div className="whitespace-pre-wrap break-words text-[14px] leading-6 text-[var(--c-text)]" dir="auto">{m.text}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[var(--c-hint)]">
                  <span className="font-semibold">{(t as any)[`k_${m.kind}`]}</span><span>·</span>
                  <span className="font-mono" dir="ltr">{m.scope === "global" ? t.global : m.scope.slice(5)}</span><span>·</span>
                  <span>{m.source_run === "app" ? t.fromApp : m.source_run ? t.fromTask : ""} {fmtTime(m.updated_at, me.settings.tz, lang)}</span>
                </div>
              </div>
            </div>
            <div className="mt-3 flex gap-2"><Btn kind="ghost" className="flex-1" onClick={() => open(m)}>{t.edit}</Btn><Btn kind="danger" aria-label={t.delete} onClick={() => { haptic("warning"); setDel(m); }}>🗑️</Btn></div>
          </Card>
        ))}
      <Sheet open={adding || !!edit} onClose={() => { setEdit(null); setAdding(false); }} label={edit ? t.edit : t.addMemory}>
        <div className="space-y-3">
          <div className="text-[17px] font-extrabold text-[var(--c-text)]">{edit ? t.edit : t.addMemory}</div>
          <textarea className={`${field} min-h-24`} dir="auto" maxLength={500} placeholder={t.memoryText} aria-label={t.memoryText} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          <Seg label="kind" value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={[{ v: "preference", l: t.k_preference }, { v: "fact", l: t.k_fact }, { v: "decision", l: t.k_decision }]} />
          <input className={`${field} font-mono`} dir="ltr" placeholder={`owner/repo — ${t.global}`} aria-label={t.repo} value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
          <div className="grid grid-cols-2 gap-2"><Btn kind="ghost" onClick={() => { setEdit(null); setAdding(false); }}>{t.cancel}</Btn><Btn disabled={form.text.trim().length < 4} onClick={save}>{t.save}</Btn></div>
        </div>
      </Sheet>
      <Sheet open={!!del} onClose={() => setDel(null)} label={t.deleteMemoryQ}>
        <div className="space-y-3">
          <div className="text-[17px] font-extrabold text-[var(--c-text)]">{t.deleteMemoryQ}</div>
          <div className="rounded-xl bg-[var(--c-sunken)] p-3 text-[13px] text-[var(--c-text)]" dir="auto">{del?.text}</div>
          <div className="grid grid-cols-2 gap-2"><Btn kind="ghost" onClick={() => setDel(null)}>{t.cancel}</Btn><Btn kind="danger" onClick={async () => { if (!(await guard(t.delete))) return; await api("memory_delete", { id: del!.id }); haptic("success"); setDel(null); load(); }}>{t.delete}</Btn></div>
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- conversation, server, loops (settings extras)
type PlanRow = { id: string; name: { ar: string; en: string }; price_label: string; limits: Record<string, number>; sort: number; active: boolean };
type Usage = { plan: PlanRow; unlimited: boolean; metrics: { metric: string; used: number; limit: number; nextRelief: string | null }[] };
function PlansCard({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
  const [d, setD] = useState<{ plans: PlanRow[]; usage: Usage; labels: Record<string, { ar: string; en: string }> } | null>(null);
  const [err, setErr] = useState("");
  const [assign, setAssign] = useState({ userId: "", planId: "plus", days: "30" });
  const [note, setNote] = useState("");
  // the full meters and every plan come only in the owner's part of the answer (the server decides)
  const load = useCallback(() => api("plans").then((x: any) => setD(x.owner ? { plans: x.owner.plans, usage: x.owner.usage, labels: x.owner.labels } : null)).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  const field = "rounded-xl bg-[var(--c-sunken)] px-3 py-2 text-[14px] text-[var(--c-text)] outline-none";
  if (err) return <Card className="p-4 text-[13px] text-[var(--c-hint)]">{t.plans}: {err}</Card>;
  if (!d) return me.tier === "owner" ? <Skel className="h-40" /> : null;
  return (
    <Card id="plans" className="space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-2"><div className="text-[15px] font-bold text-[var(--c-text)]">📊 {t.usageDetails}</div><span className="rounded-full bg-[var(--c-accent-soft)] px-2.5 py-0.5 text-[12px] font-bold text-[var(--c-accent-ink)]">{d.usage.unlimited ? t.unlimited : d.usage.plan.name[lang]}</span></div>
      <p className="text-[12px] leading-5 text-[var(--c-hint)]">{t.plansHint}</p>
      {d.usage.metrics.map((m) => {
        const pct = m.limit < 0 ? 0 : m.limit === 0 ? 100 : Math.min(100, Math.round((m.used / m.limit) * 100));
        return (
          <div key={m.metric} className="space-y-1">
            <div className="flex justify-between text-[13px]"><span className="text-[var(--c-text)]">{d.labels[m.metric]?.[lang] || m.metric}</span><span className="font-mono text-[var(--c-hint)]" dir="ltr">{m.used}{m.limit >= 0 ? ` / ${m.limit}` : " / ∞"}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--c-sunken)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={d.labels[m.metric]?.[lang] || m.metric}>
              <div className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-[var(--c-danger)]" : pct >= 70 ? "bg-[var(--c-warn)]" : "bg-[var(--c-accent)]"}`} style={{ width: `${pct}%` }} />
            </div>
            {m.nextRelief && m.limit >= 0 && <div className="text-[11px] text-[var(--c-hint)]">{t.nextRelief}: {fmtTime(m.nextRelief, me.settings.tz, lang)}</div>}
          </div>
        );
      })}
      <div className="grid gap-2 pt-1">
        {d.plans.map((p) => (
          <div key={p.id} className={`flex items-center justify-between rounded-xl px-3 py-2 ring-1 ${p.id === d.usage.plan.id ? "ring-[var(--c-accent)]" : "ring-[var(--c-line)]"}`}>
            <span className="text-[14px] font-semibold text-[var(--c-text)]">{p.name[lang]}{!p.active && " ·  ⏸"}</span>
            {me.tier === "owner" ? (
              <input className={`${field} w-28 py-1 text-end`} defaultValue={p.price_label} aria-label={t.priceLabel} onBlur={async (e) => { if (e.target.value !== p.price_label) { await api("plan_update", { id: p.id, price_label: e.target.value }); haptic("success"); void load(); } }} />
            ) : <span className="text-[13px] text-[var(--c-hint)]">{p.price_label}</span>}
          </div>
        ))}
      </div>
      {me.tier === "owner" && (
        <div className="space-y-2 border-t border-[var(--c-line)] pt-3">
          <div className="text-[13px] font-bold text-[var(--c-text)]">{t.assignPlan}</div>
          <div className="grid grid-cols-3 gap-2">
            <input className={`${field} font-mono`} dir="ltr" inputMode="numeric" placeholder={t.userId} aria-label={t.userId} value={assign.userId} onChange={(e) => setAssign({ ...assign, userId: e.target.value })} />
            <select className={field} aria-label={t.currentPlan} value={assign.planId} onChange={(e) => setAssign({ ...assign, planId: e.target.value })}>{d.plans.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}</select>
            <input className={`${field} font-mono`} dir="ltr" inputMode="numeric" aria-label={t.planDays} placeholder={t.planDays} value={assign.days} onChange={(e) => setAssign({ ...assign, days: e.target.value })} />
          </div>
          <Btn kind="soft" className="w-full" onClick={async () => { try { await api("plan_assign", assign); haptic("success"); setNote(t.saved); } catch (e: any) { haptic("error"); setNote(e.message); } }}>{t.assign}</Btn>
          {note && <div className="text-[12px] text-[var(--c-hint)]">{note}</div>}
        </div>
      )}
    </Card>
  );
}

function ExtrasCard({ t, me }: { t: Str; me: Me }) {
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState<string>("");
  const [stalls, setStalls] = useState<{ run_id: string; step: number; pattern: string; level: number; detail: string; created_at?: string }[] | null>(null);
  useEffect(() => { if (me.tier === "owner") void api<{ stalls: any[] }>("stalls").then((d) => setStalls(d.stalls)).catch(() => setStalls([])); }, [me.tier]);
  return (
    <Card className="divide-y divide-[var(--c-line)]">
      <div className="flex items-center justify-between gap-3 p-4">
        <div><div className="text-[14px] font-bold text-[var(--c-text)]">{t.newConversation}</div><div className="text-[12px] text-[var(--c-hint)]">{msg || t.newConversationHint}</div></div>
        <Btn kind="soft" onClick={async () => { await api("new_conversation"); haptic("success"); setMsg(t.started); }}>🆕</Btn>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-3"><div className="text-[14px] font-bold text-[var(--c-text)]">{t.server}</div><Btn kind="ghost" onClick={async () => { const d = await api<Record<string, unknown>>("status"); setStatus(me.tier === "owner" ? JSON.stringify(d, null, 1) : d.available ? `✅ ${t.serviceOk}` : `⚠️ ${t.serviceDown}`); }}>{t.check}</Btn></div>
        {status && <pre className="max-h-40 overflow-auto rounded-xl bg-[var(--c-sunken)] p-3 text-[11px] leading-5 text-[var(--c-text)]" dir="ltr">{status}</pre>}
      </div>
      {me.tier === "owner" && (
        <div className="space-y-2 p-4">
          <div className="text-[14px] font-bold text-[var(--c-text)]">🔁 {t.stalls}</div>
          {stalls === null ? <Skel className="h-10" /> : !stalls.length ? <div className="text-[12px] text-[var(--c-hint)]">{t.noStalls}</div>
            : stalls.slice(0, 15).map((x, i) => <div key={i} className="rounded-xl bg-[var(--c-sunken)] px-3 py-2 font-mono text-[11px] leading-5 text-[var(--c-text)]" dir="ltr">{String(x.created_at || "").slice(0, 16)} {x.run_id} #{x.step} {x.pattern} L{x.level} — {x.detail.slice(0, 140)}</div>)}
        </div>
      )}
    </Card>
  );
}

function ErrorBox({ t, msg, retry }: { t: Str; msg: string; retry: () => void }) {
  return <Card className="p-6 text-center"><div className="mb-2 text-3xl">⚠️</div><div className="text-[15px] font-bold text-[var(--c-text)]">{t.error}</div><div className="mt-1 text-[13px] text-[var(--c-hint)]">{msg}</div><Btn className="mt-4" onClick={retry}>{t.retry}</Btn></Card>;
}

// ---------------------------------------------------------------- model settings (one section: thinking, accuracy, confirmation policy)
function PolicyEditor({ t, me, lang }: { t: Str; me: Me; lang: Lang }) {
  const [rules, setRules] = useState<Rule[]>(me.prefs.rules);
  const [scoped, setScoped] = useState({ category: me.prefs.categories[0]?.id || "delete", repo: "", context: "*", policy: "allow" as Rule["policy"] });
  const pref = async (category: string, policy: string, repo = "*", context = "*") => { setRules((await api<{ rules: Rule[] }>("pref", { category, policy, repo, context })).rules); haptic("success"); };
  const preset = async (p: "careful" | "default" | "auto") => { setRules((await api<{ rules: Rule[] }>("pref_preset", { preset: p })).rules); haptic("success"); };
  const g = (c: string) => rules.find((r) => r.category === c && r.repo === "*" && r.context === "*")?.policy || "default";
  const field = "rounded-xl bg-[var(--c-sunken)] px-3 py-2 text-[14px] text-[var(--c-text)] outline-none";
  return (
    <div className="space-y-3">
      <div className="text-[14px] font-bold text-[var(--c-text)]">🔐 {t.perms}</div>
      <p className="text-[12px] leading-5 text-[var(--c-hint)]">{t.permsHint}</p>
      <div className="space-y-1.5">
        <div className="text-[12px] font-semibold text-[var(--c-hint)]">{t.presets}</div>
        <div className="grid grid-cols-3 gap-1.5">
          <Btn kind="soft" className="px-2 text-[13px]" onClick={() => preset("careful")}>{t.pr_careful}</Btn>
          <Btn kind="ghost" className="px-2 text-[13px]" onClick={() => preset("default")}>{t.pr_default}</Btn>
          <Btn kind="soft" className="px-2 text-[13px]" onClick={() => preset("auto")}>{t.pr_auto}</Btn>
        </div>
      </div>
      {me.prefs.categories.map((c) => (
        <div key={c.id} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2"><span className="text-[14px] font-semibold text-[var(--c-text)]">{c.label[lang]}</span><span className="text-[11px] text-[var(--c-hint)]">{c.tierDefault === "run" ? t.runsByDefault : t.asksByDefault}</span></div>
          <Seg label={c.label[lang]} value={g(c.id)} onChange={(v) => pref(c.id, v)} options={[{ v: "default", l: t.p_default }, { v: "ask", l: t.p_ask }, { v: "allow", l: t.p_allow }, { v: "deny", l: t.p_deny }]} />
        </div>
      ))}
      <div className="space-y-2 border-t border-[var(--c-line)] pt-3">
        <div className="text-[13px] font-bold text-[var(--c-hint)]">{t.rules}</div>
        {rules.filter((r) => r.repo !== "*" || r.context !== "*").map((r) => (
          <div key={`${r.category}|${r.repo}|${r.context}`} className="flex items-center gap-2 rounded-xl bg-[var(--c-sunken)] px-3 py-2 text-[12px] text-[var(--c-text)]">
            <span className="font-semibold">{me.prefs.categories.find((c) => c.id === r.category)?.label[lang]}</span>
            <span className="font-mono text-[var(--c-hint)]" dir="ltr">{r.repo === "*" ? t.anyRepo : r.repo}</span>
            <span className="text-[var(--c-hint)]">{r.context === "*" ? t.anyContext : (t as any)[r.context]}</span>
            <span className="ms-auto font-bold">{(t as any)[`p_${r.policy}`]}</span>
            <button aria-label={t.delete} className="px-1 text-[var(--c-danger)]" onClick={() => pref(r.category, "default", r.repo, r.context)}>✕</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <select className={field} value={scoped.category} onChange={(e) => setScoped({ ...scoped, category: e.target.value })} aria-label={t.perms}>{me.prefs.categories.map((c) => <option key={c.id} value={c.id}>{c.label[lang]}</option>)}</select>
          <select className={field} value={scoped.policy} onChange={(e) => setScoped({ ...scoped, policy: e.target.value as Rule["policy"] })} aria-label="policy"><option value="ask">{t.p_ask}</option><option value="allow">{t.p_allow}</option><option value="deny">{t.p_deny}</option></select>
          <input className={`${field} font-mono`} dir="ltr" placeholder="owner/repo" value={scoped.repo} onChange={(e) => setScoped({ ...scoped, repo: e.target.value })} aria-label={t.repo} />
          <select className={field} value={scoped.context} onChange={(e) => setScoped({ ...scoped, context: e.target.value })} aria-label="context"><option value="*">{t.anyContext}</option><option value="interactive">{t.interactive}</option><option value="scheduled">{t.scheduled}</option></select>
        </div>
        <Btn kind="soft" className="w-full" onClick={() => pref(scoped.category, scoped.policy, scoped.repo || "*", scoped.context)}>＋ {t.add}</Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- model picker (src/lib/coderModels.ts): users see the models the owner switched on
type PubModel = { id: string; name: { ar: string; en: string }; desc: { ar: string; en: string }; price_stars: number | null; selected: boolean };
type OwnModel = PubModel & { visible: boolean; isDefault: boolean; ready: boolean };
function ModelPicker({ t, lang }: { t: Str; lang: Lang }) {
  const [d, setD] = useState<{ models: PubModel[]; owner?: OwnModel[] } | null>(null);
  const load = useCallback(() => api("models").then(setD).catch(() => setD(null)), []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return null;
  const list: PubModel[] = d.owner || d.models;
  const pick = async (id: string) => { await api("settings", { model: id }); haptic("success"); void load(); };
  const field = "w-24 rounded-xl bg-[var(--c-sunken)] px-3 py-1.5 font-mono text-[13px] text-[var(--c-text)] outline-none";
  if (!d.owner && d.models.length < 2) return null;              // one model only: nothing to choose
  return (
    <div className="space-y-2">
      <div><div className="text-[14px] font-bold text-[var(--c-text)]">{d.owner ? t.modelsOwner : t.models}</div><div className="text-[12px] text-[var(--c-hint)]">{t.modelsHint}</div></div>
      {list.map((m) => {
        const o = d.owner?.find((x) => x.id === m.id);
        return (
          <div key={m.id} className={`space-y-2 rounded-xl p-3 ring-1 ${m.selected ? "ring-2 ring-[var(--c-accent)]" : "ring-[var(--c-line)]"}`}>
            <button className="flex w-full items-center gap-2 text-start" onClick={() => pick(m.id)} aria-pressed={m.selected}>
              <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-[var(--c-text)]">{m.name[lang]}{o?.isDefault ? ` · ${t.modelDefault}` : ""}</span><span className="block text-[12px] text-[var(--c-hint)]">{m.desc[lang]}</span></span>
              <span className="text-[12px] font-semibold text-[var(--c-hint)]">{m.price_stars ? `⭐ ${m.price_stars}` : t.modelIncluded}</span>
            </button>
            {o && !o.isDefault && (
              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--c-line)] pt-2 text-[12px] text-[var(--c-hint)]">
                <span className="flex items-center gap-2">{t.modelVisible}<Toggle on={o.visible} label={t.modelVisible} onChange={async (v) => { await api("model_update", { id: o.id, visible: v }); haptic("success"); void load(); }} /></span>
                <label className="flex items-center gap-2">{t.starsPrice}<input className={field} dir="ltr" inputMode="numeric" defaultValue={o.price_stars ?? ""} onBlur={async (e) => { const v = e.target.value.trim(); if (String(o.price_stars ?? "") !== v) { await api("model_update", { id: o.id, price_stars: v ? Number(v) : null }); haptic("success"); void load(); } }} /></label>
                <span>{o.ready ? `✅ ${t.modelReady}` : `⏳ ${t.modelNotReady}`}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({ t, me, lang, reload, openBilling }: { t: Str; me: Me; lang: Lang; reload: () => void; openBilling: () => void }) {
  const [s, setS] = useState(me.settings);
  const [home, setHome] = useState<string>("");
  const [bio, setBioState] = useState<{ on: boolean; ok: boolean | null }>({ on: bioWanted(), ok: null });
  const [convMsg, setConvMsg] = useState("");
  useEffect(() => { void homeStatus().then(setHome); void bioSupported().then((ok) => setBioState((b) => ({ ...b, ok }))); }, []);
  // optimistic: the switch moves at once, the server keeps it, a failure puts it back
  const set = async (b: Partial<Me["settings"]>) => {
    const prev = s;
    setS({ ...s, ...b });
    try { await api("settings", b); haptic("success"); if (b.lang || b.mode) reload(); } catch { setS(prev); haptic("error"); }
  };
  const acc: Accuracy = s.accuracy || "balanced";
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div><div className="text-[16px] font-extrabold text-[var(--c-text)]">🧠 {t.modelSettings}</div><p className="mt-1 text-[12px] leading-5 text-[var(--c-hint)]">{t.modelHint}</p></div>
        <ModelPicker t={t} lang={lang} />
        <div className="flex items-center justify-between gap-3"><div><div className="text-[14px] font-bold text-[var(--c-text)]">{t.thinking}</div><div className="text-[12px] text-[var(--c-hint)]">{t.thinkingHint}</div></div><Toggle on={s.think} label={t.thinking} onChange={(v) => set({ think: v })} /></div>
        <div className="space-y-1.5">
          <div className="text-[14px] font-bold text-[var(--c-text)]">{t.accuracy}</div>
          <Seg label={t.accuracy} value={acc} onChange={(v) => set({ accuracy: v })} options={[{ v: "fast", l: t.acc_fast }, { v: "balanced", l: t.acc_balanced }, { v: "precise", l: t.acc_precise }]} />
          <div className="text-[12px] text-[var(--c-hint)]">{(t as any)[`accHint_${acc}`]}</div>
        </div>
        <div className="border-t border-[var(--c-line)] pt-4"><PolicyEditor t={t} me={me} lang={lang} /></div>
      </Card>

      <button onClick={() => { haptic("light"); openBilling(); }} className="flex w-full items-center gap-3 rounded-2xl bg-[var(--c-card)] p-4 text-start ring-1 ring-[var(--c-line)] active:bg-[var(--c-sunken)]">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--c-accent-soft)] text-[18px]" aria-hidden="true">💎</span>
        <span className="flex-1 text-[15px] font-bold text-[var(--c-text)]">{t.openBilling}</span>
        <span className="text-[var(--c-hint)]" aria-hidden="true">{lang === "ar" ? "‹" : "›"}</span>
      </button>

      <Card className="divide-y divide-[var(--c-line)]">
        <div className="px-4 pt-3 text-[13px] font-bold text-[var(--c-hint)]">{t.general}</div>
        {me.features?.sham && <div className="space-y-2 p-4"><div className="text-[14px] font-bold text-[var(--c-text)]">{t.section}</div><Seg label={t.section} value={s.mode} onChange={(v) => set({ mode: v })} options={[{ v: "coder", l: t.coder }, { v: "sham", l: t.sham }]} /></div>}
        <div className="space-y-2 p-4"><div className="text-[14px] font-bold text-[var(--c-text)]">{t.language}</div><Seg label={t.language} value={lang} onChange={(v) => set({ lang: v })} options={[{ v: "ar", l: "العربية" }, { v: "en", l: "English" }]} /></div>
        <div className="flex items-center justify-between gap-3 p-4"><div className="text-[14px] font-bold text-[var(--c-text)]">{t.tz}</div><span className="font-mono text-[13px] text-[var(--c-hint)]" dir="ltr">{s.tz || "—"}</span></div>
        <div className="flex items-center justify-between gap-3 p-4">
          <div><div className="text-[14px] font-bold text-[var(--c-text)]">{t.newConversation}</div><div className="text-[12px] text-[var(--c-hint)]">{convMsg || t.newConversationHint}</div></div>
          <Btn kind="soft" onClick={async () => { await api("new_conversation"); haptic("success"); setConvMsg(t.started); }}>🆕</Btn>
        </div>
      </Card>

      <Card className="divide-y divide-[var(--c-line)]">
        <div className="px-4 pt-3 text-[13px] font-bold text-[var(--c-hint)]">{t.device}</div>
        {(canAddToHome() || home === "added") && (
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="text-[14px] font-bold text-[var(--c-text)]">📲 {home === "added" ? t.addHomeDone : t.addHome}</div>
            {home !== "added" && <Btn kind="soft" onClick={() => { haptic("light"); addToHome(); }}>＋</Btn>}
          </div>
        )}
        <div className="flex items-center justify-between gap-3 p-4">
          <div><div className="text-[14px] font-bold text-[var(--c-text)]">🔒 {t.biometric}</div><div className="text-[12px] text-[var(--c-hint)]">{bio.ok === false ? t.biometricNo : t.biometricHint}</div></div>
          <Toggle on={bio.on} label={t.biometric} onChange={async (v) => { const ok = await setBio(v); setBioState({ on: v && ok, ok: v ? ok : bio.ok }); haptic(ok ? "success" : "error"); }} />
        </div>
      </Card>

      {me.features?.ownerTools ? (<><div className="px-1 text-[13px] font-bold text-[var(--c-hint)]">{t.ownerTools}</div><ExtrasCard t={t} me={me} /></>) : <ExtrasCard t={t} me={me} />}
    </div>
  );
}

// ---------------------------------------------------------------- owner control panel (owner only: the server answers 403 to anyone else)
function PanelTab({ lang }: { lang: Lang }) {
  const ar = lang === "ar";
  const [d, setD] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [fail, setFail] = useState("");
  const load = useCallback(async () => {
    setFail("");
    try {
      const [p, m, b] = await Promise.all([api("panel"), api("models"), api("billing")]);
      setD(p);
      setModels(m.owner?.models || m.owner || []);
      setPlans(b.owner?.plans || []);
    } catch (e: any) {
      setFail(String(e?.message || e));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const act = async (action: string) => {
    setBusy(action);
    try {
      const r = await api("panel_action", { action });
      setMsg(r.message);
      haptic(r.ok ? "success" : "error");
      await load();
    } catch (e: any) {
      setMsg(String(e?.message || e));
    }
    setBusy("");
  };
  const trt = (iso?: string) => (iso ? new Intl.DateTimeFormat(ar ? "ar-SY" : "en-GB", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) + " TRT" : "—");
  if (fail) return <ErrorBox t={STR[lang]} msg={fail} retry={load} />;
  if (!d) return <div className="space-y-3"><Skel className="h-28" /><Skel className="h-16" /><Skel className="h-16" /></div>;
  const t = d.training, g = t?.gpu, nova = t?.nova;
  return (
    <div className="coder-rise space-y-4">
      {d.steps?.length > 0 && (
        <Section header={ar ? "خطوات يدوية باقية" : "Manual steps left"}>
          {d.steps.map((s: any) => <Cell key={s.id} multiline before="📝">{ar ? s.ar : s.en}</Cell>)}
        </Section>
      )}
      <Section header={ar ? "التدريب" : "Training"} footer={t?.logsReadable === false ? (ar ? "سجلات المراقب تحتاج PANEL_GITHUB_TOKEN على الموقع." : "Monitor logs need PANEL_GITHUB_TOKEN on the site.") : undefined}>
        {g && <Cell multiline subtitle={`${ar ? "إعادة الضبط" : "Reset"}: ${trt(g.nextReset)} · ${g.rule}`}>
          {`GPU: ${ar ? "شام" : "Sham"} ${g.shamHours}h · Nova 1 ${g.novaHours}h · ${ar ? "الباقي" : "left"} ~${g.leftHours}h / ${g.quotaHours}h`}
        </Cell>}
        <Cell multiline subtitle={nova?.request?.not_before ? `${ar ? "يبدأ بعد" : "Starts after"} ${trt(nova.request.not_before)}` : undefined}
          after={<TgButton size="s" mode="bezeled" loading={busy.startsWith("nova")} onClick={() => act(nova?.paused ? "nova_resume" : "nova_pause")}>{nova?.paused ? "▶️" : "⏸"}</TgButton>}>
          {`Nova 1: ${nova?.request?.enabled ? (nova.paused ? (ar ? "موقوف (لا جلسات جديدة)" : "paused (no new sessions)") : (ar ? "مفعّل" : "on")) : (ar ? "غير مفعّل" : "off")}`}
        </Cell>
        <Cell multiline subtitle={t?.monitor ? `${trt(t.monitor.at)} · ${t.monitor.conclusion}` : "—"}
          after={<TgButton size="s" mode="bezeled" loading={busy === "monitor_run"} onClick={() => act("monitor_run")}>🛰</TgButton>}>
          {ar ? "مراقب كاكل" : "Kaggle monitor"}
        </Cell>
        {(t?.monitorLines || []).filter((l: string) => l.startsWith("دفتر") || l.startsWith("Nova 1:")).slice(0, 8).map((l: string, i: number) => <Cell key={i} multiline>{l}</Cell>)}
        {(t?.inspectorLines || []).filter((l: string) => l.startsWith("status:") || l.startsWith("=====")).slice(0, 10).map((l: string, i: number) => <Cell key={"i" + i} multiline>{l}</Cell>)}
        {msg && <Cell multiline before="ℹ️">{msg}</Cell>}
      </Section>
      <Section header={ar ? "النماذج" : "Models"} footer={ar ? "الظهور للمستخدمين وسعر النجوم (فارغ = ضمن الخطة)." : "Visible to users and Stars price (empty = included)."}>
        {models.map((m: any) => (
          <Cell key={m.id} multiline subtitle={m.id}
            after={<Switch checked={Boolean(m.visible)} onChange={async (e) => { await api("model_update", { id: m.id, visible: e.currentTarget.checked }); haptic("success"); void load(); }} />}>
            {(m.name && (ar ? m.name.ar : m.name.en)) || m.id}
          </Cell>
        ))}
        {models.map((m: any) => (
          <Input key={"p" + m.id} header={`${(m.name && (ar ? m.name.ar : m.name.en)) || m.id} ⭐`} type="number" defaultValue={m.price_stars ?? ""}
            onBlur={async (e) => { await api("model_update", { id: m.id, price_stars: e.currentTarget.value }); haptic("success"); }} />
        ))}
      </Section>
      <Section header={ar ? "الخطط (نجوم)" : "Plans (Stars)"}>
        {plans.map((p: any) => (
          <Input key={p.id} header={`${(p.name && (ar ? p.name.ar : p.name.en)) || p.id} ⭐`} type="number" defaultValue={p.price_stars ?? ""}
            onBlur={async (e) => { await api("plan_update", { ...p, price_stars: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) }); haptic("success"); }} />
        ))}
      </Section>
      <Section header={ar ? "المستخدمون والاشتراكات" : "Users & subscriptions"}>
        <Cell after={String(d.users?.chats ?? 0)}>{ar ? "المستخدمون" : "Users"}</Cell>
        <Cell after={String(d.users?.active7d ?? 0)}>{ar ? "نشطون خلال 7 أيام" : "Active in 7 days"}</Cell>
        {Object.entries(d.users?.subscriptions || {}).map(([k, v]) => <Cell key={k} after={String(v)}>{`${ar ? "اشتراك" : "Plan"} ${k}`}</Cell>)}
      </Section>
      <Section header={ar ? "الخوادم والبدائل" : "Servers & fallbacks"}>
        <Cell after={d.health?.studio?.ok ? "✅" : "❌"}>{`Studio (${d.health?.studio?.count ?? 0})`}</Cell>
        <Cell after={d.health?.nova1Studio ? "✅" : "—"}>Nova 1 Studio</Cell>
        <Cell after={d.health?.oracle ? "✅" : "—"}>Oracle</Cell>
        {(d.health?.sandbox || []).filter((b: any) => b.configured).map((b: any) => <Cell key={b.id} after={b.ok ? "✅" : "⏳"}>{b.id}</Cell>)}
        {(d.health?.search || []).map((s: any) => <Cell key={s.name} after={s.ok ? "✅" : "⏳"}>{s.name}</Cell>)}
      </Section>
      <div className="flex justify-center"><TgButton size="m" mode="plain" onClick={() => { haptic("light"); void load(); }}>🔄 {ar ? "تحديث" : "Refresh"}</TgButton></div>
    </div>
  );
}

// ---------------------------------------------------------------- billing (its own section: plan, usage as one bar, Stars upgrade, owner pricing)
type PubPlan = { id: string; name: { ar: string; en: string }; price_label: string; price_stars: number | null; days: number; current: boolean; tier: number };
type PubUsage = { plan: { id: string; name: { ar: string; en: string } }; unlimited: boolean; percent: number; level: "ok" | "high" | "full"; renewsAt: string | null; periodEnd: string | null };
function BillingTab({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
  const [d, setD] = useState<{ usage: PubUsage; plans: PubPlan[]; owner?: { plans: (PlanRow & { price_stars?: number | null; days?: number })[] } } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(() => api("billing").then(setD).catch((e) => setErr(e.message)), []);
  useEffect(() => { void load(); }, [load]);
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
    } catch (e: any) {
      haptic("error");
      setNote(e.message);
    } finally {
      setBusy("");
    }
  };
  if (err) return <ErrorBox t={t} msg={err} retry={() => { setErr(""); void load(); }} />;
  if (!d) return <div className="space-y-3"><Skel className="h-36" /><Skel className="h-20" /><Skel className="h-20" /></div>;
  const u = d.usage;
  const tone = u.level === "full" ? "bg-[var(--c-danger)]" : u.level === "high" ? "bg-[var(--c-warn)]" : "bg-[var(--c-accent)]";
  const field = "rounded-xl bg-[var(--c-sunken)] px-3 py-2 text-[14px] text-[var(--c-text)] outline-none";
  return (
    <div className="space-y-4">
      <Card className="coder-rise overflow-hidden">
        <div className="bg-gradient-to-br from-[var(--c-accent)] to-[var(--c-accent2)] p-5 text-white">
          <div className="text-[12px] font-semibold opacity-90">{t.currentPlan}</div>
          <div className="mt-1 text-[26px] font-extrabold leading-tight">{u.unlimited ? t.unlimited : u.plan.name[lang]}</div>
          {u.periodEnd && <div className="mt-1 text-[12px] opacity-90">{t.planUntil}: {fmtTime(u.periodEnd, me.settings.tz, lang)}</div>}
        </div>
        {!u.unlimited && (
          <div className="space-y-2 p-4">
            <div className="flex items-baseline justify-between text-[13px]"><span className="font-semibold text-[var(--c-text)]">{t.usedThisWeek}</span><span className="font-mono text-[var(--c-hint)]" dir="ltr">{u.percent}%</span></div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--c-sunken)]" role="progressbar" aria-valuenow={u.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t.usedThisWeek}>
              <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${Math.max(2, u.percent)}%` }} />
            </div>
            <div className="text-[12px] text-[var(--c-hint)]">{u.level === "full" ? t.usageFull : u.level === "high" ? t.usageHigh : t.usageOk}{u.renewsAt ? ` · ${t.renewsAt}: ${fmtTime(u.renewsAt, me.settings.tz, lang)}` : ""}</div>
          </div>
        )}
      </Card>
      <p className="px-1 text-[12px] leading-5 text-[var(--c-hint)]">{t.billingHint}</p>
      <div className="space-y-2">
        {d.plans.map((p) => (
          <Card key={p.id} className={`flex items-center gap-3 p-4 ${p.current ? "ring-2 ring-[var(--c-accent)]" : ""}`}>
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-[var(--c-accent-soft)] text-[20px]" aria-hidden="true">{p.tier === 0 ? "🌱" : p.tier === 1 ? "⚡" : "🚀"}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="text-[16px] font-bold text-[var(--c-text)]">{p.name[lang]}</span>{p.current && <span className="rounded-full bg-[var(--c-accent-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--c-accent-ink)]">{t.currentBadge}</span>}</div>
              <div className="text-[12px] text-[var(--c-hint)]">{p.price_stars ? `⭐ ${p.price_stars} ${t.stars} · ${p.days} ${t.perDays}` : p.id === "free" ? "0" : t.notForSale}</div>
            </div>
            {p.price_stars && p.id !== "free" ? <Btn disabled={!!busy} onClick={() => buy(p)}>{busy === p.id ? "…" : `${p.current ? "＋" : t.upgrade} ⭐`}</Btn> : null}
          </Card>
        ))}
      </div>
      {note && <div role="status" className="rounded-xl bg-[var(--c-sunken)] p-3 text-center text-[13px] text-[var(--c-text)]">{note}</div>}
      {d.owner && (
        <Card className="space-y-3 p-4">
          <div className="text-[15px] font-bold text-[var(--c-text)]">🏷️ {t.ownerPricing}</div>
          {d.owner.plans.map((p) => (
            <div key={p.id} className="space-y-2 rounded-xl p-3 ring-1 ring-[var(--c-line)]">
              <div className="flex items-center justify-between"><span className="text-[14px] font-bold text-[var(--c-text)]">{p.name[lang]} <span className="font-mono text-[11px] text-[var(--c-hint)]" dir="ltr">{p.id}</span></span>
                <Toggle on={p.active} label={t.active} onChange={async (v) => { await api("plan_update", { id: p.id, active: v }); haptic("success"); void load(); }} /></div>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1"><span className="text-[11px] text-[var(--c-hint)]">{t.starsPrice}</span><input className={`${field} w-full font-mono`} dir="ltr" inputMode="numeric" defaultValue={p.price_stars ?? ""} onBlur={async (e) => { const v = e.target.value.trim(); if (String(p.price_stars ?? "") !== v) { await api("plan_update", { id: p.id, price_stars: v ? Number(v) : null }); haptic("success"); void load(); } }} /></label>
                <label className="space-y-1"><span className="text-[11px] text-[var(--c-hint)]">{t.periodDays}</span><input className={`${field} w-full font-mono`} dir="ltr" inputMode="numeric" defaultValue={p.days ?? 30} onBlur={async (e) => { if (String(p.days ?? 30) !== e.target.value) { await api("plan_update", { id: p.id, days: Number(e.target.value) || 30 }); haptic("success"); void load(); } }} /></label>
                <label className="space-y-1"><span className="text-[11px] text-[var(--c-hint)]">{t.priceLabel}</span><input className={`${field} w-full`} defaultValue={p.price_label} onBlur={async (e) => { if (e.target.value !== p.price_label) { await api("plan_update", { id: p.id, price_label: e.target.value }); haptic("success"); void load(); } }} /></label>
              </div>
            </div>
          ))}
        </Card>
      )}
      {d.owner && <PlansCard t={t} lang={lang} me={me} />}
    </div>
  );
}

// ---------------------------------------------------------------- connectors (ready-made list, one-tap OAuth; MCP by URL under "advanced")
type ConnView = { id: string; name: string; desc: { ar: string; en: string }; color: string; status: "connected" | "available" | "soon"; label?: string; source?: "owner-env" | "user-link" };
type McpView = { id: string; url: string; label: string };
const BRAND_SVG: Record<string, string> = {
  github: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
  vercel: "M8 1.5 15.5 14.5H.5Z",
};
function BrandIcon({ c }: { c: ConnView }) {
  const path = BRAND_SVG[c.id];
  const glyph: Record<string, string> = { google_drive: "▲", gmail: "✉", notion: "N", supabase: "⚡", slack: "#", discord: "◉" };
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm" style={{ background: c.color }} aria-hidden="true">
      {path ? <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d={path} /></svg> : <span className="text-[18px] font-black">{glyph[c.id] || c.name[0]}</span>}
    </div>
  );
}
function ConnectorsTab({ t, me, lang, reload }: { t: Str; me: Me; lang: Lang; reload: () => void }) {
  const [list, setList] = useState<{ connectors: ConnView[]; mcp: McpView[] } | null>(null);
  const [waiting, setWaiting] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [adv, setAdv] = useState(false);
  const [mcp, setMcp] = useState({ url: "", token: "", label: "" });
  const load = useCallback(async () => { try { setList(await api("connectors")); } catch (e: any) { setMsg(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  // coming back from the service's page: refresh (focus / visibility), and poll a little while a sign-in is open
  useEffect(() => {
    const on = () => document.visibilityState === "visible" && void load().then(reload);
    document.addEventListener("visibilitychange", on);
    window.addEventListener("focus", on);
    const id = waiting ? setInterval(() => void load(), 3000) : null;
    const stop = waiting ? setTimeout(() => setWaiting(""), 180000) : null;
    return () => { document.removeEventListener("visibilitychange", on); window.removeEventListener("focus", on); if (id) clearInterval(id); if (stop) clearTimeout(stop); };
  }, [load, reload, waiting]);
  useEffect(() => { if (waiting && list?.connectors.find((c) => c.id === waiting)?.status === "connected") { haptic("success"); setWaiting(""); reload(); } }, [list, waiting, reload]);
  const start = async (c: ConnView) => {
    haptic("medium");
    setMsg("");
    setBusy(c.id);
    try {
      const { url } = await api<{ url: string }>("connector_start", { id: c.id });
      setWaiting(c.id);
      openExternal(url);
    } catch (e: any) {
      haptic("error");
      setMsg(e.message === "soon" ? t.soon : e.message);
    } finally {
      setBusy("");
    }
  };
  const stop = async (c: ConnView) => {
    if (!(await guard(`${t.disconnect} ${c.name}`))) return;
    setBusy(c.id);
    try { await api("connector_disconnect", { id: c.id }); haptic("success"); await load(); reload(); } finally { setBusy(""); }
  };
  const field = "w-full rounded-xl bg-[var(--c-sunken)] px-3 py-2.5 text-[14px] text-[var(--c-text)] outline-none";
  if (!list) return <div className="space-y-3"><Skel className="h-16" /><Skel className="h-16" /><Skel className="h-16" /><Skel className="h-16" /></div>;
  const gh = list.connectors.find((c) => c.id === "github");
  return (
    <div className="space-y-4">
      <p className="px-1 text-[13px] leading-6 text-[var(--c-hint)]">{t.connectorsHint}</p>
      <Card className="divide-y divide-[var(--c-line)] overflow-hidden">
        {list.connectors.map((c) => (
          <div key={c.id} className="flex items-center gap-3 p-4">
            <BrandIcon c={c} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><span className="text-[15px] font-bold text-[var(--c-text)]">{c.name}</span>{c.status === "connected" && <span className="h-2 w-2 rounded-full bg-[var(--c-ok)]" aria-label={t.connected} />}</div>
              <div className="truncate text-[12px] text-[var(--c-hint)]" dir="auto">{c.status === "connected" ? `${t.connected}${c.label ? ` · ${c.label}` : ""}${c.source === "owner-env" ? ` · ${t.ownerAccount}` : ""}` : waiting === c.id ? t.connecting : c.desc[lang]}</div>
            </div>
            {c.status === "connected" ? (c.source === "owner-env" ? null : <Btn kind="ghost" disabled={busy === c.id} onClick={() => stop(c)}>{t.disconnect}</Btn>)
              : c.status === "soon" ? <span className="rounded-full bg-[var(--c-sunken)] px-3 py-1.5 text-[12px] font-bold text-[var(--c-hint)]">{t.soon}</span>
              : <Btn disabled={busy === c.id} onClick={() => start(c)}>{busy === c.id ? "…" : t.connect}</Btn>}
          </div>
        ))}
      </Card>
      {msg && <div role="alert" className="rounded-xl bg-[var(--c-danger-soft)] p-3 text-[13px] text-[var(--c-danger)]">{msg}</div>}
      {gh?.status === "connected" && (
        <Card className="space-y-2 p-4">
          <div className="text-[14px] font-bold text-[var(--c-text)]">{t.pickRepo}</div>
          <RepoPicker t={t} value={me.settings.repo} onChange={async (v) => { await api("settings", { repo: v }); reload(); }} />
        </Card>
      )}
      <button onClick={() => setAdv((x) => !x)} aria-expanded={adv} className="flex w-full items-center justify-between rounded-2xl px-1 py-2 text-[13px] font-bold text-[var(--c-hint)]">
        <span>⚙️ {t.advanced}</span><span aria-hidden="true">{adv ? "▴" : "▾"}</span>
      </button>
      {adv && (
        <div className="space-y-3">
          <Card className="space-y-3 p-4">
            <div className="text-[15px] font-bold text-[var(--c-text)]">🧩 {t.mcpTitle}</div>
            <p className="text-[12px] leading-5 text-[var(--c-hint)]">{t.mcpHint}</p>
            {list.mcp.map((m) => (
              <div key={m.id} className="flex items-center gap-2 rounded-xl bg-[var(--c-sunken)] px-3 py-2">
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[var(--c-text)]">{m.label}</span><span className="block truncate font-mono text-[11px] text-[var(--c-hint)]" dir="ltr">{m.url} · {m.id}</span></span>
                <button aria-label={t.delete} className="px-2 text-[var(--c-danger)]" onClick={async () => { if (!(await guard(t.delete))) return; await api("mcp_remove", { id: m.id }); haptic("success"); void load(); }}>✕</button>
              </div>
            ))}
            <input className={`${field} font-mono`} dir="ltr" placeholder={t.mcpUrl} aria-label={t.mcpUrl} value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={field} placeholder={t.mcpName} aria-label={t.mcpName} value={mcp.label} onChange={(e) => setMcp({ ...mcp, label: e.target.value })} />
              <input className={`${field} font-mono`} dir="ltr" type="password" autoComplete="off" placeholder={t.mcpToken} aria-label={t.mcpToken} value={mcp.token} onChange={(e) => setMcp({ ...mcp, token: e.target.value })} />
            </div>
            <Btn kind="soft" className="w-full" disabled={!/^https:\/\//.test(mcp.url)} onClick={async () => { try { await api("mcp_add", mcp); setMcp({ url: "", token: "", label: "" }); haptic("success"); void load(); } catch (e: any) { haptic("error"); setMsg(e.message); } }}>＋ {t.add2}</Btn>
          </Card>
          {gh?.source !== "owner-env" && (<><div className="px-1 text-[13px] font-bold text-[var(--c-hint)]">{t.tokenFallback}</div><GithubTokenCard t={t} me={me} reload={() => { reload(); void load(); }} /></>)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shell
const TABS: { id: Exclude<Tab, "billing">; icon: string; key: keyof Str }[] = [
  { id: "tasks", icon: "M4 6h16M4 12h10M4 18h7", key: "tabTasks" },
  { id: "schedules", icon: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", key: "tabSchedules" },
  { id: "memory", icon: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0", key: "tabMemory" },
  { id: "connect", icon: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1", key: "tabConnectors" },
  { id: "settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z", key: "tabSettings" },
];
const tabFrom = (want: string): Tab => (want === "panel" ? "panel" : want === "plans" || want === "billing" ? "billing" : want === "connectors" ? "connect" : (TABS.some((x) => x.id === want) ? want : "tasks") as Tab);

/** The classic screens (custom-drawn), kept as they were; open with ?ui=classic. */
function ClassicCoderApp() {
  // Telegram Mini Apps cannot be rendered on the server (the launch data lives in the client): render after mount, like the official template
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "base">("base");
  const [tab, setTab] = useState<Tab>("tasks");
  const [prevTab, setPrevTab] = useState<Tab>("tasks");
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState("");
  const [dark, setDark] = useState(false);
  const [android, setAndroid] = useState(false);
  const reload = useCallback(async () => {
    try {
      setMe(await api<Me>("me"));
      setErr("");
    } catch (e: any) {
      setErr(e.status === 401 ? "__tg" : e.message);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void startTma().then((lp) => {
      if (!alive) return;
      setPlatform(isApple() ? "ios" : "base");
      setAndroid(isAndroid());
      const want = new URLSearchParams(window.location.search).get("tab") || lp.startParam || "";
      setTab(tabFrom(want));
      setMounted(true);
      void reload();
    });
    const apply = () => setDark(isDark() || (!getLaunch().inTelegram && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches)));
    apply();
    // theme changes from Telegram: the SDK keeps --tg-theme-* up to date; re-read the dark flag when the page repaints / regains focus
    const id = setInterval(apply, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [reload]);
  useEffect(() => {
    // Material touch feedback on Android: an ink ripple from the touch point on every button / link (telegram-ui's "base" platform look)
    if (!android) return;
    const onDown = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.("button, a, [role=button]") as HTMLElement | null;
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2;
      const ink = document.createElement("span");
      ink.className = "coder-ink";
      ink.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.style.overflow = "hidden";
      el.appendChild(ink);
      setTimeout(() => ink.remove(), 550);
    };
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => document.removeEventListener("pointerdown", onDown);
  }, [android]);
  useEffect(() => {
    // the user's own time zone, once, for schedules
    if (me && !me.settings.tz) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) void api("settings", { tz }).then(reload);
    }
  }, [me, reload]);
  const openBilling = useCallback(() => { setPrevTab((p) => (tab === "billing" ? p : tab)); setTab("billing"); }, [tab]);
  const closeBilling = useCallback(() => setTab(prevTab === "billing" ? "tasks" : prevTab), [prevTab]);
  useEffect(() => (tab === "billing" ? bindBack(true, closeBilling) : undefined), [tab, closeBilling]);
  const openPanel = useCallback(() => { setPrevTab((p) => (tab === "panel" || tab === "billing" ? p : tab)); setTab("panel"); }, [tab]);
  useEffect(() => (tab === "panel" ? bindBack(true, closeBilling) : undefined), [tab, closeBilling]);
  const code = getLaunch().languageCode;
  const lang: Lang = me?.settings.lang || (code === "ar" || !code ? "ar" : "en");
  const t = STR[lang];
  const vars = useMemo(() => ({
    "--c-bg": `var(--tg-theme-secondary-bg-color, ${dark ? "#0d1117" : "#f3f5f9"})`,
    "--c-card": `var(--tg-theme-section-bg-color, var(--tg-theme-bg-color, ${dark ? "#161b26" : "#ffffff"}))`,
    "--c-sunken": dark ? "rgba(255,255,255,.06)" : "rgba(15,23,42,.05)",
    "--c-line": dark ? "rgba(255,255,255,.10)" : "rgba(15,23,42,.09)",
    "--c-text": `var(--tg-theme-text-color, ${dark ? "#e8ecf4" : "#0f172a"})`,
    "--c-hint": `var(--tg-theme-hint-color, ${dark ? "#8b94a7" : "#64748b"})`,
    "--c-accent": dark ? "#34d6a6" : "#0f9f78",
    "--c-accent2": dark ? "#6c8cff" : "#3f5bd8",
    "--c-on-accent": dark ? "#062018" : "#ffffff",
    "--c-accent-soft": dark ? "rgba(52,214,166,.14)" : "rgba(15,159,120,.10)",
    "--c-accent-ink": dark ? "#6ff0c8" : "#0a7a5c",
    "--c-ok": dark ? "#4ade80" : "#15803d", "--c-ok-soft": dark ? "rgba(74,222,128,.14)" : "rgba(21,128,61,.10)",
    "--c-warn": dark ? "#fbbf24" : "#b45309", "--c-warn-soft": dark ? "rgba(251,191,36,.14)" : "rgba(180,83,9,.10)",
    "--c-danger": dark ? "#f87171" : "#c2410c", "--c-danger-soft": dark ? "rgba(248,113,113,.14)" : "rgba(194,65,12,.09)",
    // safe areas: device insets (notch, Android navigation bar) + Telegram's own header in full screen
    "--safe-top": "calc(max(var(--tg-viewport-safe-area-inset-top, 0px), env(safe-area-inset-top, 0px)) + var(--tg-viewport-content-safe-area-inset-top, 0px))",
    "--safe-bottom": "calc(max(var(--tg-viewport-safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px)) + var(--tg-viewport-content-safe-area-inset-bottom, 0px))",
    "--safe-left": "max(var(--tg-viewport-safe-area-inset-left, 0px), env(safe-area-inset-left, 0px))",
    "--safe-right": "max(var(--tg-viewport-safe-area-inset-right, 0px), env(safe-area-inset-right, 0px))",
  }) as React.CSSProperties, [dark]);
  if (!mounted) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--tg-theme-secondary-bg-color, #f3f5f9)" }}><Mark size={44} /></div>;
  return (
    <AppRoot appearance={dark ? "dark" : "light"} platform={platform}>
      <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} style={vars} data-platform={android ? "android" : platform} data-theme={dark ? "dark" : "light"} className="min-h-screen bg-[var(--c-bg)] font-sans text-[var(--c-text)] antialiased ps-[var(--safe-left)] pe-[var(--safe-right)]">
        <style>{`
          .coder-skel{background:linear-gradient(90deg,var(--c-sunken) 0%,var(--c-line) 50%,var(--c-sunken) 100%);background-size:200% 100%;animation:cs 1.3s ease-in-out infinite}
          @keyframes cs{0%{background-position:200% 0}100%{background-position:-200% 0}}
          .coder-rise{animation:cr .32s cubic-bezier(.2,.8,.2,1) both}@keyframes cr{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
          .coder-fade{animation:cf .25s ease both}@keyframes cf{from{opacity:0}to{opacity:1}}
          .coder-pulse{animation:cp 1.2s ease-in-out infinite}@keyframes cp{0%,100%{opacity:1}50%{opacity:.3}}
          @media (prefers-reduced-motion:reduce){.coder-skel,.coder-rise,.coder-fade,.coder-pulse{animation:none!important}}
          [data-platform=android]{font-family:Roboto,"Noto Sans Arabic","Noto Sans",system-ui,sans-serif;letter-spacing:.01em}
          [data-platform=android] header{backdrop-filter:none;background:var(--tg-theme-header-bg-color,var(--c-bg));box-shadow:0 1px 3px rgba(0,0,0,.18);border-bottom:0}
          [data-platform=android] nav[aria-label=tabs]{backdrop-filter:none;background:var(--tg-theme-bottom-bar-bg-color,var(--c-card));box-shadow:0 -1px 3px rgba(0,0,0,.14);border-top:0}
          [data-platform=android] button{text-transform:none;-webkit-tap-highlight-color:transparent}
          [data-platform=ios]{font-family:-apple-system,"SF Pro Text","SF Arabic",system-ui,sans-serif}
          .coder-ink{position:absolute;border-radius:50%;pointer-events:none;background:currentColor;opacity:.18;transform:scale(0);animation:ci .55s ease-out forwards}
          @keyframes ci{to{transform:scale(1);opacity:0}}
        `}</style>
        <header className="sticky top-0 z-30 border-b border-[var(--c-line)] bg-[var(--c-bg)]/85 px-4 pb-3 pt-[calc(12px+var(--safe-top))] backdrop-blur">
          <div className="flex items-center gap-3">
            <Mark />
            <div className="min-w-0 flex-1"><div className="text-[17px] font-extrabold leading-tight tracking-tight">{tab === "billing" ? t.billing : t.brand}</div><div className="truncate text-[12px] text-[var(--c-hint)]">{t.tagline}</div></div>
            {me?.tier === "owner" && tab !== "panel" && (
              <button onClick={() => { haptic("light"); openPanel(); }} className="rounded-full bg-[var(--c-sunken)] px-3 py-1.5 text-[12px] font-bold text-[var(--c-text)]" aria-label={lang === "ar" ? "لوحة المالك" : "Owner panel"}>🎛</button>
            )}
            {me && tab !== "billing" && (
              <button onClick={() => { haptic("light"); openBilling(); }} className="rounded-full bg-[var(--c-accent-soft)] px-3 py-1.5 text-[12px] font-bold text-[var(--c-accent-ink)]" aria-label={t.openBilling}>
                💎 {me.tier === "owner" ? t.tierOwner : t.tabBilling}
              </button>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-xl px-4 pt-4" style={{ paddingBottom: "calc(96px + var(--safe-bottom))" }}>
          {err === "__tg" ? <Card className="p-6 text-center text-[14px] leading-7 text-[var(--c-hint)]"><Mark size={48} /><p className="mt-3">{t.openInTelegram}</p></Card>
            : err ? <ErrorBox t={t} msg={err} retry={reload} />
            : !me ? <div className="space-y-3"><Skel className="h-28" /><Skel className="h-16" /><Skel className="h-16" /></div>
            : tab === "tasks" ? <TasksTab t={t} me={me} lang={lang} />
            : tab === "schedules" ? <SchedulesTab t={t} lang={lang} me={me} />
            : tab === "memory" ? <MemoryTab t={t} lang={lang} me={me} />
            : tab === "connect" ? <ConnectorsTab t={t} me={me} lang={lang} reload={reload} />
            : tab === "billing" ? <BillingTab t={t} lang={lang} me={me} />
            : tab === "panel" && me.tier === "owner" ? <PanelTab lang={lang} />
            : <SettingsTab key={lang} t={t} me={me} lang={lang} reload={reload} openBilling={openBilling} />}
        </main>
        {tab !== "billing" && (
          <nav aria-label="tabs" className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--c-line)] bg-[var(--c-card)]/95 backdrop-blur" style={{ paddingBottom: "var(--safe-bottom)" }}>
            <div className="mx-auto grid max-w-xl grid-cols-5">
              {TABS.map((x) => (
                <button key={x.id} aria-current={tab === x.id ? "page" : undefined} onClick={() => { haptic("select"); setTab(x.id); }}
                  className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${tab === x.id ? "text-[var(--c-accent)]" : "text-[var(--c-hint)]"}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={x.icon} /></svg>
                  {t[x.key] as string}
                  <span className={`h-1 w-5 rounded-full transition ${tab === x.id ? "bg-[var(--c-accent)]" : "bg-transparent"}`} />
                </button>
              ))}
            </div>
          </nav>
        )}
      </div>
    </AppRoot>
  );
}

/**
 * The Mini App: Nova's redesign (./_nova/NovaApp.tsx: Mira's structure in Fadaa's colours) by default; ?ui=native keeps the telegram-ui
 * screens (./_native/NativeApp.tsx) and ?ui=classic the classic ones. Nothing is removed.
 */
export default function CoderApp() {
  const [ui, setUi] = useState<"nova" | "native" | "classic" | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("ui");
    setUi(q === "classic" ? "classic" : q === "native" ? "native" : "nova");
  }, []);
  if (!ui) return <div style={{ minHeight: "100vh", background: "var(--tg-theme-secondary-bg-color, #f3f5f9)" }} />;
  return ui === "classic" ? <ClassicCoderApp /> : ui === "native" ? <NativeApp /> : <NovaApp />;
}
