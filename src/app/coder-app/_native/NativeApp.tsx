"use client";
// The coder Mini App drawn with @telegram-apps/telegram-ui's own components (List, Section, Cell, Tabbar, Modal, Switch, Select,
// SegmentedControl, Timeline, Banner, Progress…), so Telegram's native look comes from the library itself: Material on Android and
// everywhere else ("base"), iOS on iPhone / macOS — with Telegram's theme colours and dark/light. Same server API (/api/coder/app, every
// call signed with initData and checked on the server) and the same sections as the classic screens in ../page.tsx (still there: ?ui=classic).
// Main sections in the bottom Tabbar; Billing and the owner panel are sub-pages with Telegram's BackButton; forms use Telegram's MainButton.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppRoot, Avatar, Badge, Banner, Button, ButtonCell, Caption, Cell, Chip, IconContainer, Input, List, Modal, Navigation, Placeholder,
  Progress, Radio, Section, SegmentedControl, Select, Spinner, Switch, Tabbar, Text, Textarea, Timeline, Title,
} from "@telegram-apps/telegram-ui";
import { STR, type Lang, type Str } from "../i18n";
import {
  addToHome, bindBack, bindMain, bioSupported, bioWanted, canAddToHome, getLaunch, guard, haptic, homeStatus, isApple, isDark, openExternal,
  payInvoice, rawInitData, setBio, startTma, closeApp,
} from "../_tma/sdk";

type Tab = "tasks" | "terminal" | "schedules" | "connect" | "memory" | "settings";
type Page = "billing" | "panel" | null;
type Mem = { id: number; scope: string; kind: "preference" | "fact" | "decision"; text: string; source_run: string | null; created_at: string; updated_at: string };
type Task = { run_id: string; slot: string; source: "interactive" | "scheduled" | "event"; schedule_id: string | null; title: string; status: string; steps?: number; started_at: string; updated_at: string; finished_at: string | null };
type Ev = { id: number; run_id: string; kind: string; text: string; created_at: string };
type Pending = { runId: string; nonce: string; reason: string; summary: string; tool: string; categories: string[]; title: string; slot: string; at: number | null };
type Rule = { category: string; repo: string; context: string; policy: "ask" | "allow" | "deny" };
type Cat = { id: string; label: { ar: string; en: string }; tierDefault: "ask" | "run" };
type Accuracy = "fast" | "balanced" | "precise";
type Me = { tier: "owner" | "user"; features?: { sham: boolean; ownerTools: boolean; terminal?: boolean }; settings: { mode: "coder" | "sham"; think: boolean; accuracy?: Accuracy; lang: Lang; tz: string; repo: string; model?: string }; connections: { github: { linked: boolean; login?: string; source?: string } }; oauth: boolean; prefs: { rules: Rule[]; categories: Cat[] }; events: string[] };
type Sched = { id: string; title: string; prompt: string; kind: "cron" | "event"; cron: string | null; tz: string; repo: string | null; events: string[]; paused: boolean; next_run_at: string | null; last_run_at: string | null; last_status: string | null; hook_id: number | null; describe: string };
type Repo = { full_name: string; private: boolean; default_branch: string; pushed_at: string | null; description: string };
type ConnView = { id: string; name: string; desc: { ar: string; en: string }; color: string; status: "connected" | "available" | "soon"; label?: string; source?: "owner-env" | "user-link" };
type McpView = { id: string; url: string; label: string };
type PubModel = { id: string; name: { ar: string; en: string }; desc: { ar: string; en: string }; price_stars: number | null; selected: boolean };
type PubPlan = { id: string; name: { ar: string; en: string }; price_label: string; price_stars: number | null; days: number; current: boolean; tier: number };
type PubUsage = { plan: { id: string; name: { ar: string; en: string } }; unlimited: boolean; percent: number; level: "ok" | "high" | "full"; renewsAt: string | null; periodEnd: string | null };
type OwnPlan = { id: string; name: { ar: string; en: string }; price_label: string; price_stars?: number | null; days?: number; active: boolean };

async function api<T = any>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/coder/app", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() }, body: JSON.stringify({ op, ...body }), cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { status: r.status });
  return d as T;
}
const toDate = (iso: string) => new Date(iso.replace(" ", "T").replace(/\+00$/, "Z"));
function ago(iso: string | null, t: Str): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - toDate(iso).getTime()) / 1000);
  if (s < 45) return t.justNow;
  if (s < 3600) return `${Math.round(s / 60)}${t.min}`;
  if (s < 86400) return `${Math.round(s / 3600)}${t.hr}`;
  return `${Math.round(s / 86400)}${t.day}`;
}
function fmtTime(iso: string | null, tz: string, lang: Lang): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SY" : "en-GB", { timeZone: tz || "Asia/Damascus", weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(toDate(iso));
  } catch {
    return iso.slice(0, 16);
  }
}
const tx = (t: Str, k: string) => ((t as any)[k] as string) || k;
const STATUS_MODE: Record<string, "primary" | "critical" | "secondary" | "gray"> = { running: "primary", waiting: "critical", done: "secondary", failed: "critical", stopped: "gray", ceiling: "gray", limited: "gray" };
const StatusBadge = ({ s, t }: { s: string; t: Str }) => <Badge type="number" mode={STATUS_MODE[s] || "gray"}>{tx(t, `status_${s}`)}</Badge>;
const Emoji = ({ c }: { c: string }) => <IconContainer><span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">{c}</span></IconContainer>;
const Loading = () => <div style={{ display: "grid", placeItems: "center", padding: 32 }}><Spinner size="m" /></div>;
function Fail({ t, msg, retry }: { t: Str; msg: string; retry: () => void }) {
  return <Placeholder header={t.error} description={msg} action={<Button size="m" onClick={retry}>{t.retry}</Button>}><span style={{ fontSize: 44 }}>⚠️</span></Placeholder>;
}

/** A bottom sheet (telegram-ui Modal) that also closes from Telegram's BackButton. */
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => (open ? bindBack(true, onClose) : undefined), [open, onClose]);
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} header={<Modal.Header>{title}</Modal.Header>}>
      <div style={{ paddingBottom: "calc(16px + var(--safe-bottom, 0px))", maxHeight: "80vh", overflowY: "auto" }}>{children}</div>
    </Modal>
  );
}
/** Telegram's MainButton for a form's primary action while the form is open (an in-page button stays as a fallback outside Telegram). */
function useMain(on: boolean, text: string, cb: () => void, enabled = true, loading = false) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => (on ? bindMain(text, () => ref.current(), { enabled, loading }) : undefined), [on, text, enabled, loading]);
}
const inTg = () => getLaunch().inTelegram;

