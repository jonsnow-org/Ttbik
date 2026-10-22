"use client";
// Nova AI Mini App (the Mira-structured redesign, Fadaa colours): the working sub-screens it shares with the telegram-ui screens in
// ../_native/NativeApp.tsx (events timeline, confirmations, schedule form, memory, connectors, confirmation policy, billing, owner panel),
// copied here unchanged in behaviour so NativeApp stays untouched (still reachable at ?ui=native). Same server API, every call signed with
// initData and checked on the server. They render inside Nova's AppRoot, so telegram-ui picks up Nova's palette from the --tgui--* variables.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar, Badge, Banner, Button, ButtonCell, Caption, Cell, Chip, IconContainer, Input, List, Modal, Navigation, Placeholder,
  Progress, Section, SegmentedControl, Select, Spinner, Switch, Textarea, Timeline, Title,
} from "@telegram-apps/telegram-ui";
import { STR, type Lang, type Str } from "../i18n";
import { bindBack, bindMain, getLaunch, guard, haptic, openExternal, payInvoice, rawInitData } from "../_tma/sdk";

export type Mem = { id: number; scope: string; kind: "preference" | "fact" | "decision"; text: string; source_run: string | null; created_at: string; updated_at: string };
export type Task = { run_id: string; slot: string; source: "interactive" | "scheduled" | "event"; schedule_id: string | null; title: string; status: string; steps?: number; started_at: string; updated_at: string; finished_at: string | null };
export type Ev = { id: number; run_id: string; kind: string; text: string; created_at: string };
export type Pending = { runId: string; nonce: string; reason: string; summary: string; tool: string; categories: string[]; title: string; slot: string; at: number | null };
export type Rule = { category: string; repo: string; context: string; policy: "ask" | "allow" | "deny" };
export type Cat = { id: string; label: { ar: string; en: string }; tierDefault: "ask" | "run" };
export type Accuracy = "fast" | "balanced" | "precise";
export type Me = { tier: "owner" | "user"; features?: { sham: boolean; ownerTools: boolean }; settings: { mode: "coder" | "sham"; think: boolean; accuracy?: Accuracy; lang: Lang; tz: string; repo: string; model?: string }; connections: { github: { linked: boolean; login?: string; source?: string } }; oauth: boolean; prefs: { rules: Rule[]; categories: Cat[] }; events: string[] };
export type Sched = { id: string; title: string; prompt: string; kind: "cron" | "event"; cron: string | null; tz: string; repo: string | null; events: string[]; paused: boolean; next_run_at: string | null; last_run_at: string | null; last_status: string | null; hook_id: number | null; describe: string };
export type Repo = { full_name: string; private: boolean; default_branch: string; pushed_at: string | null; description: string };
export type ConnView = { id: string; name: string; desc: { ar: string; en: string }; color: string; status: "connected" | "available" | "soon"; label?: string; source?: "owner-env" | "user-link" };
export type McpView = { id: string; url: string; label: string };
export type PubModel = { id: string; name: { ar: string; en: string }; desc: { ar: string; en: string }; price_stars: number | null; selected: boolean };
export type PubPlan = { id: string; name: { ar: string; en: string }; price_label: string; price_stars: number | null; days: number; current: boolean; tier: number };
export type PubUsage = { plan: { id: string; name: { ar: string; en: string } }; unlimited: boolean; percent: number; level: "ok" | "high" | "full"; renewsAt: string | null; periodEnd: string | null };
export type OwnPlan = { id: string; name: { ar: string; en: string }; price_label: string; price_stars?: number | null; days?: number; active: boolean };
export async function api<T = any>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch("/api/coder/app", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() },
      body: JSON.stringify({ op, ...body }),
      cache: "no-store",
      signal: controller.signal,
    });
    const d = await r.json().catch(() => null);
    if (controller.signal.aborted) throw new Error("Request timed out");
    if (!r.ok) throw Object.assign(new Error(d && typeof d.error === "string" ? d.error : `HTTP ${r.status}`), { status: r.status });
    if (!d || typeof d !== "object" || Array.isArray(d)) {
      throw new Error("أعاد الخادم استجابة غير صالحة. أعد المحاولة، وإذا تكرر الخطأ فتحقّق من سجل النشر.");
    }
    return d as T;
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error("انتهت مهلة الاتصال بالخادم. تحقّق من الاتصال ثم أعد المحاولة.");
    }
    if (e instanceof TypeError) {
      throw new Error("تعذّر الاتصال بالخادم. تحقّق من الإنترنت وحالة النشر ثم أعد المحاولة.");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
export const toDate = (iso: string) => new Date(iso.replace(" ", "T").replace(/\+00$/, "Z"));
export function ago(iso: string | null, t: Str): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - toDate(iso).getTime()) / 1000);
  if (s < 45) return t.justNow;
  if (s < 3600) return `${Math.round(s / 60)}${t.min}`;
  if (s < 86400) return `${Math.round(s / 3600)}${t.hr}`;
  return `${Math.round(s / 86400)}${t.day}`;
}
export function fmtTime(iso: string | null, tz: string, lang: Lang): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-SY" : "en-GB", { timeZone: tz || "Asia/Damascus", weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(toDate(iso));
  } catch {
    return iso.slice(0, 16);
  }
}
export const tx = (t: Str, k: string) => ((t as any)[k] as string) || k;
export const STATUS_MODE: Record<string, "primary" | "critical" | "secondary" | "gray"> = { running: "primary", waiting: "critical", done: "secondary", failed: "critical", stopped: "gray", ceiling: "gray", limited: "gray" };
export const StatusBadge = ({ s, t }: { s: string; t: Str }) => <Badge type="number" mode={STATUS_MODE[s] || "gray"}>{tx(t, `status_${s}`)}</Badge>;
export const Emoji = ({ c }: { c: string }) => <IconContainer><span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">{c}</span></IconContainer>;
export const Loading = () => <div style={{ display: "grid", placeItems: "center", padding: 32 }}><Spinner size="m" /></div>;
export function Fail({ t, msg, retry }: { t: Str; msg: string; retry: () => void }) {
  return <Placeholder header={t.error} description={msg} action={<Button size="m" onClick={retry}>{t.retry}</Button>}><span style={{ fontSize: 44 }}>⚠️</span></Placeholder>;
}

