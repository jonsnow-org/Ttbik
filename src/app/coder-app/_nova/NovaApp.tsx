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
  payInvoice, rawInitData, setBio, startTma,
} from "../_tma/sdk";
import { NSTR, fill, type NStr } from "./strings";
import { THEME_MODES, leaveFullscreen, loadMode, paintTelegram, resolveMode, saveMode, themeVars, type Resolved, type ThemeMode } from "./theme";
import {
  BillingPage, BrandIcon, ConnectorsTab, EventsTimeline, Fail, Loading, MemoryTab, PanelPage, PendingBanner, PolicySection, ScheduleForm, Sheet,
  ago, api, fmtTime, srcIcon, tx,
  type ConnView, type Me, type Pending, type PubModel, type PubPlan, type PubUsage, type Sched, type Task, type Ev,
} from "./parts";

type Tab = "home" | "chats" | "auto" | "settings";
type Page = { k: "billing" | "pricing" | "panel" | "connect" | "memory" | "policy" } | { k: "thread"; id: string; title: string } | { k: "chat"; model: string; id: string; title: string; pinned: boolean; archived: boolean } | null;
type ChatItem = { model?: string; id: string; title: string; pinned: boolean; archived: boolean; turns: number; updated_at: string; preview: string; current: boolean };
type ChatList = { model: string; selected: string; items: ChatItem[]; current: string | null; currentEmpty: boolean };
type Thread = { id: string; title: string; legacy: boolean; messages_count?: number; created_at: string; updated_at: string };
type Threads = { threads: Thread[]; current: string | null; currentEmpty: boolean; live: (Task & { thread_id?: string })[]; runs: Task[]; pending: Pending[] };
type Billing = { usage: PubUsage; plans: PubPlan[] };
type DonorTestOption = { id: string; name: { ar: string; en: string }; desc: { ar: string; en: string }; selected: boolean };
type DonorTestStatus = { id: string; phase: string; detail?: string };
type DonorChatMessage = { role: "user" | "assistant"; content: string; runId?: string };
type Models = { models: PubModel[]; owner?: (PubModel & { visible: boolean; isDefault: boolean; ready: boolean })[]; donorTests?: DonorTestOption[]; trialSelected?: string | null };
type Ctx = { t: Str; n: NStr; lang: Lang; me: Me; owner: boolean; go: (tab: Tab) => void; open: (p: Page) => void; reload: () => void; mode: Resolved };

const TABS: Tab[] = ["home", "chats", "auto", "settings"];
const NAV_KEY: Partial<Record<Tab, keyof NStr>> = { home: "navHome", chats: "navChats", auto: "navSchedules", settings: "navSettings" };
const NAV_LABEL: Record<Tab, { ar: string; en: string }> = { home: { ar: "الرئيسية", en: "Home" }, chats: { ar: "المحادثة", en: "Chats" }, auto: { ar: "المهام", en: "Schedules" }, settings: { ar: "الإعدادات", en: "Settings" } };
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
  if (want === "terminal") return { tab: "chats", page: null }; // terminal now lives inside Chats
  if (want === "schedules" || want === "auto") return { tab: "auto", page: null };
  if (want === "settings") return { tab: "settings", page: null };
  return { tab: "home", page: null };
}