// ---------------------------------------------------------------- tasks
function EventsTimeline({ runId, live, t, last = 0 }: { runId: string; live: boolean; t: Str; last?: number }) {
  const [evs, setEvs] = useState<Ev[] | null>(null);
  const after = useRef(0);
  useEffect(() => {
    let stop = false;
    after.current = 0;
    setEvs(null);
    const pull = async () => {
      try {
        const d = await api<{ events: Ev[] }>("events", { runId, after: after.current });
        if (stop) return;
        if (d.events.length) {
          after.current = d.events[d.events.length - 1].id;
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
  if (!evs) return <Loading />;
  const shown = last ? evs.slice(-last) : evs;
  if (!shown.length) return <Cell multiline><Caption>{live ? "…" : "—"}</Caption></Cell>;
  return (
    <div style={{ padding: "8px 16px" }}>
      <Timeline active={live ? shown.length - 1 : shown.length}>
        {shown.map((e) => (
          <Timeline.Item key={e.id} header={tx(t, `ev_${e.kind}`)}>
            <span dir="auto" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.kind === "text" ? e.text : e.text.slice(0, 400)}</span>
          </Timeline.Item>
        ))}
      </Timeline>
    </div>
  );
}

function PendingBanner({ p, t, cats, lang, onDone }: { p: Pending; t: Str; cats: Cat[]; lang: Lang; onDone: () => void }) {
  const [busy, setBusy] = useState("");
  const label = (p.categories || []).map((c) => cats.find((x) => x.id === c)?.label[lang]).filter(Boolean).join(" · ") || p.reason;
  const act = async (answer: "yes" | "all" | "no") => {
    setBusy(answer);
    haptic(answer === "no" ? "warning" : "success");
    try { await api("resolve", { runId: p.runId, nonce: p.nonce, answer }); } finally { setBusy(""); onDone(); }
  };
  return (
    <Banner type="section" before={<Emoji c="⚠️" />} header={`${t.needsYou}${p.title ? ` · ${p.title}` : ""}`} subheader={label} description={p.summary.slice(0, 300)}>
      <Button size="s" loading={busy === "yes"} disabled={!!busy} onClick={() => act("yes")}>{t.approve}</Button>
      <Button size="s" mode="bezeled" loading={busy === "all"} disabled={!!busy} onClick={() => act("all")}>{t.approveAll}</Button>
      <Button size="s" mode="plain" loading={busy === "no"} disabled={!!busy} onClick={() => act("no")}>{t.deny}</Button>
    </Banner>
  );
}

const srcIcon = (s: Task["source"]) => (s === "interactive" ? "💬" : s === "event" ? "⚡" : "⏰");
function TasksTab({ t, me, lang }: { t: Str; me: Me; lang: Lang }) {
  const [data, setData] = useState<{ tasks: Task[]; pending: Pending[] } | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Task | null>(null);
  const [older, setOlder] = useState<Task[]>([]);
  const load = useCallback(async () => {
    try { setData(await api("tasks", { limit: 30 })); setErr(""); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 3000);
    return () => clearInterval(id);
  }, [load]);
  const close = useCallback(() => setOpen(null), []);
  if (err && !data) return <Fail t={t} msg={err} retry={load} />;
  if (!data) return <Loading />;
  const all = [...data.tasks, ...older.filter((o) => !data.tasks.some((x) => x.run_id === o.run_id))];
  const isLive = (x: Task) => x.status === "running" || x.status === "waiting";
  const live = all.filter(isLive);
  const hist = all.filter((x) => !isLive(x));
  const sub = (x: Task) => `${tx(t, `src_${x.source}`)}${x.steps !== undefined ? ` · ${x.steps} ${t.steps}` : ""} · ${ago(x.updated_at, t)}`;
  return (
    <List>
      {data.pending.map((p) => <PendingBanner key={p.nonce} p={p} t={t} cats={me.prefs.categories} lang={lang} onDone={load} />)}
      {live.map((x) => (
        <Section key={x.run_id} header={t.live}>
          <Cell before={<Emoji c={srcIcon(x.source)} />} subtitle={sub(x)} after={<Spinner size="s" />} onClick={() => { haptic("light"); setOpen(x); }}>
            <span dir="auto">{x.title || "—"}</span>
          </Cell>
          <EventsTimeline runId={x.run_id} live t={t} last={5} />
        </Section>
      ))}
      <Section header={t.history}>
        {hist.length === 0 && live.length === 0 ? (
          <Placeholder description={t.noTasks}><span style={{ fontSize: 44 }}>🛰️</span></Placeholder>
        ) : hist.map((x) => (
          <Cell key={x.run_id} before={<Emoji c={srcIcon(x.source)} />} subtitle={sub(x)} after={<StatusBadge s={x.status} t={t} />} onClick={() => { haptic("light"); setOpen(x); }}>
            <span dir="auto">{x.title || "—"}</span>
          </Cell>
        ))}
        {all.length >= 30 && <ButtonCell onClick={async () => { const d = await api<{ tasks: Task[] }>("tasks", { limit: 30, before: all[all.length - 1].started_at }); setOlder((o) => [...o, ...d.tasks]); }}>{t.loadMore}</ButtonCell>}
      </Section>
      <Sheet open={!!open} onClose={close} title={open?.title?.slice(0, 60)}>
        {open && (
          <List>
            <Section>
              <Cell multiline subtitle={sub(open)} after={<StatusBadge s={open.status} t={t} />}><span dir="auto">{open.title}</span></Cell>
              {isLive(open) && <ButtonCell mode="destructive" onClick={async () => { haptic("warning"); await api("stop", { runId: open.run_id, slot: open.slot }); setOpen(null); void load(); }}>⏹ {t.stop}</ButtonCell>}
            </Section>
            <Section><EventsTimeline runId={open.run_id} live={isLive(open)} t={t} /></Section>
          </List>
        )}
      </Sheet>
    </List>
  );
}

// ---------------------------------------------------------------- conversations (threads): like Claude / ChatGPT — each chat on its own
type Thread = { id: string; title: string; legacy: boolean; messages_count?: number; created_at: string; updated_at: string };
type ThreadTask = { run_id: string; title: string; status: string; started_at: string; finished_at: string | null; events: Ev[] };
function ThreadView({ id, t, onChanged, onClose }: { id: string; t: Str; onChanged: () => void; onClose: () => void }) {
  const [d, setD] = useState<{ thread: Thread; current: boolean; tasks: ThreadTask[] } | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => { try { setD(await api("thread", { id })); setErr(""); } catch (e: any) { setErr(e.message); } }, [id]);
  useEffect(() => {
    void load();
    const iv = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    return () => clearInterval(iv);
  }, [load]);
  if (err && !d) return <Fail t={t} msg={err} retry={load} />;
  if (!d) return <Loading />;
  const live = (s: string) => s === "running" || s === "waiting";
  const cont = async () => {
    setBusy("open");
    haptic("medium");
    try { await api("thread_open", { id }); onChanged(); closeApp(); } finally { setBusy(""); }
  };
  return (
    <List>
      <Section footer={t.continueHint}>
        <ButtonCell before="💬" disabled={!!busy} onClick={cont}>{d.current ? `${t.continueHere} · ${t.currentChat}` : t.continueHere}</ButtonCell>
      </Section>
      {!d.tasks.length && <Placeholder description={t.noMessages}><span style={{ fontSize: 40 }}>💬</span></Placeholder>}
      {d.tasks.map((k) => (
        <Section key={k.run_id} header={ago(k.started_at, t)}>
          {k.events.map((e) => (
            <Cell key={e.id} multiline before={<Emoji c={e.kind === "start" ? "🧑" : e.kind === "failed" ? "⚠️" : e.kind === "confirm" ? "❓" : "✨"} />}
              subtitle={e.kind === "start" ? t.you : tx(t, `ev_${e.kind}`)}>
              <span dir="auto" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{e.kind === "text" || e.kind === "start" ? e.text.slice(0, 4000) : e.text.slice(0, 400)}</span>
            </Cell>
          ))}
          <Cell after={live(k.status) ? <Spinner size="s" /> : <StatusBadge s={k.status} t={t} />}>
            <Caption>{live(k.status) ? tx(t, `status_${k.status}`) : ""}</Caption>
          </Cell>
          {live(k.status) && <ButtonCell mode="destructive" onClick={async () => { haptic("warning"); await api("stop", { runId: k.run_id, slot: "" }); void load(); }}>⏹ {t.stop}</ButtonCell>}
        </Section>
      ))}
      <Section>
        {name === null ? <ButtonCell before="✏️" onClick={() => setName(d.thread.title)}>{t.rename}</ButtonCell> : (
          <>
            <Input header={t.rename} value={name} maxLength={80} dir="auto" onChange={(e) => setName(e.target.value)} />
            <ButtonCell disabled={!name.trim()} onClick={async () => { await api("thread_rename", { id, title: name }); haptic("success"); setName(null); void load(); onChanged(); }}>{t.save}</ButtonCell>
          </>
        )}
        <ButtonCell mode="destructive" before="🗑" onClick={async () => { if (!(await guard(t.hideChat))) return; await api("thread_delete", { id }); haptic("success"); onChanged(); onClose(); }}>{t.hideChat}</ButtonCell>
      </Section>
    </List>
  );
}

function ThreadsTab({ t, me, lang }: { t: Str; me: Me; lang: Lang }) {
  const [data, setData] = useState<{ threads: Thread[]; current: string | null; currentEmpty: boolean; live: Task[]; runs: Task[]; pending: Pending[] } | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<Thread | null>(null);
  const [run, setRun] = useState<Task | null>(null);
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { setData(await api("threads", { limit: 40 })); setErr(""); } catch (e: any) { setErr(e.message); }
  }, []);
  useEffect(() => {
    void load();
    const iv = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    return () => clearInterval(iv);
  }, [load]);
  const close = useCallback(() => setOpen(null), []);
  const closeRun = useCallback(() => setRun(null), []);
  if (err && !data) return <Fail t={t} msg={err} retry={load} />;
  if (!data) return <Loading />;
  const fresh = async () => {
    haptic("medium");
    await api("thread_new");
    setNote(t.newChatStarted);
    void load();
  };
  const isLive = (x: Task) => x.status === "running" || x.status === "waiting";
  return (
    <List>
      {data.pending.map((p) => <PendingBanner key={p.nonce} p={p} t={t} cats={me.prefs.categories} lang={lang} onDone={load} />)}
      <Section>
        <ButtonCell before={<span aria-hidden="true" style={{ fontSize: 20 }}>＋</span>} onClick={fresh}>{t.newChat}</ButtonCell>
        {note && <Cell multiline><Caption>{note}</Caption></Cell>}
      </Section>
      {data.live.map((x) => (
        <Section key={x.run_id} header={t.live}>
          <Cell before={<Emoji c={srcIcon(x.source)} />} subtitle={ago(x.updated_at, t)} after={<Spinner size="s" />}
            onClick={() => { haptic("light"); const th = data.threads.find((h) => h.id === (x as any).thread_id); if (th) setOpen(th); else setRun(x); }}>
            <span dir="auto">{x.title || "—"}</span>
          </Cell>
          <EventsTimeline runId={x.run_id} live t={t} last={4} />
        </Section>
      ))}
      <Section header={t.chats}>
        {data.threads.length === 0 ? <Placeholder description={t.noChats}><span style={{ fontSize: 44 }}>💬</span></Placeholder>
          : data.threads.map((h) => (
            <Cell key={h.id} before={<Emoji c={h.legacy ? "🗂️" : "💬"} />} subtitle={ago(h.updated_at, t)}
              titleBadge={h.id === data.current ? <Badge type="number" mode="primary">{t.currentChat}</Badge> : undefined}
              after={<Navigation />} onClick={() => { haptic("light"); setOpen(h); }}>
              <span dir="auto">{h.title || t.untitled}</span>
            </Cell>
          ))}
      </Section>
      {data.runs.length > 0 && (
        <Section header={t.scheduledRuns}>
          {data.runs.map((x) => (
            <Cell key={x.run_id} before={<Emoji c={srcIcon(x.source)} />} subtitle={`${tx(t, `src_${x.source}`)} · ${ago(x.updated_at, t)}`}
              after={isLive(x) ? <Spinner size="s" /> : <StatusBadge s={x.status} t={t} />} onClick={() => { haptic("light"); setRun(x); }}>
              <span dir="auto">{x.title || "—"}</span>
            </Cell>
          ))}
        </Section>
      )}
      <Sheet open={!!open} onClose={close} title={(open?.title || t.untitled).slice(0, 60)}>
        {open && <ThreadView id={open.id} t={t} onChanged={load} onClose={close} />}
      </Sheet>
      <Sheet open={!!run} onClose={closeRun} title={run?.title?.slice(0, 60)}>
        {run && (
          <List>
            <Section>
              <Cell multiline after={<StatusBadge s={run.status} t={t} />}><span dir="auto">{run.title}</span></Cell>
              {isLive(run) && <ButtonCell mode="destructive" onClick={async () => { haptic("warning"); await api("stop", { runId: run.run_id, slot: run.slot }); setRun(null); void load(); }}>⏹ {t.stop}</ButtonCell>}
            </Section>
            <Section><EventsTimeline runId={run.run_id} live={isLive(run)} t={t} /></Section>
          </List>
        )}
      </Sheet>
    </List>
  );
}
void TasksTab;                                                       // the per-request list (kept; the Chats tab replaced it)

// ---------------------------------------------------------------- schedules
const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_TOKENS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dayName = (d: number, lang: Lang) => (lang === "ar" ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])[d];

