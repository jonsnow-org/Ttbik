// The owner's control panel (Mini App "panel" section and the bot's /panel), owner's order 2026-10-21. Owner only: every caller checks
// the verified Telegram id first (coderApp.ts tier, coderSections.ts tierFor).
//   training — Sham's Kaggle notebooks and Nova 1, read from the public logs of the Kaggle monitor (sham-restarter.yml) and the read-only
//              inspector (sham-kaggle-inspect.yml); the weekly GPU split is summed from the monitor's "Nova 1:" lines since the last reset
//              (Saturday 00:00 UTC). Nova 1's switch is training/nova1/kaggle/run_request.json on branch training/nova1.
//   actions  — pause / resume Nova 1's cycle (edits "done" in that file: a running session always finishes and saves) and a monitor run
//              (workflow_dispatch of sham-restarter.yml with live=1: the same pass its schedule makes, never a stop). Both go through GitHub's API with the owner's token (PANEL_GITHUB_TOKEN, else
//              CODER_GITHUB_TOKEN); without a token with that access they answer "unavailable" and change nothing.
//   users    — counts only (chats, active in 7 days, active subscriptions per plan).
//   health   — the model Studios, sandbox backends and search engines (same checks as the "status" op).
//   steps    — what only the owner can do by hand (e.g. deploying the Nova 1 Studio on ModelScope after the GGUF upload).
import { prismaDb, type Db } from "@/lib/coderAuth";

const REPO = "jonsnow-org/Ttbik";
const NOVA_BRANCH = "training/nova1";
const NOVA_FILE = "training/nova1/kaggle/run_request.json";
const WEEKLY_GPU_H = 30;
type F = typeof fetch;

const token = () => (process.env.PANEL_GITHUB_TOKEN || process.env.CODER_GITHUB_TOKEN || "").trim();
const gh = (f: F, path: string, init: RequestInit = {}) =>
  f(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", "User-Agent": "coder-panel", ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(init.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });

/** Last Saturday 00:00 UTC (Kaggle's weekly GPU-quota reset). */
export function weekStart(now = Date.now()): number {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - ((d.getUTCDay() + 1) % 7) * 86400000;
}

/** Keeps the lines that describe notebooks from a GitHub Actions job log (timestamps cut, nothing else of the log). */
export function statusLines(log: string): string[] {
  return log
    .split("\n")
    .map((l) => l.replace(/^\S+Z\s/, "").trim())
    .filter((l) => /^(دفتر \d+|Nova 1:|status: |=====|المسارات|عدد الدفاتر)/.test(l))
    .slice(0, 40);
}

/** Weekly GPU hours from the monitor's Nova 1 lines: "(… X س)" after a Sham GPU session or a Nova 1 session ended. */
export function gpuHours(lines: string[]): { sham: number; nova: number } {
  let sham = 0, nova = 0;
  for (const l of lines) {
    const m = l.match(/([\d.]+) س\)/);
    if (!m) continue;
    if (l.includes("لدفتر شام")) sham += Number(m[1]);
    else if (l.includes("انتهت جلسته")) nova += Number(m[1]);
  }
  return { sham: Math.round(sham * 10) / 10, nova: Math.round(nova * 10) / 10 };
}

let cache: { at: number; data: any } | null = null;

async function runs(f: F, wf: string, since: number, max: number) {
  const r = await gh(f, `/actions/workflows/${wf}/runs?per_page=${max}&created=>=${new Date(since).toISOString().slice(0, 10)}`).catch(() => null);
  if (!r?.ok) return [];
  const j: any = await r.json().catch(() => ({}));
  return (j.workflow_runs || []).map((x: any) => ({ id: x.id, at: x.created_at, event: x.event, conclusion: x.conclusion || x.status, url: x.html_url }));
}

