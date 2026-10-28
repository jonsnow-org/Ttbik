/**
 * The progress card of a request (owner 2026-10-28): ONE Telegram message, shared by every model (Nova, Sham v2, Sham), written from REAL events only:
 *   - the "understood" line is written by the model itself (a tiny, strictly time-boxed call, thinking off); if the model does not answer in time the card says a
 *     neutral "استلمت طلبك" and the real line is put in later if it still arrives before the answer; the user's text is never echoed back as a template;
 *   - every step is something that happened: a phase of the model (thinking / writing / queued / reading the prompt), a tool the agent really called
 *     (قراءة ملف path, تعديل ملف path, تشغيل أمر …), or sending; each with its exact clock time (Istanbul) and how long it took.
 * Pure module (no Nova / Sham imports): the models feed it events and Telegram edits are done by the callers (singleMessage.ts for Sham, coderSections.ts for Nova).
 */
export type StepKind = "phase" | "tool";
export type Step = { t0: number; t1?: number; kind: StepKind; key: string; label: string; ok?: boolean };
export type Timeline = { startedAt: number; ack?: string; steps: Step[] };

/** The zone of the clock on the card. The owner is in Istanbul (UTC+3); CARD_TZ / CODER_DEFAULT_TZ override. */
export function cardTz(): string {
  const z = (process.env.CARD_TZ || process.env.CODER_DEFAULT_TZ || "Europe/Istanbul").trim();
  try { new Intl.DateTimeFormat("en", { timeZone: z }); return z; } catch { return "Europe/Istanbul"; }
}
export const clockAt = (t: number, tz = cardTz()): string => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: tz });
export const dateAt = (t: number, tz = cardTz()): string => new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(new Date(t)).replace("،", "");
export function fmtDur(ms: number): string {
  if (ms < 950) return `${(Math.max(0, ms) / 1000).toFixed(1)}ث`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}ث`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}د ${String(s % 60).padStart(2, "0")}ث`;
}

export function newTimeline(now = Date.now()): Timeline { return { startedAt: now, steps: [] }; }

/** Closes the step that is still running (it ends now). */
export function endStep(tl: Timeline, ok = true, now = Date.now()): void {
  const last = tl.steps[tl.steps.length - 1];
  if (last && last.t1 === undefined) { last.t1 = now; last.ok = ok; }
}
/** Something new started: the running step ends and this one begins. A phase of the same `key` already running only gets its label refreshed (e.g. reading 40% → 70%). */
export function beginStep(tl: Timeline, kind: StepKind, key: string, label: string, now = Date.now()): boolean {
  const last = tl.steps[tl.steps.length - 1];
  if (last && last.t1 === undefined && last.kind === "phase" && kind === "phase" && last.key === key) { last.label = label; return false; }
  endStep(tl, true, now);
  tl.steps.push({ t0: now, kind, key, label: label.replace(/\s+/g, " ").trim().slice(0, 160) });
  if (tl.steps.length > 60) tl.steps.splice(0, tl.steps.length - 60);
  return true;
}