/** A bottom sheet (telegram-ui Modal) that also closes from Telegram's BackButton. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  useEffect(() => (open ? bindBack(true, onClose) : undefined), [open, onClose]);
  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose(); }} header={<Modal.Header>{title}</Modal.Header>}>
      <div style={{ paddingBottom: "calc(16px + var(--safe-bottom, 0px))", maxHeight: "80vh", overflowY: "auto" }}>{children}</div>
    </Modal>
  );
}
/** Telegram's MainButton for a form's primary action while the form is open (an in-page button stays as a fallback outside Telegram). */
export function useMain(on: boolean, text: string, cb: () => void, enabled = true, loading = false) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => (on ? bindMain(text, () => ref.current(), { enabled, loading }) : undefined), [on, text, enabled, loading]);
}
export const inTg = () => getLaunch().inTelegram;
// ---------------------------------------------------------------- tasks
export function EventsTimeline({ runId, live, t, last = 0 }: { runId: string; live: boolean; t: Str; last?: number }) {
  const [evs, setEvs] = useState<Ev[] | null>(null);
  const after = useRef(0);
  useEffect(() => {
    let stop = false;
    after.current = 0;
    setEvs(null);
    let inFlight = false;
    const pull = async () => {
      // A slow response must not overlap the next poll: overlapping requests can return the
      // same cursor and append duplicate events to the timeline.
      if (stop || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const d = await api<{ events: Ev[] }>("events", { runId, after: after.current });
        if (stop) return;
        const events = Array.isArray(d.events) ? d.events.filter((e) => Number.isFinite(e.id) && e.id > after.current) : [];
        if (events.length) {
          after.current = events[events.length - 1].id;
          setEvs((x) => [...(x || []), ...events]);
        } else setEvs((x) => x || []);
      } catch {
        setEvs((x) => x || []);
      } finally {
        inFlight = false;
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

export function PendingBanner({ p, t, cats, lang, onDone }: { p: Pending; t: Str; cats: Cat[]; lang: Lang; onDone: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const label = (p.categories || []).map((c) => cats.find((x) => x.id === c)?.label[lang]).filter(Boolean).join(" · ") || p.reason;
  const act = async (answer: "yes" | "all" | "no") => {
    if (busy) return;
    setBusy(answer);
    setError("");
    haptic(answer === "no" ? "warning" : "success");
    try {
      await api("resolve", { runId: p.runId, nonce: p.nonce, answer });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر تنفيذ الإجراء. أعد المحاولة.");
      haptic("error");
    } finally {
      setBusy("");
    }
  };
  return (
    <Banner type="section" before={<Emoji c="⚠️" />} header={`${t.needsYou}${p.title ? ` · ${p.title}` : ""}`} subheader={label} description={p.summary.slice(0, 300)}>
      {error && <Caption>{error}</Caption>}
      <Button size="s" loading={busy === "yes"} disabled={!!busy} onClick={() => void act("yes")}>{t.approve}</Button>
      <Button size="s" mode="bezeled" loading={busy === "all"} disabled={!!busy} onClick={() => void act("all")}>{t.approveAll}</Button>
      <Button size="s" mode="plain" loading={busy === "no"} disabled={!!busy} onClick={() => void act("no")}>{t.deny}</Button>
    </Banner>
  );
}

export const srcIcon = (s: Task["source"]) => (s === "interactive" ? "💬" : s === "event" ? "⚡" : "⏰");
// ---------------------------------------------------------------- schedules
export const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0];
export const DAY_TOKENS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const dayName = (d: number, lang: Lang) => (lang === "ar" ? ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])[d];

export function useRepos(on: boolean) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  useEffect(() => { if (on && !repos) void api<{ repos: Repo[] }>("repos").then((d) => setRepos(d.repos)).catch(() => setRepos([])); }, [on, repos]);
  return repos;
}
export function RepoSelect({ t, value, onChange, disabled }: { t: Str; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const repos = useRepos(true);
  return (
    <Select header={t.repo} value={value} disabled={disabled || !repos} onChange={(e) => { haptic("select"); onChange(e.target.value); }} dir="ltr">
      <option value="">{t.none}</option>
      {value && !(repos || []).some((r) => r.full_name === value) && <option value={value}>{value}</option>}
      {(repos || []).map((r) => <option key={r.full_name} value={r.full_name}>{r.private ? "🔒 " : ""}{r.full_name}</option>)}
    </Select>
  );
}

export function ScheduleForm({ t, lang, me, initial, onSaved }: { t: Str; lang: Lang; me: Me; initial: Sched | null; onSaved: () => void }) {
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

// ---------------------------------------------------------------- memory
export function MemoryForm({ t, initial, onDone }: { t: Str; initial: Mem | null; onDone: () => void }) {
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
export function MemoryTab({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
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
export const BRAND_SVG: Record<string, string> = {
  github: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
  vercel: "M8 1.5 15.5 14.5H.5Z",
};
export function BrandIcon({ c }: { c: ConnView }) {
  const path = BRAND_SVG[c.id];
  const glyph: Record<string, string> = { google_drive: "▲", gmail: "✉", notion: "N", supabase: "⚡", slack: "#", discord: "◉" };
  return (
    <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: c.color, color: "#fff", display: "grid", placeItems: "center" }}>
      {path ? <svg width="22" height="22" viewBox="0 0 16 16" fill="currentColor"><path d={path} /></svg> : <span style={{ fontWeight: 900, fontSize: 18 }}>{glyph[c.id] || c.name[0]}</span>}
    </div>
  );
}
export function ConnectorsTab({ t, me, lang, reload }: { t: Str; me: Me; lang: Lang; reload: () => void }) {
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

export function PolicySection({ t, me, lang }: { t: Str; me: Me; lang: Lang }) {
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

// ---------------------------------------------------------------- billing (sub-page)
export function BillingPage({ t, lang, me }: { t: Str; lang: Lang; me: Me }) {
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
export function PanelPage({ lang }: { lang: Lang }) {
  const ar = lang === "ar";
  const [d, setD] = useState<any>(null);
  const [models, setModels] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [stalls, setStalls] = useState<any[] | null>(null);
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