async function runLines(f: F, runId: number): Promise<string[]> {
  if (!token()) return [];
  const j: any = await gh(f, `/actions/runs/${runId}/jobs`).then((r) => r.json()).catch(() => ({}));
  const job = (j.jobs || [])[0];
  if (!job) return [];
  const log = await gh(f, `/actions/jobs/${job.id}/logs`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  return statusLines(log);
}

export async function training(f: F = fetch, now = Date.now()) {
  if (cache && now - cache.at < 10 * 60000) return cache.data;
  const ws = weekStart(now);
  const [mon, insp] = await Promise.all([runs(f, "sham-restarter.yml", ws, 40), runs(f, "sham-kaggle-inspect.yml", now - 86400000, 1)]);
  const latest = mon[0] ? await runLines(f, mon[0].id) : [];
  // every monitor run of this quota week, for the GPU split (cached 10 minutes)
  const week = (await Promise.all(mon.slice(0, 40).map((r: any) => runLines(f, r.id)))).flat().filter((l) => l.startsWith("Nova 1:")).reverse();
  const used = gpuHours(week);
  const request = await f(`https://raw.githubusercontent.com/${REPO}/${NOVA_BRANCH}/${NOVA_FILE}`, { cache: "no-store", signal: AbortSignal.timeout(10000) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const data = {
    monitor: mon[0] || null,
    monitorLines: latest,
    inspector: insp[0] || null,
    inspectorLines: insp[0] ? await runLines(f, insp[0].id) : [],
    gpu: { weekStart: new Date(ws).toISOString(), nextReset: new Date(ws + 7 * 86400000).toISOString(), quotaHours: WEEKLY_GPU_H, shamHours: used.sham, novaHours: used.nova,
           leftHours: Math.max(0, Math.round((WEEKLY_GPU_H - used.sham - used.nova) * 10) / 10), rule: "sham: 1 GPU session / week, then CPU · nova1: the rest" },
    nova: { request, paused: Boolean(request?.done), notebook: "https://www.kaggle.com/code/jonsnowjonsnow/nova1-coder", lastLines: week.slice(-5) },
    logsReadable: Boolean(token()),
  };
  cache = { at: now, data };
  return data;
}

export async function users(db: Db = prismaDb) {
  const one = async (sql: string) => Number(((await db.query<any>(sql).catch(() => [])) as any[])[0]?.n || 0);
  const chats = await one(`SELECT count(*)::int AS n FROM coder_chat_state WHERE state ? 'menu'`);
  const active7d = await one(`SELECT count(*)::int AS n FROM coder_chat_state WHERE state ? 'menu' AND updated_at > now() - interval '7 days'`);
  const subs = (await db.query<any>(`SELECT plan_id, count(*)::int AS n FROM coder_subscriptions WHERE status = 'active' AND (period_end IS NULL OR period_end > now()) GROUP BY plan_id`).catch(() => [])) as any[];
  return { chats, active7d, subscriptions: Object.fromEntries(subs.map((r) => [r.plan_id, Number(r.n)])) };
}

export async function health() {
  const { coderStatus, coderStudioUrls } = await import("@/lib/openCoderStudio");
  const { sandboxHealth } = await import("@/lib/coderSandbox");
  const { searchHealth } = await import("@/lib/coderWeb");
  const status = await coderStatus(8000).catch(() => null);
  return {
    studio: { ok: Boolean(status), count: coderStudioUrls().length },
    nova1Studio: Boolean((process.env.NOVA1_STUDIO_URL || "").trim()),
    oracle: Boolean((process.env.CODER_SANDBOX_ORACLE_URL || "").trim()),
    sandbox: sandboxHealth().map((b) => ({ id: b.id, configured: b.configured, ok: b.ok })),
    search: searchHealth().map((s) => ({ name: s.name, ok: s.ok })),
  };
}

/** Owner-only manual steps still open (shown in the panel until they are done). */
export function pendingSteps() {
  const steps: { id: string; ar: string; en: string }[] = [];
  if (!(process.env.NOVA1_STUDIO_URL || "").trim())
    steps.push({ id: "nova1_studio", ar: "نشر استوديو نوفا 1 يدوياً على ModelScope بعد رفع ملف GGUF (الرفع يسلّم الملفات فقط)، ثم وضع رابطه في NOVA1_STUDIO_URL",
                 en: "Deploy the Nova 1 Studio on ModelScope by hand after the GGUF upload (uploads only deliver files), then set NOVA1_STUDIO_URL" });
  return steps;
}

export async function panel(db: Db = prismaDb, f: F = fetch) {
  const [t, u, h] = await Promise.all([training(f).catch(() => null), users(db), health().catch(() => null)]);
  return { training: t, users: u, health: h, steps: pendingSteps() };
}

/** pause | resume Nova 1's cycle, or start a monitor run. Returns a short result; never throws for a missing token. */
export async function panelAction(action: string, f: F = fetch): Promise<{ ok: boolean; message: string }> {
  if (!token()) return { ok: false, message: "no GitHub token with access (PANEL_GITHUB_TOKEN)" };
  if (action === "monitor_run") {
    const r = await gh(f, `/actions/workflows/sham-restarter.yml/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main", inputs: { live: "1" } }) }).catch(() => null);
    cache = null;
    return r && r.status === 204 ? { ok: true, message: "monitor run started" } : { ok: false, message: `GitHub refused (${r?.status ?? "network"})` };
  }
  if (action === "nova_pause" || action === "nova_resume") {
    const cur = await gh(f, `/contents/${NOVA_FILE}?ref=${encodeURIComponent(NOVA_BRANCH)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as any;
    if (!cur?.sha) return { ok: false, message: "cannot read Nova 1's switch" };
    const req = JSON.parse(Buffer.from(cur.content, "base64").toString("utf8"));
    req.done = action === "nova_pause";
    const body = { message: `Nova 1: ${action === "nova_pause" ? "pause" : "resume"} the Kaggle cycle (owner panel)`, branch: NOVA_BRANCH, sha: cur.sha,
                   content: Buffer.from(JSON.stringify(req, null, 2) + "\n").toString("base64") };
    const r = await gh(f, `/contents/${NOVA_FILE}`, { method: "PUT", body: JSON.stringify(body) }).catch(() => null);
    cache = null;
    return r?.ok ? { ok: true, message: action === "nova_pause" ? "paused: no new sessions (a running one finishes and saves)" : "resumed" }
                 : { ok: false, message: `GitHub refused (${r?.status ?? "network"})` };
  }
  return { ok: false, message: "unknown action" };
}

/** The panel as one Telegram message (bot /panel). */
export function panelText(d: Awaited<ReturnType<typeof panel>>): string {
  const t = d.training, u = d.users, h = d.health;
  const trt = (iso?: string) => (iso ? new Date(new Date(iso).getTime() + 3 * 3600000).toISOString().slice(5, 16).replace("T", " ") + " TRT" : "—");
  const out = ["🎛 لوحة المالك", ""];
  out.push("🧠 التدريب");
  if (t) {
    out.push(`GPU هذا الأسبوع: شام ${t.gpu.shamHours} س · نوفا 1 ${t.gpu.novaHours} س · الباقي ~${t.gpu.leftHours} س من ${t.gpu.quotaHours} (إعادة الضبط ${trt(t.gpu.nextReset)})`);
    out.push(`نوفا 1: ${t.nova.request?.enabled ? (t.nova.paused ? "⏸ موقوف (لا جلسات جديدة)" : "🟢 مفعّل") : "⚪ غير مفعّل"}${t.nova.request?.not_before ? ` · يبدأ بعد ${trt(t.nova.request.not_before)}` : ""}`);
    if (t.monitor) out.push(`آخر تشغيل للمراقب: ${trt(t.monitor.at)} (${t.monitor.conclusion})`);
    out.push(...t.monitorLines.filter((l: string) => l.startsWith("دفتر") || l.startsWith("Nova 1:")).slice(0, 8));
    if (!t.logsReadable) out.push("(سجلات المراقب تحتاج PANEL_GITHUB_TOKEN)");
  } else out.push("تعذّرت القراءة الآن");
  out.push("", `👥 المستخدمون: ${u.chats} · نشطون 7 أيام: ${u.active7d} · اشتراكات: ${Object.entries(u.subscriptions).map(([k, v]) => `${k} ${v}`).join("، ") || "0"}`);
  if (h) {
    out.push(`🩺 الاستوديو ${h.studio.ok ? "✅" : "❌"} (${h.studio.count}) · Oracle ${h.oracle ? "✅" : "—"} · استوديو نوفا 1 ${h.nova1Studio ? "✅" : "—"}`);
    out.push(`الصناديق: ${h.sandbox.filter((b) => b.configured).map((b) => `${b.id}${b.ok ? "✅" : "⏳"}`).join(" ") || "—"}`);
  }
  if (d.steps.length) out.push("", "📝 خطوات يدوية باقية:", ...d.steps.map((s) => `• ${s.ar}`));
  return out.join("\n").slice(0, 4000);
}