// ---- the model's own "understood" line
export const NEUTRAL_ACK = "استلمت طلبك وأعمل عليه الآن.";
export function understandingPrompt(request: string): string {
  return `User request:\n${String(request || "").replace(/\s+/g, " ").trim().slice(0, 500)}\n\nIn the SAME language as the request, write ONE short sentence (max 18 words) saying what you understood the user wants and what you will do first. First person, plain words. Do not answer the request, do not use tools, do not quote the request.`;
}
/** The model's line made safe for the card: one line, no thinking markup, no tool plan, not a copy of the request; null when it is not usable. */
export function cleanUnderstanding(raw: string, request = ""): string | null {
  let t = String(raw || "").replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").replace(/<\/?[a-z_]+>/gi, " ").replace(/```[\s\S]*?```/g, " ");
  if (/tool_call|"name"\s*:|"arguments"\s*:/.test(t)) return null;
  t = t.replace(/^[\s"'«»*#>\-–—•]+|[\s"'«»]+$/g, "").replace(/\s+/g, " ").trim();
  t = t.split(/(?<=[.!؟?۔])\s/)[0] || t;                       // the first sentence only
  if (t.length < 6) return null;
  if (t.length > 160) t = `${t.slice(0, 157).trimEnd()}…`;
  const norm = (x: string) => x.replace(/[\s\p{P}]+/gu, "").toLowerCase();
  const r = norm(request);
  if (r.length > 12 && norm(t).includes(r.slice(0, Math.min(r.length, 60)))) return null;   // an echo of the request is no understanding
  return t;
}
/** Asks the model for its line within `ms` (default 3 s). `late` is the same call kept alive for `lateMs` more: whatever it returns after the cap is handed to `onLate`. Never throws. */
export async function understandRequest(ask: () => Promise<string | null | undefined>, request: string, opts: { ms?: number; lateMs?: number; onLate?: (line: string) => void } = {}): Promise<string | null> {
  const ms = opts.ms ?? (Number(process.env.CARD_ACK_MS) || 3000);
  const work = Promise.resolve().then(ask).then((x) => cleanUnderstanding(String(x || ""), request)).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<"cap">((res) => { timer = setTimeout(() => res("cap"), ms); });
  const first = await Promise.race([work, cap]);
  if (timer) clearTimeout(timer);
  if (first !== "cap") return first;
  if (opts.onLate) {
    const lateMs = opts.lateMs ?? 9000;
    let t2: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([work, new Promise<null>((res) => { t2 = setTimeout(() => res(null), lateMs); })]).then((l) => { if (t2) clearTimeout(t2); if (l) opts.onLate!(l); });
  }
  return null;
}

// ---- what a tool step says (plain Arabic, with the real path / command / query)
const short = (v: unknown, n = 70) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const host = (u: string) => { try { const x = new URL(u); return short(x.host + (x.pathname === "/" ? "" : x.pathname), 60); } catch { return short(u, 60); } };
function parse(args: unknown): Record<string, any> {
  if (args && typeof args === "object") return args as Record<string, any>;
  try { const o = JSON.parse(String(args || "{}")); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
const withRepo = (a: Record<string, any>, p: string) => (a.repo ? `${short(a.repo, 40)}:${short(p, 60)}` : short(p, 70));
export const stepLabel = (name: string, args?: unknown): string => rawLabel(name, args).replace(/\s+/g, " ").trim();
function rawLabel(name: string, args?: unknown): string {
  const a = parse(args);
  switch (name) {
    case "sandbox_read_file": return `قراءة ملف ${short(a.path)}`;
    case "github_read_file": return `قراءة ملف ${withRepo(a, a.path)}`;
    case "github_read_files": return `قراءة ${Array.isArray(a.paths) ? a.paths.length : "عدة"} ملفات${a.repo ? ` من ${short(a.repo, 40)}` : ""}`;
    case "sandbox_edit_file": return `تعديل ملف ${short(a.path)}`;
    case "github_edit_file": return `تعديل ملف ${withRepo(a, a.path)}`;
    case "sandbox_write_file": return `كتابة ملف ${short(a.path)}`;
    case "github_write_files": return `كتابة تعديلات في ${short(a.repo || "المستودع", 40)}${a.branch ? ` (${short(a.branch, 30)})` : ""}`;
    case "github_delete_files": return `حذف ملفات من ${short(a.repo || "المستودع", 40)}`;
    case "sandbox_exec": return `تشغيل أمر: ${short(a.command, 80)}`;
    case "sandbox_wait": return "انتظار انتهاء الأمر";
    case "sandbox_clone": return `نسخ المستودع ${short(a.repo, 40)}`;
    case "sandbox_push": return `رفع التعديلات إلى ${short(a.repo, 40)}@${short(a.branch, 30)}`;
    case "sandbox_search": return `بحث في ملفات الجهاز: ${short(a.pattern || a.glob, 50)}`;
    case "github_search_code": return `بحث في الكود: ${short(a.query, 50)}${a.repo ? ` (${short(a.repo, 40)})` : ""}`;
    case "github_search_repos": return `بحث عن مستودعات: ${short(a.query, 50)}`;
    case "github_list_files": return `استعراض ملفات ${short(a.repo, 40)}${a.path ? `/${short(a.path, 40)}` : ""}`;
    case "github_repo_scan": return `مسح المستودع ${short(a.repo, 40)}`;
    case "github_repo_info": return `معلومات المستودع ${short(a.repo, 40)}`;
    case "github_list_prs": return `عرض طلبات الدمج في ${short(a.repo, 40)}`;
    case "github_pr_info": return `قراءة طلب الدمج ${short(a.repo, 40)}#${short(a.number, 8)}`;
    case "github_list_issues": return `عرض المشكلات في ${short(a.repo, 40)}`;
    case "github_commits": return `قراءة آخر الإيداعات في ${short(a.repo, 40)}`;
    case "github_ci_status": case "github_ci_logs": return `فحص CI في ${short(a.repo, 40)}`;
    case "github_create_pr": return `فتح طلب دمج ${short(a.head, 30)} ← ${short(a.base, 30)}`;
    case "github_merge_pr": return `دمج طلب ${short(a.repo, 40)}#${short(a.number, 8)}`;
    case "github_create_branch": return `إنشاء فرع ${short(a.branch, 40)}`;
    case "web_search": return `بحث في الويب: ${short(a.query, 60)}`;
    case "fetch_page": case "web_fetch": return `قراءة صفحة ${host(String(a.url || ""))}`;
    case "deep_research": return `بحث معمّق: ${short(a.question || a.query, 60)}`;
    case "http_request": return `طلب ${short(a.method || "GET", 6).toUpperCase()} ${host(String(a.url || ""))}`;
    case "make_media": return a.kind === "video" ? "توليد فيديو" : a.kind === "audio" ? "توليد صوت" : "توليد صورة";
    case "view_image": return "النظر إلى صورة";
    case "view_video": return "النظر إلى لقطات فيديو";
    case "send_file": return `إرسال ملف ${short(a.path)}`;
    case "memory_save": case "memory_note": return "حفظ في الذاكرة";
    case "memory_search": case "recall": return "بحث في الذاكرة";
    case "memory_forget": return "نسيان ذكرى";
    case "schedule_create": return `جدولة مهمة: ${short(a.title, 50)}`;
    case "schedule_list": return "عرض المهام المجدولة";
    case "schedule_delete": return "حذف مهمة مجدولة";
    case "connector_api": return `طلب من ${short(a.service, 30)}: ${short(a.path, 40)}`;
    case "mcp_list_tools": return `أدوات خادم ${short(a.server, 30)}`;
    case "mcp_call": return `أداة ${short(a.tool, 30)} على ${short(a.server, 30)}`;
    case "ask_user": return "سؤال للمستخدم";
    case "delegate": {
      const n = Array.isArray(a.tasks) ? a.tasks.length : a.task ? 1 : 0;
      return `تكليف ${n || ""} ${n === 1 ? "وكيل" : "وكلاء"}`.replace(/\s+/g, " ").trim();
    }
    case "load_tools": return "تجهيز الأدوات";
    default: return `أداة ${name}`;
  }
}

// ---- the card text
const ICON_DONE = "✅", ICON_FAIL = "❌", ICON_RUN = "▶️";
export function renderTimeline(tl: Timeline, now = Date.now(), opts: { maxSteps?: number; tail?: string[] } = {}): string {
  const max = opts.maxSteps ?? 9;
  const hidden = Math.max(0, tl.steps.length - max);
  const shown = tl.steps.slice(-max);
  const rows = shown.map((s) => {
    const running = s.t1 === undefined;
    const clock = clockAt(s.t0);
    const body = running ? (s.kind === "tool" ? `جاري التنفيذ · ${s.label}` : s.label) : s.label;
    const dur = running ? (now - s.t0 >= 3000 ? ` · منذ ${fmtDur(now - s.t0)}` : "") : ` · ${fmtDur((s.t1 as number) - s.t0)}`;
    return `${running ? ICON_RUN : s.ok === false ? ICON_FAIL : ICON_DONE} ${clock}  ${body}${running && !/[.…]$/.test(body) && s.kind === "phase" ? "…" : ""}${dur}`;
  });
  const head = `🕒 ${dateAt(tl.startedAt)} · ${clockAt(tl.startedAt)}`;
  const ack = `💬 ${tl.ack || NEUTRAL_ACK}`;
  const mid = hidden ? `… ${hidden} خطوات سابقة\n` : "";
  const text = `${head}\n${ack}\n\n📋 التقدم · ${fmtDur(now - tl.startedAt)}\n${mid}${rows.length ? rows.join("\n") : `${ICON_RUN} ${clockAt(tl.startedAt)}  استلام الطلب…`}${opts.tail?.length ? `\n${opts.tail.join("\n")}` : ""}`;
  return text.slice(0, 4000);
}