function useRepos(on: boolean) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  useEffect(() => { if (on && !repos) void api<{ repos: Repo[] }>("repos").then((d) => setRepos(d.repos)).catch(() => setRepos([])); }, [on, repos]);
  return repos;
}
function RepoSelect({ t, value, onChange, disabled }: { t: Str; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const repos = useRepos(true);
  return (
    <Select header={t.repo} value={value} disabled={disabled || !repos} onChange={(e) => { haptic("select"); onChange(e.target.value); }} dir="ltr">
      <option value="">{t.none}</option>
      {value && !(repos || []).some((r) => r.full_name === value) && <option value={value}>{value}</option>}
      {(repos || []).map((r) => <option key={r.full_name} value={r.full_name}>{r.private ? "🔒 " : ""}{r.full_name}</option>)}
    </Select>
  );
}

function ScheduleForm({ t, lang, me, initial, onSaved }: { t: Str; lang: Lang; me: Me; initial: Sched | null; onSaved: () => void }) {
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
  const tz = me.settings.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Damascus";
  const recurrence = freq === "custom" ? cron : freq === "weekly" ? `weekly ${days.map((d) => DAY_TOKENS[d]).join(",")} ${time}` : `${freq} ${time}`;
  const save = async () => {
    if (busy || !prompt.trim()) return;
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
  useMain(true, initial ? t.save : t.create, save, Boolean(prompt.trim()), busy);
  return (
    <List>
      {!initial && (
        <Section>
          <SegmentedControl>
            <SegmentedControl.Item selected={kind === "cron"} onClick={() => setKind("cron")}>⏰ {t.kindCron}</SegmentedControl.Item>
            <SegmentedControl.Item selected={kind === "event"} onClick={() => setKind("event")}>⚡ {t.kindEvent}</SegmentedControl.Item>
          </SegmentedControl>
        </Section>
      )}
      <Section>
        <Input header={t.title} value={title} maxLength={120} dir="auto" onChange={(e) => setTitle(e.target.value)} />
        <Textarea header={t.prompt} value={prompt} maxLength={4000} dir="auto" onChange={(e) => setPrompt(e.target.value)} />
      </Section>
      {kind === "cron" ? (
        <Section header={t.recurrence} footer={`${t.tz}: ${tz}`}>
          <SegmentedControl>
            {(["daily", "weekdays", "weekly", "custom"] as const).map((f) => <SegmentedControl.Item key={f} selected={freq === f} onClick={() => setFreq(f)}>{f === "custom" ? "cron" : tx(t, f)}</SegmentedControl.Item>)}
          </SegmentedControl>
          {freq === "weekly" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 16px" }} role="group" aria-label={t.days}>
              {DAY_KEYS.map((d) => (
                <Chip key={d} mode={days.includes(d) ? "elevated" : "outline"} aria-pressed={days.includes(d)} onClick={() => { haptic("select"); setDays((x) => (x.includes(d) ? (x.length > 1 ? x.filter((y) => y !== d) : x) : [...x, d])); }}
                  after={days.includes(d) ? "✓" : undefined}>{dayName(d, lang)}</Chip>
              ))}
            </div>
          )}
          {freq === "custom" ? <Input header="cron" dir="ltr" value={cron} placeholder="0 9 * * 1-5" onChange={(e) => setCron(e.target.value)} />
            : <Input header={t.time} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />}
        </Section>
      ) : (
        <Section header={t.events}>
          <RepoSelect t={t} value={repo} onChange={setRepo} disabled={!!initial} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "10px 16px" }} dir="ltr">
            {me.events.map((e) => (
              <Chip key={e} mode={events.includes(e) ? "elevated" : "outline"} after={events.includes(e) ? "✓" : undefined} onClick={() => { haptic("select"); setEvents((x) => (x.includes(e) ? x.filter((y) => y !== e) : [...x, e])); }}>{e}</Chip>
            ))}
          </div>
        </Section>
      )}
      {err && <Section><Cell multiline before="⚠️">{err}</Cell></Section>}
      {!inTg() && <div style={{ padding: 16 }}><Button size="l" stretched loading={busy} disabled={!prompt.trim()} onClick={save}>{initial ? t.save : t.create}</Button></div>}
    </List>
  );
}