// ---------------------------------------------------------------- private live terminal inside the default Nova UI
function TerminalScreen({ lang, fixedRunId, compact = false, model = "all" }: { lang: Lang; fixedRunId?: string; compact?: boolean; model?: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState("");
  const [events, setEvents] = useState<Ev[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [pendingBusy, setPendingBusy] = useState("");
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "reconnecting">("connecting");
  const [loaded, setLoaded] = useState(false);                 // the first answer of the terminal API arrived (REST link is up)
  const [asking, setAsking] = useState<{ runId: string; question: string } | null>(null);   // the agent waits for the user's answer
  const userPicked = useRef(false);                            // the user chose a task by hand: do not jump to another one
  const activeRef = useRef(0);
  const [notice, setNotice] = useState("");
  const logsRef = useRef<HTMLDivElement | null>(null);
  const loadBusy = useRef(false);
  
  const sendLock = useRef(false);
  const cursor = useRef(0);
  const ar = lang === "ar";
  const terminalModel = model === "sham_loop" ? "sham" : model;
  const modelQuery = terminalModel === "all" ? "" : `&model=${encodeURIComponent(terminalModel)}`;
  const fetchJson = useCallback(async (url: string) => {
    const r = await fetch(url, { headers: { "x-telegram-init-data": rawInitData() }, cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }, []);
  const load = useCallback(async () => {
    if (loadBusy.current) return;
    loadBusy.current = true;
    try {
      const d = await fetchJson(`/api/coder/terminal?limit=40${modelQuery}`);
      setTasks(d.tasks || []);
      setPending(d.pending || []);
      setAsking(d.asking || null);
      setSelected((old) => {
        if (fixedRunId) return fixedRunId;
        const list: Task[] = d.tasks || [];
        const live = (x: Task) => x.status === "running" || x.status === "waiting" || x.status === "pending";
        const cur = list.find((x) => x.run_id === old);
        // a task started from the chat (or the other screen) is followed automatically, unless the user picked one by hand
        if (cur && (live(cur) || userPicked.current)) return old;
        const running = list.find(live);
        return running?.run_id || (cur ? old : list[0]?.run_id || "");
      });
      setLoaded(true);
      setError("");
    } catch (e: any) { setError(e?.message || "API error"); }
    finally { loadBusy.current = false; }
  }, [fetchJson, fixedRunId, modelQuery]);
  useEffect(() => {
    // quick while a task runs (status, approvals, questions), relaxed when idle; always one request at a time
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") await load();
      if (!stop) timer = setTimeout(tick, activeRef.current > 0 ? 3000 : 8000);
    };
    void tick();
    const wake = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", wake);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener("visibilitychange", wake); };
  }, [load]);
  useEffect(() => {
    let stopped = false;
    let controller: AbortController | undefined;
    let retryMs = 800;
    let finished = false;                       // a done/failed event was seen: nothing more will come, stop reconnecting
    cursor.current = 0;
    setEvents([]);
    if (!selected) { setStreamState("connected"); return; }
    setStreamState("connecting");
    const connect = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const r = await fetch(`/api/coder/stream?runId=${encodeURIComponent(selected)}&after=${cursor.current}${modelQuery}`, {
            headers: { "x-telegram-init-data": rawInitData() },
            cache: "no-store",
            signal: controller.signal,
          });
          if (!r.ok) {
            const d = await r.json().catch(() => ({}));
            throw new Error(d.error || `HTTP ${r.status}`);
          }
          if (!r.body) throw new Error("Live stream is not supported by this browser");
          retryMs = 800;
          setStreamState("connected");
          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
              if (dataLine) {
                try {
                  const ev = JSON.parse(dataLine.slice(5).trim()) as Ev;
                  if (typeof ev.id === "number" && ev.id > cursor.current) {
                    cursor.current = ev.id;
                    if (ev.kind === "done" || ev.kind === "failed") finished = true;
                    setEvents((old) => old.some((x) => x.id === ev.id) ? old : [...old, ev].slice(-400));
                  }
                } catch { /* ignore malformed frames and continue the stream */ }
              }
              boundary = buffer.indexOf("\n\n");
            }
          }
          if (!stopped) setError("");
        } catch (e: any) {
          if (!stopped && e?.name !== "AbortError") {
            setStreamState("reconnecting");
            setError(e?.message || "Live stream disconnected; reconnecting…");
          }
        } finally {
          controller = undefined;
        }
        if (finished) { setStreamState("connected"); return; }
        if (!stopped) {
          setStreamState("connecting");
          await new Promise((resolve) => setTimeout(resolve, retryMs));
          retryMs = Math.min(10000, retryMs * 2);
        }
      }
    };
    void connect();
    return () => { stopped = true; controller?.abort(); };
  }, [selected, modelQuery]);
  useEffect(() => {
    if (logsOpen && logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [events, logsOpen]);
  const active = tasks.filter((x) => x.status === "running" || x.status === "waiting").length;
  activeRef.current = active;
  const selTask = tasks.find((t) => t.run_id === selected);
  const selLive = !!selTask && (selTask.status === "running" || selTask.status === "waiting");
  const selDone = !!selTask && !selLive;
  const link: "connecting" | "reconnecting" | "live" | "online" = !loaded && !error ? "connecting" : error ? "reconnecting" : selLive && streamState === "connected" ? "live" : selLive ? "connecting" : "online";
  const NOISE = /العامل الخلفي حيّ|جارٍ انتظار أول مخرجات|إرسال الخطوة|استجابة خادم النموذج/;
  const isNoise = (e: Ev) => e.kind === "info" && NOISE.test(e.text);
  const lastNoise = [...events].reverse().find(isNoise);
  const shownEvents = events.filter((e) => !isNoise(e));
  const askingHere = !!asking && asking.runId === selected;
  const resolveApproval = async (p: Pending, answer: "yes" | "all" | "no") => {
    const key = `${p.runId}:${answer}`;
    setPendingBusy(key);
    try {
      const r = await fetch("/api/coder/app", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() },
        body: JSON.stringify({ op: "resolve", runId: p.runId, nonce: p.nonce, answer }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || (ar ? "تعذّر تنفيذ الموافقة" : "Could not resolve approval"));
      await load();
    } catch (e: any) {
      setError(e?.message || (ar ? "تعذّر تنفيذ الموافقة" : "Could not resolve approval"));
    } finally { setPendingBusy(""); }
  };
  const clearHistory = async () => {
    if (!tasks.some((t) => t.status !== "running" && t.status !== "waiting")) return;
    if (!window.confirm(ar ? "إخفاء كل المهام المنتهية من السجل؟ لن تتأثر المهام الجارية." : "Archive all finished tasks? Running tasks will not be affected.")) return;
    try {
      const r = await fetch("/api/coder/app", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() }, body: JSON.stringify({ op: "tasks_clear" }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "تعذّر تنظيف السجل");
      cursor.current = 0; setEvents([]); setSelected("");
      await load();
      setNotice(ar ? `تم إخفاء ${d.archived || 0} مهمة منتهية.` : `Archived ${d.archived || 0} finished tasks.`);
    } catch (e: any) { setError(e?.message || "تعذّر تنظيف السجل"); }
  };
  const stopSelected = async () => {
    const task = tasks.find((t) => t.run_id === selected);
    if (!task || (task.status !== "running" && task.status !== "waiting")) return;
    if (!window.confirm(ar ? "إيقاف هذه المهمة الآن؟" : "Stop this task now?")) return;
    try {
      const r = await fetch("/api/coder/app", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() }, body: JSON.stringify({ op: "stop", runId: selected, slot: task.slot }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "تعذّر إيقاف المهمة");
      setNotice(ar ? "أُرسل طلب إيقاف المهمة." : "Stop requested.");
      await load();
    } catch (e: any) { setError(e?.message || "تعذّر إيقاف المهمة"); }
  };
  const continueTask = async () => {
    if (!selTask || sending) return;
    const t = (selTask.title || "").slice(0, 160);
    await sendCmd(ar ? `تابع المهمة السابقة من حيث توقفت${t ? `: ${t}` : "."}` : `Continue the previous task from where it stopped${t ? `: ${t}` : "."}`);
  };
  const deleteSelected = async () => {
    if (!selTask || !selDone) return;
    if (!window.confirm(ar ? "حذف هذه المهمة من السجل؟" : "Remove this task from the history?")) return;
    try {
      const r = await fetch("/api/coder/app", { method: "POST", headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() }, body: JSON.stringify({ op: "task_delete", runId: selTask.run_id }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || (ar ? "تعذّر الحذف" : "Could not remove"));
      userPicked.current = false; cursor.current = 0; setEvents([]); setSelected("");
      await load();
      setNotice(ar ? "حُذفت المهمة من السجل." : "Task removed from the history.");
    } catch (e: any) { setError(e?.message || "تعذّر الحذف"); }
  };
  const sendCmd = async (override?: string) => {
    const txt = (override ?? input).trim();
    if (!txt || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError("");
    try {
      const r = await fetch("/api/coder/app", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-telegram-init-data": rawInitData() },
        body: JSON.stringify({ op: "send", text: txt }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "فشل الإرسال");
      setInput("");
      if (d.runId) {
        userPicked.current = false;                      // follow the task that was just started / answered
        cursor.current = 0;
        setEvents([]);
        setSelected(d.runId);
      }
      await load();
    } catch (e: any) { setSendError(e?.message || "فشل الإرسال"); }
    finally { sendLock.current = false; setSending(false); }
  };
  return <div className={compact ? "" : "n-page"} style={{ paddingBottom: compact ? 8 : 20, minHeight: compact ? 180 : undefined, border: "2px solid #0e7490" }}>
    <div style={{ padding: 14, borderRadius: 18, background: "#050b10", color: "#d1fae5", border: "1px solid #164e63", overflow: "hidden", minHeight: 160 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <div><div style={{ color: "#5eead4", font: "800 15px ui-monospace,monospace" }}>NOVA / TERMINAL</div><div style={{ color: "#94a3b8", fontSize: 12 }}>{ar ? `المهام النشطة: ${active}` : `Active jobs: ${active}`}</div></div>
        <div style={{ color: link === "live" ? "#5eead4" : link === "online" ? "#86efac" : link === "reconnecting" ? "#fbbf24" : "#94a3b8", fontSize: 11, whiteSpace: "nowrap", fontWeight: 700 }}>
          {ar ? (link === "live" ? "● مباشر" : link === "online" ? "● متصل" : link === "reconnecting" ? "↻ إعادة الاتصال…" : "◌ جارٍ الاتصال…") : (link === "live" ? "● Live" : link === "online" ? "● Connected" : link === "reconnecting" ? "↻ Reconnecting…" : "◌ Connecting…")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {selLive && <button type="button" onClick={() => void stopSelected()} style={{ border: "1px solid #7f1d1d", borderRadius: 8, padding: "7px 10px", background: "#450a0a", color: "#fecaca", fontSize: 12, fontWeight: 700 }}>⏹ {ar ? "إيقاف" : "Stop"}</button>}
        {selDone && selTask && selTask.status !== "done" && <button type="button" disabled={sending} onClick={() => void continueTask()} style={{ border: "1px solid #166534", borderRadius: 8, padding: "7px 10px", background: "#052e16", color: "#bbf7d0", fontSize: 12, fontWeight: 700 }}>▶ {ar ? "متابعة" : "Continue"}</button>}
        {selDone && <button type="button" onClick={() => void deleteSelected()} style={{ border: "1px solid #155e75", borderRadius: 8, padding: "7px 10px", background: "#082f49", color: "#fca5a5", fontSize: 12 }}>🗑 {ar ? "حذف" : "Delete"}</button>}
        {tasks.some((t) => t.status !== "running" && t.status !== "waiting") && <button type="button" onClick={() => void clearHistory()} style={{ border: "1px solid #155e75", borderRadius: 8, padding: "7px 10px", background: "#082f49", color: "#a5f3fc", fontSize: 12 }}>🧹 {ar ? "تنظيف المنتهية" : "Clear finished"}</button>}
        <button type="button" onClick={() => setLogsOpen((v) => !v)} style={{ border: "1px solid #155e75", borderRadius: 8, padding: "7px 10px", background: "#082f49", color: "#a5f3fc", fontSize: 12 }}>{logsOpen ? (ar ? "إخفاء السجل" : "Hide logs") : (ar ? "إظهار السجل" : "Show logs")}</button>
      </div>
      {tasks.length > 1 && (
        <select aria-label={ar ? "المهمة" : "Task"} value={selected} onChange={(e) => { userPicked.current = true; setSelected(e.target.value); }} style={{ width: "100%", padding: 8, borderRadius: 8, background: "#0b1720", color: "#d1fae5", border: "1px solid #155e75", marginBottom: 8, fontSize: 13 }}>
          {tasks.map((t) => <option key={t.run_id} value={t.run_id}>{(t.title || t.run_id).slice(0, 50)} · {t.status}</option>)}
        </select>
      )}
      {pending.filter((p) => p.runId === selected).map((p) => (
        <div key={p.runId + p.nonce} style={{ margin: "8px 0", padding: 12, border: "1px solid #f59e0b", borderRadius: 12, background: "#422006", color: "#fef3c7" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>{ar ? "يتطلب تأكيدك قبل تنفيذ الأداة" : "Approval required before running a tool"}</div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>{p.reason} · {p.tool}</div>
          <div style={{ color: "#fde68a", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.summary}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <button type="button" disabled={!!pendingBusy} onClick={() => void resolveApproval(p, "yes")} style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "#059669", color: "#fff", fontWeight: 700 }}>{pendingBusy === `${p.runId}:yes` ? "…" : ar ? "موافقة" : "Approve"}</button>
            <button type="button" disabled={!!pendingBusy} onClick={() => void resolveApproval(p, "all")} style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "#0e7490", color: "#fff", fontWeight: 700 }}>{pendingBusy === `${p.runId}:all` ? "…" : ar ? "السماح لبقية المهمة" : "Approve task"}</button>
            <button type="button" disabled={!!pendingBusy} onClick={() => void resolveApproval(p, "no")} style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "#991b1b", color: "#fff", fontWeight: 700 }}>{pendingBusy === `${p.runId}:no` ? "…" : ar ? "رفض" : "Deny"}</button>
          </div>
        </div>
      ))}
      {notice && <div style={{ color: "#86efac", fontSize: 12, padding: "5px 8px" }}>{notice}</div>}
      {logsOpen && <div ref={logsRef} aria-live="polite" style={{ minHeight: 110, maxHeight: "32vh", overflowY: "auto", padding: 10, background: "#03070b", borderRadius: 10, font: "12px/1.7 ui-monospace,monospace", overflowWrap: "anywhere", overscrollBehavior: "contain" }}>
        <div style={{ color: "#22d3ee" }}># {ar ? "سجلات حية — تبقى داخل التطبيق" : "Live logs — kept inside the Mini App"}</div>
        {error && <div style={{ color: "#fca5a5" }}>! {error}</div>}
        {!selected && <div style={{ color: "#64748b" }}>{ar ? "اختر مهمة أو أرسل طلباً للبوت." : "Choose a task or send a bot request."}</div>}
        {shownEvents.map((ev) => <div key={ev.id} style={{ borderBottom: "1px solid #0f172a", padding: "4px 0" }}><span style={{ color: "#64748b" }}>{new Date(ev.created_at).toLocaleTimeString()}</span>{" "}<span style={{ color: ev.kind === "failed" || ev.kind === "stall" ? "#fca5a5" : ev.kind === "done" ? "#86efac" : "#67e8f9" }}>[{ev.kind.toUpperCase()}]</span>{" "}<span dir="auto" style={{ unicodeBidi: "plaintext" }}>{ev.text}</span></div>)}
        {selLive && lastNoise && <div style={{ color: "#64748b", padding: "4px 0" }}>⏳ {lastNoise.text}</div>}
        {selected && !events.length && !error && <div style={{ color: "#64748b" }}>{ar ? "بانتظار الأحداث…" : "Waiting for events…"}</div>}
      </div>}
      {askingHere && asking && (
        <div style={{ margin: "10px 0 0", padding: 12, border: "1px solid #38bdf8", borderRadius: 12, background: "#082f49", color: "#e0f2fe" }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>❓ {ar ? "الوكيل ينتظر جوابك" : "The agent is waiting for your answer"}</div>
          <div dir="auto" style={{ fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere", unicodeBidi: "plaintext" }}>{asking.question}</div>
        </div>
      )}
      <div dir="ltr" style={{ display: "flex", flexDirection: "row", gap: 8, marginTop: 12, padding: 6, background: "#0c4a6e", borderRadius: 14, alignItems: "stretch" }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendCmd(); } }} rows={2} placeholder={askingHere ? (ar ? "اكتب جوابك هنا…" : "Type your answer here…") : (ar ? "اكتب طلبك… Enter للإرسال، Shift+Enter لسطر جديد" : "Write a task… Enter to send, Shift+Enter for a new line")} style={{ flex: 1, padding: "12px", borderRadius: 10, background: "#082f49", color: "#e0f2fe", border: "2px solid #22d3ee", fontSize: 15, lineHeight: 1.5, outline: "none", minWidth: 0, minHeight: 56, maxHeight: 140, resize: "vertical", fontFamily: "inherit" }} />
        <button type="button" onClick={() => void sendCmd()} disabled={sending || !input.trim()} style={{ padding: "14px 18px", borderRadius: 10, background: sending ? "#475569" : "#0891b2", color: "#fff", border: "none", fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", flexShrink: 0 }}>{sending ? "…" : ar ? "إرسال" : "Send"}</button>
      </div>
      {sendError && <div style={{ color: "#f87171", fontSize: 13, marginTop: 8, padding: "8px 12px", background: "#450a0a", borderRadius: 8 }}>{sendError}</div>}
    </div>
  </div>;
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
/** Option list in a bottom sheet (theme, language, accuracy). */
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
  const trial = d?.donorTests?.find((x) => x.selected);
  if (trial) return "🧪 " + trial.name[lang] + " · " + (lang === "ar" ? "اختبار مباشر" : "Direct test");
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
  const [pickError, setPickError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [trialStatuses, setTrialStatuses] = useState<Record<string, DonorTestStatus>>({});
  const switchingRef = useRef(false);
  useEffect(() => (at !== null ? bindBack(true, onClose) : undefined), [at, onClose]);
  useEffect(() => {
    if (at === null || !d?.donorTests?.length) return;
    let alive = true;
    api<{ statuses: DonorTestStatus[] }>("donor_test_status").then((x) => {
      if (alive) setTrialStatuses(Object.fromEntries((x.statuses || []).map((s) => [s.id, s])));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [at, d?.donorTests?.length]);
  if (at === null) return null;
  const list = d ? d.owner || d.models : [];
  const pickDonor = async (id: string) => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setSwitching(true);
    setPickError("");
    try {
      const saved = await api<{ ok?: boolean; trialSelected?: string | null }>("donor_test_select", { id });
      if (!saved.ok || (saved.trialSelected || "") !== id) throw new Error("لم يؤكد الخادم حفظ وضع اختبار المرشح.");
      haptic("success");
      onPicked();
      onClose();
    } catch (e: any) {
      haptic("error");
      setPickError(e?.message || "تعذّر تفعيل اختبار المرشح.");
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  };
  const phaseLabel = (phase: string) => ({
    ready: lang === "ar" ? "✅ جاهز للمحادثة" : "✅ Ready for chat",
    loading: lang === "ar" ? "⏳ النموذج يُحمّل" : "⏳ Model loading",
    deploying: lang === "ar" ? "⏳ الاستديو قيد التشغيل" : "⏳ Studio starting",
    not_created: lang === "ar" ? "لم يُنشأ الاستديو بعد" : "Studio not created yet",
    error: lang === "ar" ? "❌ فشل تحميل المرشح" : "❌ Candidate load failed",
    unconfigured: lang === "ar" ? "رمز ModelScope غير مضبوط" : "ModelScope token not configured",
    unavailable: lang === "ar" ? "تعذّر التحقق من الاستديو" : "Could not verify Studio",
    unknown: lang === "ar" ? "جارٍ فحص الاستديو…" : "Checking Studio…",
  } as Record<string, string>)[phase] || (lang === "ar" ? "جارٍ فحص الاستديو…" : "Checking Studio…");
  const pick = async (id: string) => {
    if (switchingRef.current) return;
    switchingRef.current = true;
    setSwitching(true);
    haptic("select");
    setPickError("");
    try {
      const saved = await api<{ ok?: boolean; model?: string }>("settings", { model: id });
      if (!saved.ok || saved.model !== id) throw new Error("لم يؤكد الخادم حفظ النموذج المختار.");
      haptic("success");
      onPicked();
      onClose();
    } catch (e: any) {
      haptic("error");
      setPickError(e?.message || "تعذّر حفظ النموذج. بقي النموذج السابق محدداً.");
    } finally {
      switchingRef.current = false;
      setSwitching(false);
    }
  };
  return (
    <>
      <div className="n-scrim" style={{ background: "transparent" }} onClick={onClose} />
      <div className="n-pop" role="listbox" aria-label={n.modelPick} style={at}>
        {pickError && <p role="alert" className="n-s" style={{ color: "var(--c-danger)", padding: "8px 12px" }}>{pickError}</p>}
        {!d ? <Loading /> : list.map((m) => {
          const o = d.owner?.find((x) => x.id === m.id);
          return (
            <button key={m.id} type="button" role="option" aria-selected={m.selected} disabled={switching} className={`n-opt${m.selected ? " n-sel" : ""}`} onClick={() => pick(m.id)}>
              <span className="n-body">
                <span className="n-t">{m.name[lang]}{m.price_stars ? <span className="n-pro">{n.pro}</span> : null}{o && !o.visible ? <span className="n-chip">{n.hidden}</span> : null}</span>
                <span className="n-s">{m.desc[lang]}</span>
              </span>
              {m.selected && <span className="n-check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
        {d?.owner && (d.donorTests?.length || 0) > 0 && (
          <>
            <div className="n-s" style={{ padding: "12px 12px 5px", fontWeight: 800, color: "var(--c-accent)" }}>
              🧪 {lang === "ar" ? "اختبار المرشحين · خاص بالمالك" : "Candidate test · owner only"}
            </div>
            <div className="n-s" style={{ padding: "0 12px 8px" }}>
              {lang === "ar" ? "كل رسالة تذهب مباشرة إلى استديو المرشح المحدد ولا تدخل مسارات الإنتاج." : "Messages go straight to the selected candidate Studio, outside production routes."}
            </div>
            {d.donorTests!.map((m) => {
              const phase = trialStatuses[m.id]?.phase || "unknown";
              return (
                <button key={m.id} type="button" role="option" aria-selected={m.selected} disabled={switching} className={`n-opt${m.selected ? " n-sel" : ""}`} onClick={() => pickDonor(m.id)}>
                  <span className="n-body">
                    <span className="n-t">🧪 {m.name[lang]}</span>
                    <span className="n-s">{m.desc[lang]}</span>
                    <span className="n-s">{phaseLabel(phase)}</span>
                  </span>
                  {m.selected && <span className="n-check" aria-hidden="true">✓</span>}
                </button>
              );
            })}
            {d.trialSelected && (
              <>
                <div className="n-s" style={{ padding: "8px 12px 0" }}>
                  {lang === "ar" ? "سجل مستقل لكل مرشح. استدعاءات الأدوات تُعرض للفحص ولا تُنفّذ." : "Separate history per candidate. Tool calls are displayed for inspection only."}
                </div>
                <button type="button" disabled={switching} className="n-opt" onClick={() => pickDonor("")}>
                  <span className="n-body"><span className="n-t">↩ {lang === "ar" ? "إيقاف وضع الاختبار والعودة للنموذج المعتاد" : "Exit test mode and return to normal model"}</span></span>
                </button>
                <button type="button" disabled={switching} className="n-opt" onClick={async () => {
                  if (switchingRef.current) return;
                  switchingRef.current = true; setSwitching(true);
                  try { await api("donor_test_reset", { id: d.trialSelected }); haptic("success"); onPicked(); onClose(); }
                  catch (e: any) { setPickError(e?.message || "تعذّر بدء محادثة اختبار جديدة."); }
                  finally { switchingRef.current = false; setSwitching(false); }
                }}>
                  <span className="n-body"><span className="n-t">＋ {lang === "ar" ? "محادثة جديدة لهذا المرشح" : "New chat for this candidate"}</span></span>
                </button>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}


function DonorTestPanel({ c, candidate, revision }: { c: Ctx; candidate: DonorTestOption; revision: Models | null }) {
  const { lang } = c;
  const ar = lang === "ar";
  const [messages, setMessages] = useState<DonorChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<DonorTestStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [runId, setRunId] = useState("");
  const [notice, setNotice] = useState("");
  const cursor = useRef(0);
  const pollBusy = useRef(false);
  const runRef = useRef("");
  const terminalRef = useRef(false);

  const refreshHistory = useCallback(async () => {
    const result = await api<{ messages: { role: "user" | "assistant"; content: string }[] }>("donor_test_history", { id: candidate.id });
    setMessages((result.messages || []).map((x) => ({ role: x.role, content: x.content })));
  }, [candidate.id]);

  const checkStatus = useCallback(async () => {
    const result = await api<{ statuses: DonorTestStatus[] }>("donor_test_status");
    setStatus((result.statuses || []).find((x) => x.id === candidate.id) || null);
  }, [candidate.id]);

  useEffect(() => {
    let alive = true;
    void refreshHistory().catch((e: any) => alive && setNotice(e?.message || "تعذّر تحميل سجل الاختبار."));
    void checkStatus().catch((e: any) => alive && setStatus({ id: candidate.id, phase: "unavailable", detail: e?.message || "" }));
    return () => { alive = false; };
  }, [candidate.id, revision, refreshHistory, checkStatus]);

  const poll = useCallback(async () => {
    const activeId = runRef.current;
    if (!activeId || terminalRef.current || pollBusy.current || document.visibilityState !== "visible") return;
    pollBusy.current = true;
    try {
      const result = await api<{ events: Ev[] }>("events", { runId: activeId, after: cursor.current });
      for (const event of result.events || []) {
        cursor.current = Math.max(cursor.current, event.id);
        if (event.kind === "text") {
          setMessages((old) => {
            const last = old[old.length - 1];
            if (last?.role === "assistant" && last.runId === activeId) {
              return [...old.slice(0, -1), { ...last, content: last.content + event.text }];
            }
            return [...old, { role: "assistant", content: event.text, runId: activeId }];
          });
        } else if (event.kind === "info") {
          setNotice(event.text);
        } else if (event.kind === "failed") {
          setNotice(event.text);
          terminalRef.current = true;
          setBusy(false);
          void refreshHistory().catch(() => undefined);
        } else if (event.kind === "done") {
          setNotice(event.text);
          terminalRef.current = true;
          setBusy(false);
          void refreshHistory().catch(() => undefined);
        }
      }
    } catch (e: any) {
      setNotice(e?.message || (ar ? "انقطع اتصال سجل الاختبار مؤقتاً." : "Test log connection interrupted."));
    } finally {
      pollBusy.current = false;
    }
  }, [ar, refreshHistory]);

  useEffect(() => {
    if (!runId) return;
    const timer = setInterval(() => { void poll(); }, 1200);
    void poll();
    return () => clearInterval(timer);
  }, [runId, poll]);

  const send = async () => {
    const prompt = input.trim();
    if (!prompt || busy || status?.phase !== "ready") return;
    setBusy(true);
    setNotice(ar ? "أُرسل الطلب مباشرة إلى استديو المرشح…" : "Sending directly to candidate Studio…");
    setMessages((old) => [...old, { role: "user", content: prompt }]);
    setInput("");
    cursor.current = 0;
    terminalRef.current = false;
    try {
      const result = await api<{ runId: string }>("send", { text: prompt });
      if (!result.runId) throw new Error("لم يُنشأ طلب اختبار.");
      runRef.current = result.runId;
      setRunId(result.runId);
    } catch (e: any) {
      setBusy(false);
      setNotice(e?.message || (ar ? "تعذّر إرسال طلب الاختبار." : "Could not send the test prompt."));
    }
  };

  const stop = async () => {
    if (!runRef.current || !busy) return;
    try {
      await api("stop", { runId: runRef.current, slot: "donor:" + candidate.id });
      terminalRef.current = true;
      setBusy(false);
      setNotice(ar ? "تم إيقاف مهمة الاختبار." : "Test task stopped.");
    } catch (e: any) { setNotice(e?.message || "تعذّر إيقاف الاختبار."); }
  };

  const phase = status?.phase || "checking";
  const ready = phase === "ready";
  const phaseText: Record<string, string> = {
    ready: ar ? "✅ الاستديو جاهز — الاتصال مباشر" : "✅ Studio ready — direct connection",
    loading: ar ? "⏳ النموذج قيد التحميل" : "⏳ Model is loading",
    deploying: ar ? "⏳ الاستديو قيد التشغيل" : "⏳ Studio is starting",
    not_created: ar ? "لم يُنشأ استديو هذا المرشح بعد" : "This candidate Studio has not been created yet",
    error: ar ? "❌ فشل تحميل النموذج داخل الاستديو" : "❌ Model failed to load in Studio",
    unconfigured: ar ? "رمز ModelScope غير مضبوط على خادم التطبيق" : "ModelScope token is not configured on the app server",
    unavailable: status?.detail || (ar ? "تعذّر التحقق من الاستديو" : "Could not check Studio"),
    checking: ar ? "جارٍ فحص استديو المرشح…" : "Checking candidate Studio…",
  };

  return (
    <section className="n-card" style={{ marginBottom: 16, padding: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div className="n-body">
          <div className="n-lbl">🧪 {ar ? "وضع اختبار مستقل" : "Isolated candidate test"}</div>
          <div className="n-t">{candidate.name[lang]}</div>
          <div className="n-s">{candidate.desc[lang]}</div>
        </div>
        <span className="n-chip">{ar ? "خاص بالمالك" : "Owner only"}</span>
      </div>
      <div className="n-s" role="status" style={{ margin: "10px 0", color: ready ? "var(--c-ok)" : "var(--c-warn)" }}>
        {phaseText[phase] || phaseText.checking}
        {status?.detail && phase !== "unavailable" ? " · " + status.detail : ""}
      </div>
      <div className="n-s" style={{ padding: "8px 0", borderTop: "1px solid var(--c-line)" }}>
        {ar
          ? "رسائلك هنا تصل إلى هذا المرشح فقط. لا نستخدم سجل Nova أو شام، ولا نمرّر أي بيانات أو مفاتيح إنتاجية إليه."
          : "Messages here reach this candidate only. No Nova/Sham history or production credentials are passed to it."}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "42vh", overflowY: "auto", padding: "8px 0" }}>
        {!messages.length && <div className="n-empty">{ar ? "ابدأ المحادثة بسؤال اختبار." : "Start with a test prompt."}</div>}
        {messages.map((message, index) => (
          <div key={index} className={"n-bubble " + (message.role === "user" ? "n-me" : "n-bot")} dir="auto" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {message.content}
          </div>
        ))}
      </div>
      {notice && <div className="n-meta" role="status" dir="auto" style={{ padding: "6px 0" }}>{notice}</div>}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
        disabled={!ready || busy}
        rows={3}
        placeholder={ready ? (ar ? "اكتب سؤالاً لهذا المرشح فقط…" : "Write a prompt for this candidate only…") : (ar ? "انتظر حتى يصبح الاستديو جاهزاً…" : "Wait for the Studio to become ready…")}
        style={{ width: "100%", border: "1px solid var(--c-line)", background: "var(--c-sunken)", borderRadius: 12, padding: 12, color: "var(--c-text)", resize: "vertical" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="n-btn" disabled={!ready || busy || !input.trim()} onClick={() => void send()}>
          {busy ? (ar ? "جارٍ الاختبار…" : "Testing…") : (ar ? "إرسال إلى المرشح" : "Send to candidate")}
        </button>
        {busy && <button type="button" className="n-btn n-ghost" onClick={() => void stop()}>⏹ {ar ? "إيقاف" : "Stop"}</button>}
        <button type="button" className="n-btn n-ghost" onClick={() => { void checkStatus().catch(() => undefined); void refreshHistory().catch(() => undefined); }}>
          ↻ {ar ? "تحديث" : "Refresh"}
        </button>
      </div>
      <p className="n-meta" style={{ marginTop: 10 }}>
        {ar
          ? "الفحص الحالي نصي. استدعاءات GitHub وVercel التي يقترحها النموذج تظهر في سجل الحدث فقط ولا تُنفّذ."
          : "This round is text-only. GitHub/Vercel calls proposed by the model are logged for inspection, never executed."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- Home
const CAT: Record<string, "cat_dev" | "cat_prod"> = { github: "cat_dev", gitlab: "cat_dev", vercel: "cat_dev", supabase: "cat_dev", gmail: "cat_prod", google_drive: "cat_prod", google_calendar: "cat_prod", notion: "cat_prod", slack: "cat_prod", discord: "cat_prod" };
function useBilling(on: boolean) {
  const [b, setB] = useState<Billing | null>(null);
  const load = useCallback(() => api<Billing>("billing").then(setB).catch(() => null), []);
  useEffect(() => { if (on) void load(); }, [on, load]);
  return { b, load };
}
/** The owner's load switch: media smaller, free-plan limits lower, visible queue, overflow Studios first (server: src/lib/pressureMode.ts). */
function PressureCard({ n }: { n: NStr }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { api<{ on: boolean }>("pressure", {}).then((d) => setOn(d.on)).catch(() => null); }, []);
  return (
    <Card>
      <div className="n-token">
        <div className="n-body"><div className="n-lbl">{n.pressureTitle}</div><div className="n-sub">{n.pressureDesc}</div></div>
        <button type="button" className={`n-btn${on ? " n-on" : ""}`} aria-pressed={Boolean(on)} disabled={on === null} onClick={async () => { haptic("medium"); try { const d = await api<{ on: boolean }>("pressure", { on: !on }); setOn(d.on); haptic("success"); } catch { haptic("error"); } }}>{on ? n.pressureOn : n.pressureOff}</button>
      </div>
    </Card>
  );
}
function PlanCard({ c, b }: { c: Ctx; b: Billing | null }) {
  const { n, lang, owner } = c;
  if (owner) {
    return (
      <>
        <Card className="n-raise">
          <div className="n-token">
            <div className="n-body"><div className="n-lbl">{n.yourPlan}</div><div className="n-big"><span aria-hidden="true">∞</span>{n.unlimitedOwner}</div></div>
            <span className="n-chip n-on">{n.ownerChip}</span>
          </div>
        </Card>
        <PressureCard n={n} />
      </>
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
  const [connError, setConnError] = useState("");
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
    if (x.status !== "available") {
      setConnError(lang === "ar" ? `${x.name}: إعداد تسجيل الدخول غير مكتمل. افتح صفحة الموصلات لمعرفة المطلوب.` : `${x.name}: sign-in is not configured. Open Connectors for setup details.`);
      return;
    }
    haptic("medium");
    setConnError("");
    setBusy(x.id);
    try {
      const { url } = await api<{ url: string }>("connector_start", { id: x.id });
      if (!url || !url.startsWith("https://")) throw new Error("The connector did not return a valid HTTPS sign-in URL.");
      openExternal(url);
    } catch (e: any) {
      haptic("error");
      setConnError(`${x.name}: ${e?.message || (lang === "ar" ? "تعذّر بدء التوصيل." : "Could not start connection.")}`);
    } finally { setBusy(""); }
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
        {owner && models?.donorTests?.find((x) => x.selected) && (
          <DonorTestPanel key={models.trialSelected || "donor"} c={c} candidate={models.donorTests.find((x) => x.selected)!} revision={models} />
        )}
        <PlanCard c={c} b={b} />
        {live && (live.pending.length > 0 || live.live.length > 0) && (
          <>
            <Head lang={lang} title={n.runningNow} action={live.live.length > 0 ? <button type="button" className="n-link" onClick={async () => { haptic("warning"); try { await api("stop_all", {}); haptic("success"); } catch { haptic("error"); } void loadLive(); }}>{n.stopAll}</button> : undefined} />
            {live.pending.map((p) => <div key={p.nonce} className="n-card n-tg"><List><PendingBanner p={p} t={t} cats={me.prefs.categories} lang={lang} onDone={loadLive} /></List></div>)}
            {live.live.length > 0 && (
              <Card>
                {live.live.map((x) => (
                  <Row key={x.run_id} icon={srcIcon(x.source)} title={x.title || "—"} sub={`${tx(t, `status_${x.status}`)} · ${ago(x.updated_at, t)}`}
                    after={<><button type="button" className="n-link" aria-label={t.stop} onClick={async (e) => { e.stopPropagation(); haptic("warning"); try { await api("task_stop", { runId: x.run_id }); haptic("success"); } catch { haptic("error"); } void loadLive(); }}>⏹ {t.stop}</button><span className="n-dot" aria-hidden="true" /></>} onClick={() => (x.thread_id ? open({ k: "thread", id: x.thread_id, title: x.title }) : go("chats"))} />
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
          {!conns ? <Loading /> : conns.filter((x) => x.status !== "setup").slice(0, 6).map((x) => (   /* a service that is not set up yet ("soon") is not offered here: it lives in the Connectors page */
            <Row key={x.id} icon={<BrandIcon c={x} />} title={x.name} sub={x.status === "connected" ? `${t.connected}${x.label ? ` · ${x.label}` : ""}` : x.desc[lang]}
              badge={CAT[x.id] ? <span className="n-cat">{n[CAT[x.id]]}</span> : undefined}
              after={x.status === "connected" ? <span className="n-plus n-ok" aria-label={t.connected}>✓</span>
                : <button type="button" className="n-plus" aria-label={`${t.connect} ${x.name}`} disabled={busy === x.id} onClick={(e) => { e.stopPropagation(); void start(x); }}>{busy === x.id ? "…" : "+"}</button>} />
          ))}
        </Card>
        {connError && <div role="alert" className="mt-2 rounded-xl border border-[var(--c-danger)]/40 bg-[var(--c-danger-soft)] px-3 py-2 text-sm text-[var(--c-danger)]" dir="auto">
          <div>{connError}</div>
          <button type="button" className="mt-2 font-semibold underline" onClick={() => { setConnError(""); open({ k: "connect" }); }}>{lang === "ar" ? "فتح إعدادات الموصلات" : "Open connector settings"}</button>
        </div>}
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
  // each model has its own chat list: Nova, Sham, Sham v2 (the ones this person may use)
  const canon = (x?: string) => (x === "sham_loop" ? "sham" : x || "coder");
  const [model, setModel] = useState<string>("all");           // ONE list of every conversation of every model; a model tab only filters it
  const [avail, setAvail] = useState<{ id: string; name: string }[]>([{ id: "all", name: n.ch_all }, { id: "coder", name: "Nova AI" }]);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    api<Models>("models").then((m) => setAvail([{ id: "all", name: n.ch_all }, ...(m.owner || m.models).filter((x) => x.id === "coder" || x.id === "sham" || x.id === "sham_v2").map((x) => ({ id: x.id, name: x.name[lang] || x.name.en }))])).catch(() => null);
  }, [lang]);
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
    try { await api("chat_new", model === "all" ? {} : { model }); setNote(true); haptic("success"); setBump((x) => x + 1); void load(); } catch { haptic("error"); } finally { setBusy(false); }
  };
  const isLive = (s: string) => s === "running" || s === "waiting";
  return (
    <div className="n-page">
      <div className="n-ph" lang={lang}>
        <h1>{n.chatsTitle}</h1>
        {!fallback && <button type="button" className="n-fab" aria-label={t.newChat} onClick={fresh} disabled={busy}>+</button>}
      </div>
      {avail.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }} role="tablist">
          {avail.map((m) => (
            <button key={m.id} type="button" role="tab" aria-selected={m.id === model} className={`n-btn${m.id === model ? "" : " n-ghost"}`} style={{ height: 34, padding: "0 14px", fontSize: 13 }}
              onClick={() => { haptic("select"); setModel(m.id); setNote(false); }}>{m.name}</button>
          ))}
        </div>
      )}
      {/* Live terminal lives ONLY inside the Chats tab — never sends messages to the bot */}
      {me.features?.terminal && (           /* the terminal is the owner's and the paid plans' only: hidden for the free plan (the API refuses it too) */
        <div style={{ margin: "0 0 16px", minHeight: 180 }}>
          <TerminalScreen lang={lang} model={me?.settings.model || "coder"} compact />
        </div>
      )}
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
            <ChatsOfModel key={model} c={c} model={model} bump={bump} live={d.live} onNew={fresh} />
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
// One model's chat list: search, pinned first, archive filter, select + bulk delete, clean-up of old / archived ones, "continue" by opening a chat.
function ChatsOfModel({ c, model, bump, live, onNew }: { c: Ctx; model: string; bump: number; live: (Task & { thread_id?: string })[]; onNew: () => void }) {
  const { t, n, lang, open } = c;
  const [q, setQ] = useState("");
  const [view, setView] = useState<"exclude" | "only">("exclude");
  const [d, setD] = useState<ChatList | null>(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [manage, setManage] = useState(false);
  const load = useCallback(async () => {
    try { setD(await api<ChatList>("chats", { model, q: q.trim() || undefined, archived: view, limit: 100 })); setErr(""); } catch (e: any) { setErr(e.message); }
  }, [model, q, view]);
  useEffect(() => {
    const h = setTimeout(() => void load(), q ? 250 : 0);                                // search is typed: wait a moment between keys
    const iv = setInterval(() => document.visibilityState === "visible" && !sel && load(), 6000);
    return () => { clearTimeout(h); clearInterval(iv); };
  }, [load, bump, sel, q]);
  const del = async (spec: object, label: string) => {
    if (!(await guard(label))) return;
    try {
      if (model !== "all") await api("chat_delete", { model, ...spec });
      else if ("ids" in spec) {                                                              // a selection across models: one delete per model
        const by = new Map<string, string[]>();
        for (const x of d?.items || []) if ((spec as { ids: string[] }).ids.includes(x.id)) by.set(x.model || "coder", [...(by.get(x.model || "coder") || []), x.id]);
        for (const [m, ids] of by) await api("chat_delete", { model: m, ids });
      } else for (const m of new Set((d?.items || []).map((x) => x.model || "coder"))) await api("chat_delete", { model: m, ...spec });
      haptic("success"); setSel(null); setManage(false); void load();
    } catch { haptic("error"); }
  };
  const isLive = (s: string) => s === "running" || s === "waiting";
  if (err && !d) return <Fail t={t} msg={err} retry={load} />;
  const items = d?.items || [];
  const pinned = items.filter((x) => x.pinned), rest = items.filter((x) => !x.pinned);
  const row = (h: ChatItem) => {
    const running = live.some((x) => x.thread_id === h.id && isLive(x.status));
    const on = sel?.has(h.id);
    return (
      <Row key={h.id} icon={sel ? (on ? "☑️" : "⬜") : h.pinned ? "📌" : "💬"} title={h.title || t.untitled}
        badge={h.current ? <span className="n-chip n-on">{t.currentChat}</span> : undefined}
        sub={`${ago(h.updated_at, t)}${h.turns ? ` · ${h.turns} ${n.messages}` : ""}${h.preview ? ` · ${h.preview}` : ""}`.slice(0, 160)}
        after={running ? <span className="n-dot" aria-hidden="true" /> : undefined}
        onClick={() => {
          if (sel) { const m = new Set(sel); if (m.has(h.id)) m.delete(h.id); else m.add(h.id); setSel(m); return; }
          const hm = h.model || model;
          open(hm === "coder" ? { k: "thread", id: h.id, title: h.title || t.untitled } : { k: "chat", model: hm, id: h.id, title: h.title || t.untitled, pinned: h.pinned, archived: h.archived });
        }} />
    );
  };
  return (
    <>
      <div style={{ display: "flex", gap: 8, margin: "0 0 10px", alignItems: "center" }}>
        <input type="search" value={q} placeholder={`🔎 ${n.ch_search}`} dir="auto" maxLength={80} aria-label={n.ch_search} onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 999, border: "1px solid var(--n-line, rgba(127,127,127,.3))", padding: "0 14px", background: "var(--n-surface)", color: "var(--n-ink)", font: "inherit" }} />
        <button type="button" className="n-btn n-ghost" style={{ height: 40, padding: "0 12px" }} onClick={() => { haptic("select"); setSel(sel ? null : new Set()); }}>{sel ? n.ch_done : n.ch_select}</button>
      </div>
      <div style={{ display: "flex", gap: 8, margin: "0 0 10px" }}>
        {(["exclude", "only"] as const).map((v) => (
          <button key={v} type="button" className={`n-btn${view === v ? "" : " n-ghost"}`} style={{ height: 30, padding: "0 12px", fontSize: 12 }} onClick={() => setView(v)}>{v === "exclude" ? n.ch_active : n.ch_archived}</button>
        ))}
        <button type="button" className="n-btn n-ghost" style={{ height: 30, padding: "0 12px", fontSize: 12, marginInlineStart: "auto" }} onClick={() => setManage(!manage)}>🧹 {n.ch_manage}</button>
      </div>
      {sel && (
        <div className="n-wrap" style={{ margin: "0 0 10px" }}>
          <button type="button" className="n-btn n-wide" disabled={!sel.size} style={{ background: "var(--n-danger)" }} onClick={() => del({ ids: [...sel] }, `${n.ch_delSel} (${sel.size})`)}>🗑 {n.ch_delSel} · {sel.size} {n.ch_selected}</button>
        </div>
      )}
      {manage && (
        <Card>
          <Row icon="🗄️" title={n.ch_delArch} tone="var(--n-danger)" chevron={false} onClick={() => del({ archived: true }, n.ch_delArch)} />
          <Row icon="⏳" title={n.ch_delOld} tone="var(--n-danger)" chevron={false} onClick={() => del({ olderThanDays: 30 }, n.ch_delOld)} />
          <Row icon="🧨" title={n.ch_delAll} sub={n.ch_sure} tone="var(--n-danger)" chevron={false} onClick={() => del({ all: true }, n.ch_delAll)} />
        </Card>
      )}
      {!d ? <Loading /> : items.length === 0 ? (
        <Card>
          <div className="n-empty">
            <div className="n-mark"><Mark size={52} color="var(--n-primary)" /></div>
            <div style={{ marginBottom: 14 }}>{q ? n.ch_noMatch : t.noChats}</div>
            {!q && view === "exclude" && <button type="button" className="n-btn" onClick={onNew}>+ {n.startChat}</button>}
          </div>
        </Card>
      ) : (
        <>
          {pinned.length > 0 && <Card title={n.ch_pinned}>{pinned.map(row)}</Card>}
          {rest.length > 0 && <Card>{rest.map(row)}</Card>}
        </>
      )}
    </>
  );
}

/** A Sham / Sham v2 chat: its full history, continue, rename, pin, archive, delete. */
function ChatPage({ c, model, id, pinned: p0, archived: a0, onGone }: { c: Ctx; model: string; id: string; pinned: boolean; archived: boolean; onGone: () => void }) {
  const { t, n } = c;
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; text: string; at?: string }[] | null>(null);
  const [err, setErr] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [pinned, setPinned] = useState(p0), [archived, setArchived] = useState(a0);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setMsgs((await api<{ messages: { role: "user" | "assistant"; text: string; at?: string }[] }>("chat_messages", { model, id })).messages); setErr(""); } catch (e: any) { setErr(e.message); } }, [model, id]);
  useEffect(() => { void load(); }, [load]);
  if (err && !msgs) return <div className="n-page"><Fail t={t} msg={err === "not found" ? "المحادثة غير موجودة أو حُذفت" : err} retry={load} /></div>;
  if (!msgs) return <Loading />;
  const cont = async () => { setBusy(true); haptic("medium"); try { await api("chat_open", { model, id }); closeApp(); } finally { setBusy(false); } };
  return (
    <div style={{ paddingTop: 8 }}>
      {!msgs.length && <div className="n-empty">{t.noMessages}</div>}
      {msgs.map((m, i) => <div key={i} className={`n-bubble ${m.role === "user" ? "n-me" : "n-bot"}`} dir="auto">{m.text.slice(0, 4000)}</div>)}
      <div className="n-wrap" style={{ marginTop: 16 }}>
        <button type="button" className="n-btn n-wide" disabled={busy} onClick={cont}>💬 {n.ch_cont}</button>
        <p className="n-meta" style={{ margin: "8px 4px 16px" }}>{n.ch_contHint}</p>
        <Card>
          <Row icon="📌" title={pinned ? n.ch_unpin : n.ch_pin} chevron={false} onClick={async () => { await api("chat_pin", { model, id, pinned: !pinned }); setPinned(!pinned); if (!pinned) setArchived(false); haptic("success"); }} />
          <Row icon="🗄️" title={archived ? n.ch_unarchive : n.ch_archive} chevron={false} onClick={async () => { await api("chat_archive", { model, id, archived: !archived }); setArchived(!archived); if (!archived) setPinned(false); haptic("success"); }} />
          {name === null ? <Row icon="✏️" title={t.rename} onClick={() => setName("")} />
            : (
              <div className="n-tg">
                <List><Input header={t.rename} value={name} maxLength={80} dir="auto" onChange={(e) => setName(e.target.value)} /></List>
                <div style={{ padding: "0 16px 14px" }}>
                  <button type="button" className="n-btn" disabled={!name.trim()} onClick={async () => { await api("chat_rename", { model, id, title: name }); haptic("success"); setName(null); }}>{t.save}</button>
                </div>
              </div>
            )}
          <Row icon="🗑" title={t.hideChat} sub={n.ch_sure} tone="var(--n-danger)" chevron={false}
            onClick={async () => { if (!(await guard(t.hideChat))) return; await api("chat_delete", { model, ids: [id] }); haptic("success"); onGone(); }} />
        </Card>
      </div>
    </div>
  );
}

type ThreadTask = { run_id: string; title: string; status: string; started_at: string; finished_at: string | null; events: Ev[] };
function ThreadPage({ c, id, onGone }: { c: Ctx; id: string; onGone: () => void }) {
  const { t, n } = c;
  const [d, setD] = useState<{ thread: Thread & { pinned?: boolean; archived?: boolean }; current: boolean; tasks: ThreadTask[] } | null>(null);
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
  if (err && !d) return <div className="n-page"><Fail t={t} msg={err === "not found" ? "المحادثة غير موجودة أو حُذفت" : err} retry={load} /></div>;
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
      {/* Terminal for this conversation — logs stay in Mini App only */}
      {(() => {
        const active = d.tasks.find((k) => live(k.status));
        return active ? <div style={{ margin: "12px 0" }}><TerminalScreen lang={c.lang} model="coder" fixedRunId={active.run_id} compact /></div> : null;
      })()}
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
          <Row icon="📌" title={d.thread.pinned ? n.ch_unpin : n.ch_pin} chevron={false} onClick={async () => { await api("chat_pin", { model: "coder", id, pinned: !d.thread.pinned }); haptic("success"); void load(); }} />
          <Row icon="🗄️" title={d.thread.archived ? n.ch_unarchive : n.ch_archive} chevron={false} onClick={async () => { await api("chat_archive", { model: "coder", id, archived: !d.thread.archived }); haptic("success"); void load(); }} />
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
  useEffect(() => setS(me.settings), [me.settings]);                       // a model switch reloads `me`: show that model's own switches
  const [sheet, setSheet] = useState<"" | "theme" | "lang" | "acc" | "tz" | "force" | "policy">("");
  const isSham = s.model === "sham" || s.model === "sham_v2" || s.model === "sham_loop";
  const [known, setKnown] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setKnown(null);
    if (isSham) void api<{ facts: Record<string, string> }>("sham_memory", { model: s.model }).then((d) => setKnown(d.facts)).catch(() => setKnown({}));
  }, [s.model, isSham]);
  const mem = s.memory || { remember: true, recall: true, save: true };
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
    try { await api("settings", p); haptic("success"); if (p.lang) reload(); } catch { setS(prev); haptic("error"); }
  };
  const closeSheet = useCallback(() => setSheet(""), []);
  // the time zone decides when weekly usage resets and when scheduled tasks run: a user who never chose one gets the device's own zone
  const deviceTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
  useEffect(() => { if (!me.settings.tz && deviceTz) void set({ tz: deviceTz }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const TZS = ["Asia/Damascus", "Asia/Riyadh", "Asia/Baghdad", "Asia/Amman", "Asia/Beirut", "Asia/Dubai", "Africa/Cairo", "Africa/Casablanca", "Europe/Istanbul", "UTC"];
  const tzItems = [...new Set([deviceTz, ...TZS].filter(Boolean))].map((z) => ({ id: z, label: z, sub: z === deviceTz ? (lang === "ar" ? "منطقة جهازك" : "Your device's zone") : undefined }));
  const acc = s.accuracy || "balanced";
  const pol = s.policy || (s.think ? "always" : "adaptive");     // the thinking policy of the selected model (src/lib/modes.ts)
  const forcedNow = (s.forced || {})[s.model === "nova" ? "coder" : s.model] as "fast" | "balanced" | "precise" | undefined;   // the owner's forced mode for this model (all users), if any
  const themeLabel = { auto: n.th_auto, light: n.th_light, black: n.th_black, oled: n.th_oled }[mode];
  const planLabel = owner ? `∞ ${n.unlimitedOwner}` : b ? b.usage.plan.name[lang] : "…";
  const gh = me.connections.github;
  return (
    <div className="n-page">
      <div className="n-ph" lang={lang}><h1>{n.navSettings}</h1></div>
      <Card title={`${n.s_forModel}: ${modelName(models, lang)}`}>
        <Row icon="🧠" title={n.s_think} sub={t.thinkingHint} value={n[`pol_${pol}` as "pol_adaptive"]} onClick={() => setSheet("policy")} />
        <Row icon="🎯" title={n.s_acc} value={tx(t, `acc_${acc}`)} onClick={() => setSheet("acc")} />
        {owner && <Row icon="🔒" title={n.s_force} sub={n.s_forceSub} value={forcedNow ? tx(t, `acc_${forcedNow}`) : n.force_none} onClick={() => setSheet("force")} />}
        <Row icon="🛡️" title={n.s_policy} onClick={() => open({ k: "policy" })} />
      </Card>
      <Card title={`${n.m_title}: ${modelName(models, lang)}`}>
        <Row icon="🧬" title={n.m_remember} sub={n.m_rememberSub} after={<span dir="ltr" style={{ display: "inline-flex" }}><Switch checked={mem.remember} aria-label={n.m_remember} onChange={(e) => set({ memory: { ...mem, remember: e.currentTarget.checked } })} /></span>} />
        <Row icon="📖" title={n.m_recall} sub={n.m_recallSub} after={<span dir="ltr" style={{ display: "inline-flex" }}><Switch checked={mem.recall} aria-label={n.m_recall} onChange={(e) => set({ memory: { ...mem, recall: e.currentTarget.checked } })} /></span>} />
        <Row icon="💾" title={n.m_save} sub={n.m_saveSub} after={<span dir="ltr" style={{ display: "inline-flex" }}><Switch checked={mem.save} aria-label={n.m_save} onChange={(e) => set({ memory: { ...mem, save: e.currentTarget.checked } })} /></span>} />
        {isSham && (
          <>
            <Row icon="🧾" title={n.m_known} chevron={false} sub={known ? (Object.keys(known).length ? Object.entries(known).map(([k, v]) => `${k}: ${v}`).join(" · ") : n.m_none) : "…"} />
            <Row icon="🗑" title={n.m_forget} sub={n.m_forgetQ} tone="var(--n-danger)" chevron={false}
              onClick={async () => { if (!(await guard(n.m_forget))) return; await api("sham_memory", { model: s.model, forget: true }); haptic("success"); setKnown({}); }} />
          </>
        )}
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
      <Options open={sheet === "policy"} title={n.s_think} value={pol} onClose={closeSheet} onPick={(v) => set({ policy: v as "adaptive" | "always" | "never", think: v === "always" })}
        items={(["adaptive", "always", "never"] as const).map((x) => ({ id: x as string, label: n[`pol_${x}` as "pol_adaptive"], sub: n[`pol_${x}Sub` as "pol_adaptiveSub"] }))} />
      <Options open={sheet === "force"} title={n.s_force} value={forcedNow || ""} onClose={closeSheet}
        onPick={async (v) => { try { const d = await api<{ forced: Record<string, string> }>("mode_force", { for: s.model, mode: v || "" }); setS({ ...s, forced: d.forced }); haptic("success"); } catch { haptic("error"); } }}
        items={[{ id: "", label: n.force_none, sub: n.force_noneSub }, ...(["fast", "balanced", "precise"] as const).map((a) => ({ id: a as string, label: tx(t, `acc_${a}`), sub: tx(t, `accHint_${a}`) }))]} />
      <Options open={sheet === "tz"} title={n.s_tz} value={s.tz || deviceTz} onClose={closeSheet} onPick={(v) => set({ tz: String(v) })} items={tzItems} />
      <ModelPopover at={pop} d={models} lang={lang} n={n} onPicked={() => { reloadModels(); void reload(); }} onClose={() => setPop(null)} />
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
  const pageTitle = !page ? "" : page.k === "thread" || page.k === "chat" ? page.title : page.k === "billing" ? t.billing : page.k === "pricing" ? n.s_pricing : page.k === "panel" ? n.s_panel
    : page.k === "connect" ? t.tabConnectors : page.k === "memory" ? n.s_mem : n.s_policy;
  return (
    <AppRoot appearance={appearance} platform={platform} dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="nova"
      style={{ ...vars, paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
      <main className={`n-main${page ? " n-sub" : ""}`}>
        {err === "__tg" ? <div className="n-page"><Card><div className="n-empty"><div className="n-mark"><Mark size={52} color="var(--n-primary)" /></div>{t.openInTelegram}</div></Card></div>
          : err ? <div className="n-page"><Fail t={t} msg={err} retry={reload} /></div>
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
                : page.k === "chat" ? <ChatPage key={page.id} c={ctx} model={page.model} id={page.id} pinned={page.pinned} archived={page.archived} onGone={closePage} />
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
              {NAV_KEY[id] ? n[NAV_KEY[id]!] : NAV_LABEL[id][lang]}
            </button>
          ))}
        </nav>
      )}
    </AppRoot>
  );
}