function SchedulesTab({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
  const [rows, setRows] = useState<Sched[] | null>(null);
  const [form, setForm] = useState<Sched | "new" | null>(null);
  const [menu, setMenu] = useState<Sched | null>(null);
  const [del, setDel] = useState<Sched | null>(null);
  const load = useCallback(async () => setRows((await api<{ schedules: Sched[] }>("schedules")).schedules), []);
  useEffect(() => { void load().catch(() => setRows([])); }, [load]);
  const closeForm = useCallback(() => setForm(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeDel = useCallback(() => setDel(null), []);
  if (!rows) return <Loading />;
  return (
    <List>
      <Section header={t.schedules}>
        <ButtonCell before={<span aria-hidden="true">＋</span>} onClick={() => { haptic("light"); setForm("new"); }}>{t.newSchedule}</ButtonCell>
        {rows.length === 0 && <Placeholder description={t.noSchedules}><span style={{ fontSize: 44 }}>🗓️</span></Placeholder>}
        {rows.map((s) => (
          <Cell key={s.id} multiline before={<Emoji c={s.kind === "cron" ? "⏰" : "⚡"} />} subtitle={<span dir="auto">{s.describe}</span>}
            description={`${s.kind === "cron" && !s.paused ? `${t.next}: ${fmtTime(s.next_run_at, s.tz, lang)}` : s.paused ? t.pause : ""}${s.last_status ? ` · ${t.last}: ${tx(t, `status_${s.last_status}`)}` : ""}`}
            after={<Switch checked={!s.paused} aria-label={s.paused ? t.resume : t.pause} onClick={(e) => e.stopPropagation()} onChange={async (e) => { haptic("select"); await api("schedule_pause", { id: s.id, paused: !e.currentTarget.checked }); void load(); }} />}
            onClick={() => { haptic("light"); setMenu(s); }}>
            <span dir="auto">{s.title}</span>
          </Cell>
        ))}
      </Section>
      <Sheet open={!!menu} onClose={closeMenu} title={menu?.title}>
        {menu && (
          <List>
            <Section>
              <ButtonCell before="▶" onClick={async () => { haptic("medium"); await api("schedule_run", { id: menu.id }); setMenu(null); }}>{t.runNow}</ButtonCell>
              <ButtonCell before="✏️" onClick={() => { const s = menu; setMenu(null); setForm(s); }}>{t.edit}</ButtonCell>
              <ButtonCell mode="destructive" before="🗑" onClick={() => { haptic("warning"); const s = menu; setMenu(null); setDel(s); }}>{t.delete}</ButtonCell>
            </Section>
          </List>
        )}
      </Sheet>
      <Sheet open={!!form} onClose={closeForm} title={form && form !== "new" ? t.edit : t.newSchedule}>
        {form && <ScheduleForm t={t} lang={lang} me={me} initial={form === "new" ? null : form} onSaved={() => { setForm(null); void load(); }} />}
      </Sheet>
      <Sheet open={!!del} onClose={closeDel} title={t.delete}>
        {del && (
          <Placeholder header={del.title} description={t.deleteQ} action={
            <div style={{ display: "flex", gap: 8 }}>
              <Button mode="gray" onClick={closeDel}>{t.cancel}</Button>
              <Button mode="filled" onClick={async () => { if (!(await guard(t.delete))) return; await api("schedule_delete", { id: del.id, confirm: true }); haptic("success"); setDel(null); void load(); }}>{t.delete}</Button>
            </div>
          }><span style={{ fontSize: 44 }}>🗑️</span></Placeholder>
        )}
      </Sheet>
    </List>
  );
}

// ---------------------------------------------------------------- memory
function MemoryForm({ t, initial, onDone }: { t: Str; initial: Mem | null; onDone: () => void }) {
  const [form, setForm] = useState({ text: initial?.text || "", kind: (initial?.kind || "preference") as Mem["kind"], repo: initial?.scope.startsWith("repo:") ? initial.scope.slice(5) : "" });
  const [busy, setBusy] = useState(false);
  const ok = form.text.trim().length >= 4;
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      if (initial) await api("memory_update", { id: initial.id, text: form.text, kind: form.kind, repo: form.repo });
      else await api("memory_add", { text: form.text, kind: form.kind, repo: form.repo || undefined });
      haptic("success");
      onDone();
    } finally {
      setBusy(false);
    }
  };
  useMain(true, t.save, save, ok, busy);
  return (
    <List>
      <Section>
        <Textarea header={t.memoryText} value={form.text} maxLength={500} dir="auto" onChange={(e) => setForm({ ...form, text: e.target.value })} />
        <SegmentedControl>
          {(["preference", "fact", "decision"] as const).map((k) => <SegmentedControl.Item key={k} selected={form.kind === k} onClick={() => setForm({ ...form, kind: k })}>{tx(t, `k_${k}`)}</SegmentedControl.Item>)}
        </SegmentedControl>
        <Input header={t.repo} dir="ltr" placeholder={`owner/repo — ${t.global}`} value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
      </Section>
      {initial && (
        <Section>
          <ButtonCell mode="destructive" before="🗑" onClick={async () => { if (!(await guard(t.delete))) return; await api("memory_delete", { id: initial.id }); haptic("success"); onDone(); }}>{t.delete}</ButtonCell>
        </Section>
      )}
      {!inTg() && <div style={{ padding: 16 }}><Button size="l" stretched loading={busy} disabled={!ok} onClick={save}>{t.save}</Button></div>}
    </List>
  );
}
function MemoryTab({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
  const [list, setList] = useState<Mem[] | null>(null);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Mem | "new" | null>(null);
  const load = useCallback(async () => setList((await api<{ memories: Mem[] }>("memories")).memories), []);
  useEffect(() => { void load().catch(() => setList([])); }, [load]);
  const close = useCallback(() => setEdit(null), []);
  const shown = (list || []).filter((m) => !q || m.text.toLowerCase().includes(q.toLowerCase()) || m.scope.includes(q.toLowerCase()));
  const icon = { preference: "💡", fact: "📌", decision: "⚖️" } as const;
  return (
    <List>
      <Section header={t.memory} footer={t.memoryHint}>
        <Input placeholder={t.searchMemories} aria-label={t.searchMemories} value={q} onChange={(e) => setQ(e.target.value)} />
        <ButtonCell before={<span aria-hidden="true">＋</span>} onClick={() => { haptic("light"); setEdit("new"); }}>{t.addMemory}</ButtonCell>
      </Section>
      <Section>
        {list === null ? <Loading /> : !shown.length ? <Placeholder description={t.noMemories}><span style={{ fontSize: 44 }}>🧠</span></Placeholder>
          : shown.map((m) => (
            <Cell key={m.id} multiline before={<Emoji c={icon[m.kind]} />} onClick={() => { haptic("light"); setEdit(m); }}
              description={`${tx(t, `k_${m.kind}`)} · ${m.scope === "global" ? t.global : m.scope.slice(5)} · ${m.source_run === "app" ? t.fromApp : m.source_run ? t.fromTask : ""} ${fmtTime(m.updated_at, me.settings.tz, lang)}`}>
              <span dir="auto" style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
            </Cell>
          ))}
      </Section>
      <Sheet open={!!edit} onClose={close} title={edit && edit !== "new" ? t.edit : t.addMemory}>
        {edit && <MemoryForm t={t} initial={edit === "new" ? null : edit} onDone={() => { setEdit(null); void load(); }} />}
      </Sheet>
    </List>
  );
}

// ---------------------------------------------------------------- connectors
const BRAND_SVG: Record<string, string> = {
  github: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
  vercel: "M8 1.5 15.5 14.5H.5Z",
};
function BrandIcon({ c }: { c: ConnView }) {
  const path = BRAND_SVG[c.id];
  const glyph: Record<string, string> = { google_drive: "▲", gmail: "✉", notion: "N", supabase: "⚡", slack: "#", discord: "◉" };
  return (
    <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: c.color, color: "#fff", display: "grid", placeItems: "center" }}>
      {path ? <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d={path} /></svg> : <span style={{ fontWeight: 900, fontSize: 18 }}>{glyph[c.id] || c.name[0]}</span>}
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
  const [pat, setPat] = useState("");
  const load = useCallback(async () => { try { setList(await api("connectors")); } catch (e: any) { setMsg(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    // back from the service's sign-in page: refresh, and poll a little while a sign-in is open
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
  if (!list) return <Loading />;
  const gh = list.connectors.find((c) => c.id === "github");
  return (
    <List>
      <Section header={t.tabConnectors} footer={t.connectorsHint}>
        {list.connectors.map((c) => (
          <Cell key={c.id} multiline before={<BrandIcon c={c} />}
            titleBadge={c.status === "connected" ? <Badge type="dot" mode="primary" /> : undefined}
            subtitle={<span dir="auto">{c.status === "connected" ? `${t.connected}${c.label ? ` · ${c.label}` : ""}${c.source === "owner-env" ? ` · ${t.ownerAccount}` : ""}` : waiting === c.id ? t.connecting : c.desc[lang]}</span>}
            after={c.status === "connected" ? (c.source === "owner-env" ? undefined : <Button size="s" mode="gray" loading={busy === c.id} onClick={() => stop(c)}>{t.disconnect}</Button>)
              : c.status === "soon" ? <Badge type="number" mode="gray">{t.soon}</Badge>
              : <Button size="s" loading={busy === c.id} onClick={() => start(c)}>{t.connect}</Button>}>
            {c.name}
          </Cell>
        ))}
      </Section>
      {msg && <Section><Cell multiline before="⚠️">{msg}</Cell></Section>}
      {gh?.status === "connected" && (
        <Section header={t.pickRepo}><RepoSelect t={t} value={me.settings.repo} onChange={async (v) => { await api("settings", { repo: v }); haptic("success"); reload(); }} /></Section>
      )}
      <Section>
        <Cell before={<Emoji c="⚙️" />} after={<Navigation>{adv ? "▴" : "▾"}</Navigation>} onClick={() => { haptic("select"); setAdv((x) => !x); }} aria-expanded={adv}>{t.advanced}</Cell>
      </Section>
      {adv && (
        <>
          <Section header={t.mcpTitle} footer={t.mcpHint}>
            {list.mcp.map((m) => (
              <Cell key={m.id} subtitle={<span dir="ltr">{m.url}</span>} after={<Button size="s" mode="plain" aria-label={t.delete} onClick={async () => { if (!(await guard(t.delete))) return; await api("mcp_remove", { id: m.id }); haptic("success"); void load(); }}>✕</Button>}>{m.label}</Cell>
            ))}
            <Input header={t.mcpUrl} dir="ltr" placeholder="https://" value={mcp.url} onChange={(e) => setMcp({ ...mcp, url: e.target.value })} />
            <Input header={t.mcpName} value={mcp.label} onChange={(e) => setMcp({ ...mcp, label: e.target.value })} />
            <Input header={t.mcpToken} dir="ltr" type="password" autoComplete="off" value={mcp.token} onChange={(e) => setMcp({ ...mcp, token: e.target.value })} />
            <ButtonCell disabled={!/^https:\/\//.test(mcp.url)} onClick={async () => { try { await api("mcp_add", mcp); setMcp({ url: "", token: "", label: "" }); haptic("success"); void load(); } catch (e: any) { haptic("error"); setMsg(e.message); } }}>＋ {t.add2}</ButtonCell>
          </Section>
          {gh?.source !== "owner-env" && (
            <Section header={t.tokenFallback} footer={me.oauth ? t.pasteToken : t.tokenHelp}>
              {me.connections.github.linked ? (
                <ButtonCell mode="destructive" onClick={async () => { await api("github_unlink"); haptic("success"); reload(); void load(); }}>{t.unlink}</ButtonCell>
              ) : (
                <>
                  {me.oauth && <ButtonCell onClick={async () => { haptic("medium"); try { const { url } = await api<{ url: string }>("github_start"); openExternal(url); } catch (e: any) { setMsg(e.message); } }}>{t.signIn}</ButtonCell>}
                  <Input header="GitHub token" dir="ltr" type="password" autoComplete="off" placeholder="github_pat_…" value={pat} onChange={(e) => setPat(e.target.value)} />
                  <ButtonCell disabled={!pat} onClick={async () => { try { await api("github_token", { token: pat }); setPat(""); haptic("success"); reload(); void load(); } catch (e: any) { haptic("error"); setMsg(e.message); } }}>{t.link}</ButtonCell>
                </>
              )}
            </Section>
          )}
        </>
      )}
    </List>
  );
}

// ---------------------------------------------------------------- settings (one model-settings section + general + device)
function PolicySection({ t, me, lang }: { t: Str; me: Me; lang: Lang }) {
  const [rules, setRules] = useState<Rule[]>(me.prefs.rules);
  const [scoped, setScoped] = useState({ category: me.prefs.categories[0]?.id || "delete", repo: "", context: "*", policy: "allow" as Rule["policy"] });
  const pref = async (category: string, policy: string, repo = "*", context = "*") => { setRules((await api<{ rules: Rule[] }>("pref", { category, policy, repo, context })).rules); haptic("success"); };
  const preset = async (p: "careful" | "default" | "auto") => { setRules((await api<{ rules: Rule[] }>("pref_preset", { preset: p })).rules); haptic("success"); };
  const g = (c: string) => rules.find((r) => r.category === c && r.repo === "*" && r.context === "*")?.policy || "default";
  return (
    <>
      <Section header={`🔐 ${t.perms}`} footer={t.permsHint}>
        <div style={{ display: "flex", gap: 8, padding: "10px 16px", flexWrap: "wrap" }}>
          <Button size="s" mode="bezeled" onClick={() => preset("careful")}>{t.pr_careful}</Button>
          <Button size="s" mode="gray" onClick={() => preset("default")}>{t.pr_default}</Button>
          <Button size="s" mode="bezeled" onClick={() => preset("auto")}>{t.pr_auto}</Button>
        </div>
        {me.prefs.categories.map((c) => (
          <Select key={c.id} header={`${c.label[lang]} · ${c.tierDefault === "run" ? t.runsByDefault : t.asksByDefault}`} value={g(c.id)} onChange={(e) => pref(c.id, e.target.value)}>
            <option value="default">{t.p_default}</option><option value="ask">{t.p_ask}</option><option value="allow">{t.p_allow}</option><option value="deny">{t.p_deny}</option>
          </Select>
        ))}
      </Section>
      <Section header={t.rules}>
        {rules.filter((r) => r.repo !== "*" || r.context !== "*").map((r) => (
          <Cell key={`${r.category}|${r.repo}|${r.context}`} subtitle={<span dir="ltr">{r.repo === "*" ? t.anyRepo : r.repo} · {r.context === "*" ? t.anyContext : tx(t, r.context)}</span>}
            after={<Button size="s" mode="plain" aria-label={t.delete} onClick={() => pref(r.category, "default", r.repo, r.context)}>✕</Button>}>
            {`${me.prefs.categories.find((c) => c.id === r.category)?.label[lang] || r.category}: ${tx(t, `p_${r.policy}`)}`}
          </Cell>
        ))}
        <Select header={t.perms} value={scoped.category} onChange={(e) => setScoped({ ...scoped, category: e.target.value })}>{me.prefs.categories.map((c) => <option key={c.id} value={c.id}>{c.label[lang]}</option>)}</Select>
        <Select header="⚖️" value={scoped.policy} onChange={(e) => setScoped({ ...scoped, policy: e.target.value as Rule["policy"] })}><option value="ask">{t.p_ask}</option><option value="allow">{t.p_allow}</option><option value="deny">{t.p_deny}</option></Select>
        <Input header={t.repo} dir="ltr" placeholder="owner/repo" value={scoped.repo} onChange={(e) => setScoped({ ...scoped, repo: e.target.value })} />
        <Select header="📍" value={scoped.context} onChange={(e) => setScoped({ ...scoped, context: e.target.value })}><option value="*">{t.anyContext}</option><option value="interactive">{t.interactive}</option><option value="scheduled">{t.scheduled}</option></Select>
        <ButtonCell onClick={() => pref(scoped.category, scoped.policy, scoped.repo || "*", scoped.context)}>＋ {t.add}</ButtonCell>
      </Section>
    </>
  );
}

function ModelSection({ t, lang }: { t: Str; lang: Lang }) {
  const [d, setD] = useState<{ models: PubModel[]; owner?: (PubModel & { visible: boolean; isDefault: boolean; ready: boolean })[] } | null>(null);
  const load = useCallback(() => api("models").then(setD).catch(() => setD(null)), []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return null;
  const list: PubModel[] = d.owner || d.models;
  if (!d.owner && d.models.length < 2) return null;              // one model only: nothing to choose
  const pick = async (id: string) => { haptic("select"); await api("settings", { model: id }); haptic("success"); void load(); };
  return (
    <Section header={d.owner ? t.modelsOwner : t.models} footer={t.modelsHint}>
      {list.map((m) => {
        const o = d.owner?.find((x) => x.id === m.id);
        return (
          <Cell key={m.id} Component="label" multiline before={<Radio name="coder-model" checked={m.selected} onChange={() => pick(m.id)} />}
            subtitle={m.desc[lang]} description={o && !o.isDefault ? `${o.visible ? "👁" : "🙈"} ${o.ready ? t.modelReady : t.modelNotReady}` : undefined}
            after={<Caption>{m.price_stars ? `⭐ ${m.price_stars}` : t.modelIncluded}</Caption>}>
            {m.name[lang]}{o?.isDefault ? ` · ${t.modelDefault}` : ""}
          </Cell>
        );
      })}
    </Section>
  );
}

function SettingsTab({ t, me, lang, reload, openPage }: { t: Str; me: Me; lang: Lang; reload: () => void; openPage: (p: Page) => void }) {
  const [s, setS] = useState(me.settings);
  const [home, setHome] = useState("");
  const [bio, setBioState] = useState<{ on: boolean; ok: boolean | null }>({ on: bioWanted(), ok: null });
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => { void homeStatus().then(setHome); void bioSupported().then((ok) => setBioState((b) => ({ ...b, ok }))); }, []);
  // optimistic: the control moves at once, the server keeps it, a failure puts it back
  const set = async (b: Partial<Me["settings"]>) => {
    const prev = s;
    setS({ ...s, ...b });
    try { await api("settings", b); haptic("success"); if (b.lang || b.mode) reload(); } catch { setS(prev); haptic("error"); }
  };
  const acc: Accuracy = s.accuracy || "balanced";
  const owner = me.tier === "owner";
  return (
    <List>
      <Section header={`🧠 ${t.modelSettings}`} footer={t.modelHint}>
        <Cell Component="label" multiline subtitle={t.thinkingHint} after={<Switch checked={s.think} onChange={(e) => set({ think: e.currentTarget.checked })} />}>{t.thinking}</Cell>
      </Section>
      <Section header={t.accuracy} footer={tx(t, `accHint_${acc}`)}>
        <SegmentedControl>
          {(["fast", "balanced", "precise"] as const).map((a) => <SegmentedControl.Item key={a} selected={acc === a} onClick={() => { haptic("select"); void set({ accuracy: a }); }}>{tx(t, `acc_${a}`)}</SegmentedControl.Item>)}
        </SegmentedControl>
      </Section>
      <ModelSection t={t} lang={lang} />
      <PolicySection t={t} me={me} lang={lang} />
      <Section>
        <Cell before={<Emoji c="💎" />} after={<Navigation />} onClick={() => { haptic("light"); openPage("billing"); }}>{t.openBilling}</Cell>
        {owner && <Cell before={<Emoji c="🛠️" />} after={<Navigation />} onClick={() => { haptic("light"); openPage("panel"); }}>{lang === "ar" ? "لوحة التحكم (للمالك)" : "Control panel (owner)"}</Cell>}
      </Section>
      <Section header={t.general}>
        {me.features?.sham && (
          <Select header={t.section} value={s.mode} onChange={(e) => set({ mode: e.target.value as Me["settings"]["mode"] })}>
            <option value="coder">{t.coder}</option><option value="sham">{t.sham}</option>
          </Select>
        )}
        <Select header={t.language} value={lang} onChange={(e) => set({ lang: e.target.value as Lang })}><option value="ar">العربية</option><option value="en">English</option></Select>
        <Cell after={<Caption><span dir="ltr">{s.tz || "—"}</span></Caption>}>{t.tz}</Cell>
        <ButtonCell before="🆕" onClick={async () => { await api("new_conversation"); haptic("success"); setNote(t.started); }}>{t.newConversation}</ButtonCell>
        {note && <Cell multiline><Caption>{note}</Caption></Cell>}
      </Section>
      <Section header={t.device}>
        {(canAddToHome() || home === "added") && (home === "added" ? <Cell before="📲" after="✓">{t.addHomeDone}</Cell> : <ButtonCell before="📲" onClick={() => { haptic("light"); addToHome(); }}>{t.addHome}</ButtonCell>)}
        <Cell Component="label" multiline before="🔒" subtitle={bio.ok === false ? t.biometricNo : t.biometricHint}
          after={<Switch checked={bio.on} disabled={bio.ok === false} onChange={async (e) => { const v = e.currentTarget.checked; const ok = await setBio(v); setBioState({ on: v && ok, ok: v ? ok : bio.ok }); haptic(ok ? "success" : "error"); }} />}>
          {t.biometric}
        </Cell>
      </Section>
      <Section header={t.server}>
        <ButtonCell onClick={async () => { try { const d = await api<Record<string, unknown>>("status"); setStatus(owner ? JSON.stringify(d, null, 1) : d.available ? `✅ ${t.serviceOk}` : `⚠️ ${t.serviceDown}`); } catch { setStatus(`⚠️ ${t.serviceDown}`); } }}>{t.check}</ButtonCell>
        {status && <Cell multiline><pre dir="ltr" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 200, overflow: "auto" }}>{status}</pre></Cell>}
      </Section>
    </List>
  );
}

// ---------------------------------------------------------------- billing (sub-page)
function BillingPage({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
  const [d, setD] = useState<{ usage: PubUsage; plans: PubPlan[]; owner?: { plans: OwnPlan[]; usage?: { metrics: { metric: string; used: number; limit: number }[] } } } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [assign, setAssign] = useState({ userId: "", planId: "plus", days: "30" });
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
  if (err) return <Fail t={t} msg={err} retry={() => { setErr(""); void load(); }} />;
  if (!d) return <Loading />;
  const u = d.usage;
  return (
    <List>
      <Section header={t.currentPlan} footer={t.billingHint}>
        <Cell multiline before={<Avatar size={48} acronym="💎" />} subtitle={u.periodEnd ? `${t.planUntil}: ${fmtTime(u.periodEnd, me.settings.tz, lang)}` : undefined}>
          <Title level="3" weight="2">{u.unlimited ? t.unlimited : u.plan.name[lang]}</Title>
        </Cell>
        {!u.unlimited && (
          <>
            <Cell after={<Caption><span dir="ltr">{u.percent}%</span></Caption>}>{t.usedThisWeek}</Cell>
            <div style={{ padding: "0 16px 12px" }}><Progress value={Math.max(2, u.percent)} aria-label={t.usedThisWeek} /></div>
            <Cell multiline><Caption>{u.level === "full" ? t.usageFull : u.level === "high" ? t.usageHigh : t.usageOk}{u.renewsAt ? ` · ${t.renewsAt}: ${fmtTime(u.renewsAt, me.settings.tz, lang)}` : ""}</Caption></Cell>
          </>
        )}
        {d.owner?.usage && (() => {
          const tk = d.owner.usage.metrics.find((m) => m.metric === "tokens");
          return tk ? <Cell after={<Caption><span dir="ltr">{tk.used.toLocaleString("en-US")}</span></Caption>}>{t.tokensWeek}</Cell> : null;
        })()}
      </Section>
      <Section header={t.plans}>
        {d.plans.map((p) => (
          <Cell key={p.id} multiline before={<Emoji c={p.tier === 0 ? "🌱" : p.tier === 1 ? "⚡" : "🚀"} />}
            titleBadge={p.current ? <Badge type="number" mode="primary">{t.currentBadge}</Badge> : undefined}
            subtitle={p.price_stars ? `⭐ ${p.price_stars} ${t.stars} · ${p.days} ${t.perDays}` : p.id === "free" ? "0" : t.notForSale}
            after={p.price_stars && p.id !== "free" ? <Button size="s" loading={busy === p.id} disabled={!!busy && busy !== p.id} onClick={() => buy(p)}>{p.current ? "＋ ⭐" : `${t.upgrade} ⭐`}</Button> : undefined}>
            {p.name[lang]}
          </Cell>
        ))}
        {note && <Cell multiline before="ℹ️">{note}</Cell>}
      </Section>
      {d.owner && (
        <>
          <Section header={`🏷️ ${t.ownerPricing}`}>
            {d.owner.plans.map((p) => (
              <div key={p.id}>
                <Cell Component="label" subtitle={<span dir="ltr">{p.id}</span>} after={<Switch checked={p.active} onChange={async (e) => { await api("plan_update", { id: p.id, active: e.currentTarget.checked }); haptic("success"); void load(); }} />}>{p.name[lang]}</Cell>
                <Input header={`${t.starsPrice} ⭐`} dir="ltr" inputMode="numeric" defaultValue={p.price_stars ?? ""} onBlur={async (e) => { const v = e.currentTarget.value.trim(); if (String(p.price_stars ?? "") !== v) { await api("plan_update", { id: p.id, price_stars: v ? Number(v) : null }); haptic("success"); void load(); } }} />
                <Input header={t.periodDays} dir="ltr" inputMode="numeric" defaultValue={p.days ?? 30} onBlur={async (e) => { const v = e.currentTarget.value; if (String(p.days ?? 30) !== v) { await api("plan_update", { id: p.id, days: Number(v) || 30 }); haptic("success"); void load(); } }} />
                <Input header={t.priceLabel} defaultValue={p.price_label} onBlur={async (e) => { const v = e.currentTarget.value; if (v !== p.price_label) { await api("plan_update", { id: p.id, price_label: v }); haptic("success"); void load(); } }} />
              </div>
            ))}
          </Section>
          <Section header={t.assignPlan}>
            <Input header={t.userId} dir="ltr" inputMode="numeric" value={assign.userId} onChange={(e) => setAssign({ ...assign, userId: e.target.value })} />
            <Select header={t.currentPlan} value={assign.planId} onChange={(e) => setAssign({ ...assign, planId: e.target.value })}>{d.owner.plans.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}</Select>
            <Input header={t.planDays} dir="ltr" inputMode="numeric" value={assign.days} onChange={(e) => setAssign({ ...assign, days: e.target.value })} />
            <ButtonCell onClick={async () => { try { await api("plan_assign", assign); haptic("success"); setNote(t.saved); } catch (e: any) { haptic("error"); setNote(e.message); } }}>{t.assign}</ButtonCell>
          </Section>
        </>
      )}
    </List>
  );
}

// ---------------------------------------------------------------- owner control panel (sub-page; the server answers 403 to anyone else)
function PanelPage({ lang }: { lang: Lang }) {
  const ar = lang === "ar";
  const [d, setD] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [stalls, setStalls] = useState<any[] | null>(null);
  const [mediaRoute, setMediaRoute] = useState<"sham_v1" | "sham_v2_internal" | "sham_v2_ready" | "sham_v2_hf">("sham_v2_ready");
  const [hfMediaOrder, setHfMediaOrder] = useState<"hf_first" | "fallback_first">("fallback_first");
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
      void api<{ route: "sham_v1" | "sham_v2_internal" | "sham_v2_ready" | "sham_v2_hf" }>("sham_media").then((x) => setMediaRoute(x.route)).catch(() => null);
      void api<{ order: "hf_first" | "fallback_first" }>("hf_media_route").then((x) => setHfMediaOrder(x.order)).catch(() => null);
      void api<{ stalls: any[] }>("stalls").then((x) => setStalls(x.stalls)).catch(() => setStalls([]));
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
  const chooseMediaRoute = async (route: "sham_v1" | "sham_v2_internal" | "sham_v2_ready" | "sham_v2_hf") => {
    if (route === mediaRoute || busy === "sham_media") return;
    const prev = mediaRoute;
    setMediaRoute(route);
    setBusy("sham_media");
    setMsg("");
    try {
      const r = await api<{ route: "sham_v1" | "sham_v2_internal" | "sham_v2_ready" | "sham_v2_hf" }>("sham_media", { route });
      setMediaRoute(r.route);
      haptic("success");
      setMsg(ar ? "تم حفظ مسار وسائط شام." : "Sham media route saved.");
    } catch (err: any) {
      setMediaRoute(prev);
      haptic("error");
      setMsg(String(err?.message || err));
    } finally {
      setBusy("");
    }
  };
  const trt = (iso?: string) => (iso ? new Intl.DateTimeFormat(ar ? "ar-SY" : "en-GB", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) + " TRT" : "—");
  if (fail) return <Fail t={STR[lang]} msg={fail} retry={load} />;
  if (!d) return <Loading />;
  const tr = d.training, g = tr?.gpu, nova = tr?.nova;
  const name = (x: any) => (x.name && (ar ? x.name.ar : x.name.en)) || x.id;
  return (
    <List>
      {d.steps?.length > 0 && (
        <Section header={ar ? "خطوات يدوية باقية" : "Manual steps left"}>
          {d.steps.map((s: any) => <Cell key={s.id} multiline before="📝">{ar ? s.ar : s.en}</Cell>)}
        </Section>
      )}
      <Section header={ar ? "التدريب" : "Training"} footer={tr?.logsReadable === false ? (ar ? "سجلات المراقب تحتاج PANEL_GITHUB_TOKEN على الموقع." : "Monitor logs need PANEL_GITHUB_TOKEN on the site.") : undefined}>
        {g && <Cell multiline subtitle={`${ar ? "إعادة الضبط" : "Reset"}: ${trt(g.nextReset)} · ${g.rule}`}>{`GPU: ${ar ? "شام" : "Sham"} ${g.shamHours}h · Nova 1 ${g.novaHours}h · ${ar ? "الباقي" : "left"} ~${g.leftHours}h / ${g.quotaHours}h`}</Cell>}
        <Cell multiline subtitle={nova?.request?.not_before ? `${ar ? "يبدأ بعد" : "Starts after"} ${trt(nova.request.not_before)}` : undefined}
          after={<Button size="s" mode="bezeled" loading={busy.startsWith("nova")} onClick={() => act(nova?.paused ? "nova_resume" : "nova_pause")}>{nova?.paused ? "▶️" : "⏸"}</Button>}>
          {`Nova 1: ${nova?.request?.enabled ? (nova.paused ? (ar ? "موقوف (لا جلسات جديدة)" : "paused (no new sessions)") : (ar ? "مفعّل" : "on")) : (ar ? "غير مفعّل" : "off")}`}
        </Cell>
        <Cell multiline subtitle={tr?.monitor ? `${trt(tr.monitor.at)} · ${tr.monitor.conclusion}` : "—"}
          after={<Button size="s" mode="bezeled" loading={busy === "monitor_run"} onClick={() => act("monitor_run")}>🛰</Button>}>
          {ar ? "مراقب كاكل" : "Kaggle monitor"}
        </Cell>
        {(tr?.monitorLines || []).filter((l: string) => l.startsWith("دفتر") || l.startsWith("Nova 1:")).slice(0, 8).map((l: string, i: number) => <Cell key={i} multiline>{l}</Cell>)}
        {(tr?.inspectorLines || []).filter((l: string) => l.startsWith("status:") || l.startsWith("=====")).slice(0, 10).map((l: string, i: number) => <Cell key={"i" + i} multiline>{l}</Cell>)}
        {msg && <Cell multiline before="ℹ️">{msg}</Cell>}
      </Section>
      <Section header={ar ? "النماذج" : "Models"} footer={ar ? "الظهور للمستخدمين وسعر النجوم (فارغ = ضمن الخطة)." : "Visible to users and Stars price (empty = included)."}>
        {models.map((m: any) => (
          <div key={m.id}>
            <Cell Component="label" multiline subtitle={m.id} after={<Switch checked={Boolean(m.visible)} onChange={async (e) => { await api("model_update", { id: m.id, visible: e.currentTarget.checked }); haptic("success"); void load(); }} />}>{name(m)}</Cell>
            <Input header={`${name(m)} ⭐`} type="number" dir="ltr" defaultValue={m.price_stars ?? ""} onBlur={async (e) => { await api("model_update", { id: m.id, price_stars: e.currentTarget.value }); haptic("success"); }} />
          </div>
        ))}
      </Section>
      <Section header={ar ? "مسارات توليد الوسائط في شام" : "Sham media-generation routes"} footer={ar ? "اختر مساراً واحداً نشطاً. لا ينتقل شام تلقائياً إلى مسار آخر عند الفشل. مسار Hugging Face يدعم الصور والفيديو؛ للصوت العربي استخدم الأوزان الجاهزة." : "Choose one active route. Sham never silently switches paths on failure. Hugging Face supports images and video; use ready weights for Arabic audio."}>
        <Cell Component="label" multiline subtitle={mediaRoute === "sham_v1" ? (ar ? "المسار النشط" : "Active route") : (ar ? "اختيار المسار" : "Select route")}
          after={<Switch checked={mediaRoute === "sham_v1"} disabled={busy === "sham_media"} onChange={(e) => { if (e.currentTarget.checked) void chooseMediaRoute("sham_v1"); }} />}>
          {ar ? "شام القديم — الاستوديو الأصلي" : "Sham v1 — original Studio"}
        </Cell>
        <Cell Component="label" multiline subtitle={mediaRoute === "sham_v2_internal" ? (ar ? "المسار النشط" : "Active route") : (ar ? "اختيار المسار" : "Select route")}
          after={<Switch checked={mediaRoute === "sham_v2_internal"} disabled={busy === "sham_media"} onChange={(e) => { if (e.currentTarget.checked) void chooseMediaRoute("sham_v2_internal"); }} />}>
          {ar ? "شام v2 — مولّد الرموز الداخلي (تدريبه غير مثبت)" : "Sham v2 — internal token decoder (training unverified)"}
        </Cell>
        <Cell Component="label" multiline subtitle={mediaRoute === "sham_v2_ready" ? (ar ? "المسار النشط" : "Active route · recommended") : (ar ? "اختيار المسار" : "Select route")}
          after={<Switch checked={mediaRoute === "sham_v2_ready"} disabled={busy === "sham_media"} onChange={(e) => { if (e.currentTarget.checked) void chooseMediaRoute("sham_v2_ready"); }} />}>
          {ar ? "شام v2 — أوزان المانح الجاهزة (الافتراضي)" : "Sham v2 — ready donor weights (default)"}
        </Cell>
        <Cell Component="label" multiline subtitle={mediaRoute === "sham_v2_hf" ? (ar ? "المسار النشط" : "Active route") : (ar ? "اختيار المسار" : "Select route")}
          after={<Switch checked={mediaRoute === "sham_v2_hf"} disabled={busy === "sham_media"} onChange={(e) => { if (e.currentTarget.checked) void chooseMediaRoute("sham_v2_hf"); }} />}>
          {ar ? "شام v2 — مولّد Hugging Face الخارجي" : "Sham v2 — external Hugging Face generator"}
        </Cell>
        {busy === "sham_media" && <Cell before={<Spinner size="s" />}>{ar ? "جارٍ حفظ مسار الوسائط…" : "Saving media route…"}</Cell>}
      </Section>
      <Section header={ar ? "مولّد نوفا الخارجي" : "Nova external media generator"} footer={ar ? "هذا المفتاح يخص نوفا فقط؛ لا يغيّر أي مسار في شام." : "Nova only; this never changes Sham routes."}>
        <Cell Component="label" multiline subtitle={hfMediaOrder === "hf_first" ? (ar ? "مولّد نوفا الخارجي مفعّل" : "Nova external generator enabled") : (ar ? "مولّد نوفا الداخلي" : "Nova internal generator")}
          after={<Switch checked={hfMediaOrder === "hf_first"} disabled={busy === "hf_media_route"} onChange={async (e) => { const order = e.currentTarget.checked ? "hf_first" : "fallback_first"; const prev = hfMediaOrder; setHfMediaOrder(order); setBusy("hf_media_route"); setMsg(""); try { const r = await api<{ order: "hf_first" | "fallback_first" }>("hf_media_route", { order }); setHfMediaOrder(r.order); haptic("success"); setMsg(ar ? "تم حفظ أداة نوفا." : "Nova media tool saved."); } catch (err: any) { setHfMediaOrder(prev); haptic("error"); setMsg(String(err?.message || err)); } finally { setBusy(""); } }}>
          {ar ? "استخدام Hugging Face / Cloudflare في نوفا" : "Use Hugging Face / Cloudflare for Nova"}
        </Cell>
        {busy === "hf_media_route" && <Cell before={<Spinner size="s" />}>{ar ? "جارٍ حفظ أداة نوفا…" : "Saving Nova media tool…"}</Cell>}
        {msg && <Cell multiline before="ℹ️">{msg}</Cell>}
      </Section>
      <Section header={ar ? "الخطط (نجوم)" : "Plans (Stars)"}>
        {plans.map((p: any) => (
          <Input key={p.id} header={`${name(p)} ⭐`} type="number" dir="ltr" defaultValue={p.price_stars ?? ""}
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
      <Section header={`🔁 ${STR[lang].stalls}`}>
        {stalls === null ? <Loading /> : !stalls.length ? <Cell><Caption>{STR[lang].noStalls}</Caption></Cell>
          : stalls.slice(0, 15).map((x: any, i: number) => <Cell key={i} multiline><span dir="ltr" style={{ fontFamily: "monospace", fontSize: 11 }}>{trt(x.created_at)} {x.run_id} #{x.step} {x.pattern} L{x.level} — {String(x.detail || "").slice(0, 140)}</span></Cell>)}
      </Section>
      <Section><ButtonCell onClick={() => { haptic("light"); void load(); }}>🔄 {ar ? "تحديث" : "Refresh"}</ButtonCell></Section>
    </List>
  );
}

// ---------------------------------------------------------------- interactive terminal: live task logs stay inside the Mini App, never sent as chat messages
function TerminalTab({ lang }: { lang: Lang }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState("");
  const [events, setEvents] = useState<Ev[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const cursor = useRef(0);
  const ar = lang === "ar";
  const loadTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/coder/terminal?limit=40", { headers: { "x-telegram-init-data": rawInitData() }, cache: "no-store" });
      const d = await response.json().catch(() => ({})) as { tasks?: Task[]; error?: string };
      if (!response.ok) throw new Error(d.error || `HTTP ${response.status}`);
      setTasks(d.tasks || []);
      setError("");
      setSelected((old) => old && (d.tasks || []).some((x) => x.run_id === old) ? old : (d.tasks || [])[0]?.run_id || "");
    } catch (e: any) { setError(e?.message || "API error"); }
  }, []);
  useEffect(() => { void loadTasks(); const id = setInterval(() => { if (document.visibilityState === "visible") void loadTasks(); }, 4000); return () => clearInterval(id); }, [loadTasks]);
  useEffect(() => {
    let stopped = false;
    cursor.current = 0;
    setEvents([]);
    if (!selected) return;
    const pull = async () => {
      try {
        const response = await fetch(`/api/coder/terminal?runId=${encodeURIComponent(selected)}&after=${cursor.current}`, { headers: { "x-telegram-init-data": rawInitData() }, cache: "no-store" });
        const d = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(d.error || `HTTP ${response.status}`);
        if (stopped) return;
        if (d.events?.length) {
          cursor.current = d.events[d.events.length - 1].id;
          setEvents((old) => [...old, ...d.events].slice(-800));
        }
      } catch (e: any) { if (!stopped) setError(e?.message || "Log fetch failed"); }
    };
    void pull();
    const id = setInterval(() => { if (document.visibilityState === "visible") void pull(); }, 1200);
    return () => { stopped = true; clearInterval(id); };
  }, [selected]);
  const active = tasks.filter((x) => x.status === "running" || x.status === "waiting").length;
  return (
    <div style={{ padding: "12px", color: "#d1fae5" }}>
      <div style={{ borderRadius: 16, overflow: "hidden", background: "#050b10", border: "1px solid #164e63", boxShadow: "0 8px 28px #02061730" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", background: "#0b1720", borderBottom: "1px solid #164e63" }}>
          <div><div style={{ fontFamily: "monospace", fontWeight: 800, color: "#5eead4" }}>NOVA / TERMINAL</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{ar ? `المهام النشطة: ${active}` : `Active jobs: ${active}`}</div></div>
          <button type="button" onClick={() => { setRefreshing(true); void loadTasks().finally(() => setRefreshing(false)); }} style={{ border: "1px solid #155e75", borderRadius: 10, padding: "7px 10px", color: "#a5f3fc", background: "#082f49", fontSize: 12 }}>{refreshing ? "…" : (ar ? "تحديث" : "Refresh")}</button>
        </div>
        <div style={{ padding: 10, background: "#071018", borderBottom: "1px solid #164e63" }}>
          <label style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>{ar ? "اختر المهمة لعرض سجلاتها" : "Select a job to inspect logs"}</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: "100%", padding: "10px", borderRadius: 10, color: "#d1fae5", background: "#0b1720", border: "1px solid #155e75" }}>
            {tasks.length === 0 && <option value="">{ar ? "لا توجد مهام بعد" : "No tasks yet"}</option>}
            {tasks.map((t) => <option key={t.run_id} value={t.run_id}>{(t.status === "running" ? "● " : t.status === "failed" ? "× " : "✓ ") + (t.title || t.run_id).slice(0, 80) + " · " + t.status}</option>)}
          </select>
        </div>
        <div aria-live="polite" style={{ minHeight: 260, maxHeight: "58vh", overflowY: "auto", padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.65, whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#03070b" }}>
          <div style={{ color: "#22d3ee" }}># {ar ? "سجل حي — لا تُرسل هذه البيانات إلى محادثة البوت" : "Live logs — these stay in the Mini App"}</div>
          {error && <div style={{ color: "#fca5a5" }}>! {error}</div>}
          {!selected && <div style={{ color: "#64748b" }}>{ar ? "أرسل طلباً للبوت أو اختر مهمة سابقة." : "Send a bot request or choose a previous task."}</div>}
          {events.map((ev) => <div key={ev.id} style={{ borderBottom: "1px solid #0f172a", padding: "4px 0" }}><span style={{ color: "#64748b" }}>{new Date(ev.created_at).toLocaleTimeString()}</span>{" "}<span style={{ color: ev.kind === "failed" || ev.kind === "stall" ? "#fca5a5" : ev.kind === "done" ? "#86efac" : ev.kind === "tool" ? "#fcd34d" : "#67e8f9" }}>[{ev.kind.toUpperCase()}]</span>{" "}<span>{ev.text}</span></div>)}
          {selected && events.length === 0 && !error && <div style={{ color: "#64748b" }}>{ar ? "بانتظار السجلات…" : "Waiting for logs…"}</div>}
          {selected && tasks.find((x) => x.run_id === selected)?.status === "running" && <div className="coder-pulse" style={{ marginTop: 8, color: "#5eead4" }}>▌ {ar ? "المهمة قيد التشغيل…" : "Job is running…"}</div>}
        </div>
        <div style={{ padding: "8px 12px", color: "#64748b", fontSize: 10, background: "#0b1720", borderTop: "1px solid #164e63" }}>Postgres task events · polling 1.2s · {events.length} {ar ? "سجل معروض" : "events shown"}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shell: Tabbar for the main sections, sub-pages behind Telegram's BackButton
const TAB_ICON: Record<Tab, string> = {
  tasks: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z",
  terminal: "M4 17l6-5-6-5M12 19h8",
  schedules: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  connect: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  memory: "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Zm6 0a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
};
const TAB_KEY: Partial<Record<Tab, keyof Str>> = { tasks: "tabChats", schedules: "tabSchedules", connect: "tabConnectors", memory: "tabMemory", settings: "tabSettings" };
const TAB_LABEL: Record<Tab, { ar: string; en: string }> = { tasks: { ar: "المحادثة", en: "Chat" }, terminal: { ar: "الطرفية", en: "Terminal" }, schedules: { ar: "المهام", en: "Tasks" }, connect: { ar: "الموصلات", en: "Connectors" }, memory: { ar: "الذاكرة", en: "Memory" }, settings: { ar: "الإعدادات", en: "Settings" } };
const TABS: Tab[] = ["tasks", "terminal", "schedules", "connect", "memory", "settings"];
function routeFrom(want: string): { tab: Tab; page: Page } {
  if (want === "panel") return { tab: "settings", page: "panel" };
  if (want === "plans" || want === "billing") return { tab: "settings", page: "billing" };
  if (want === "connectors" || want === "connect") return { tab: "connect", page: null };
  return { tab: (TABS as string[]).includes(want) ? (want as Tab) : "tasks", page: null };
}

export default function NativeApp() {
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "base">("base");
  const [dark, setDark] = useState(false);
  const [tab, setTab] = useState<Tab>("tasks");
  const [page, setPage] = useState<Page>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState("");
  const reload = useCallback(async () => {
    try { setMe(await api<Me>("me")); setErr(""); } catch (e: any) { setErr(e.status === 401 ? "__tg" : e.message); }
  }, []);
  useEffect(() => {
    let alive = true;
    void startTma().then((lp) => {
      if (!alive) return;
      setPlatform(isApple() ? "ios" : "base");                 // telegram-ui: "ios" on Apple, "base" = Material everywhere else
      const r = routeFrom(new URLSearchParams(window.location.search).get("tab") || lp.startParam || "");
      setTab(r.tab);
      setPage(r.page);
      setMounted(true);
      void reload();
    });
    const apply = () => setDark(isDark() || (!getLaunch().inTelegram && Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches)));
    apply();
    const id = setInterval(apply, 1500);                          // Telegram theme switches while the app is open
    return () => { alive = false; clearInterval(id); };
  }, [reload]);
  useEffect(() => {
    // the user's own time zone, once, for schedules and times
    if (me && !me.settings.tz) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) void api("settings", { tz }).then(reload);
    }
  }, [me, reload]);
  const closePage = useCallback(() => setPage(null), []);
  useEffect(() => (page ? bindBack(true, closePage) : undefined), [page, closePage]);
  const code = getLaunch().languageCode;
  const lang: Lang = me?.settings.lang || (code === "ar" || !code ? "ar" : "en");
  const t = STR[lang];
  const safe = useMemo(() => ({
    "--safe-top": "calc(max(var(--tg-viewport-safe-area-inset-top, 0px), env(safe-area-inset-top, 0px)) + var(--tg-viewport-content-safe-area-inset-top, 0px))",
    "--safe-bottom": "calc(max(var(--tg-viewport-safe-area-inset-bottom, 0px), env(safe-area-inset-bottom, 0px)) + var(--tg-viewport-content-safe-area-inset-bottom, 0px))",
  }) as React.CSSProperties, []);
  // telegram-ui components throw "[TGUI] Wrap your app with <AppRoot>" outside AppRoot: the first screen (the spinner) needs it too,
  // otherwise every launch ends on Next's "This page couldn't load" error page
  if (!mounted) return <AppRoot appearance={dark ? "dark" : "light"} platform={platform}><div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--tg-theme-secondary-bg-color, #f3f5f9)" }}><Spinner size="l" /></div></AppRoot>;
  const title = page === "billing" ? t.billing : page === "panel" ? (lang === "ar" ? "لوحة التحكم" : "Control panel") : (TAB_KEY[tab] ? (t[TAB_KEY[tab]!] as string) : TAB_LABEL[tab][lang]);
  return (
    <AppRoot appearance={dark ? "dark" : "light"} platform={platform} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}
      style={{ ...safe, minHeight: "100vh", background: "var(--tgui--secondary_bg_color)", paddingTop: "var(--safe-top)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <header style={{ padding: "12px 16px 4px" }}>
        <Text weight="2" style={{ display: "block" }}>{page ? title : t.brand}</Text>
        {!page && <Caption style={{ color: "var(--tgui--hint_color)" }}>{t.tagline}</Caption>}
      </header>
      <main style={{ paddingBottom: page ? "calc(24px + var(--safe-bottom))" : "calc(88px + var(--safe-bottom))" }}>
        {err === "__tg" ? <Placeholder header={t.brand} description={t.openInTelegram}><span style={{ fontSize: 48 }}>💻</span></Placeholder>
          : err ? <Fail t={t} msg={err} retry={reload} />
          : !me ? <Loading />
          : page === "billing" ? <BillingPage t={t} lang={lang} me={me} />
          : page === "panel" ? (me.tier === "owner" ? <PanelPage lang={lang} /> : <Fail t={t} msg="—" retry={closePage} />)
          : tab === "tasks" ? <ThreadsTab t={t} me={me} lang={lang} />
          : tab === "terminal" ? (me.features?.terminal ? <TerminalTab lang={lang} /> : <ThreadsTab t={t} me={me} lang={lang} />)
          : tab === "schedules" ? <SchedulesTab t={t} lang={lang} me={me} />
          : tab === "memory" ? <MemoryTab t={t} lang={lang} me={me} />
          : tab === "connect" ? <ConnectorsTab t={t} me={me} lang={lang} reload={reload} />
          : <SettingsTab key={lang} t={t} me={me} lang={lang} reload={reload} openPage={setPage} />}
      </main>
      {!page && (
        <Tabbar style={{ paddingBottom: "var(--safe-bottom)" }}>
          {TABS.filter((id) => id !== "terminal" || me?.features?.terminal).map((id) => (
            <Tabbar.Item key={id} text={TAB_KEY[id] ? (t[TAB_KEY[id]!] as string) : TAB_LABEL[id][lang]} selected={tab === id} onClick={() => { haptic("select"); setTab(id); }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TAB_ICON[id]} /></svg>
            </Tabbar.Item>
          ))}
        </Tabbar>
      )}
    </AppRoot>
  );
}
