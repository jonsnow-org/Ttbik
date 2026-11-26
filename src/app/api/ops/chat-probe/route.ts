import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaDb } from "@/lib/coderAuth";
import { getEngineUrls, hookSecret, safeEqual } from "@/lib/mediaFrontDoor";
import { shamStudioEnabled } from "@/lib/shamStudio";
import { shamAgentOn } from "@/lib/shamAgent";

/**
 * Why a plain chat message in the Nova / Sham bot does or does not get an answer. READ-ONLY (GET), no token in the output.
 *
 * A green webhook (bots-health) only proves Telegram delivered and got 200; the answer itself can still be lost after that:
 *  - the front door's engine list is empty or names a host that no longer answers,
 *  - the Sham Studio is "off" because MODELSCOPE_API_TOKEN is empty in this environment (each server has its own env),
 *  - the durable handoff (startShamDurableTask -> /api/sham/continue) was never confirmed, so the run stays "running",
 *  - or the run failed inside a stage: coder_task_events keeps the stage's own words.
 *
 * POST { text?, chat? } injects ONE synthetic private message into this server's own webhook (127.0.0.1) and returns the
 * webhook's status, so a real reply path can be proven end to end; `chat` defaults to the bot owner's Telegram id.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const host = (u: string) => {
  try { return new URL(u).host; } catch { return ""; }
};
const mask = (v: string) => (v.length <= 4 ? "…" : `${v.slice(0, 2)}…${v.slice(-2)}`);

async function tg(token: string, method: string, body?: Record<string, unknown>) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(9000),
    });
    const j = await r.json().catch(() => null);
    return (j?.ok ? j.result : { error: String(j?.description || r.status).slice(0, 160) }) as Record<string, any>;
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 120) } as Record<string, any>;
  }
}

function authed(req: NextRequest): boolean {
  const s = hookSecret();
  const cron = process.env.CRON_SECRET || "";
  const okKey = !!s && safeEqual(req.headers.get("x-ops-key") || "", s);
  const okCron = !!cron && safeEqual(req.headers.get("authorization") || "", `Bearer ${cron}`);
  return okKey || okCron;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bot = await prisma.bot
    .findFirst({ where: { template: "NOVA_BOT", isActive: true }, select: { id: true, token: true, ownerId: true, isActive: true } })
    .catch(() => null);

  const out: Record<string, unknown> = {};
  out.bot = bot ? { id: bot.id, active: bot.isActive, ownerMasked: bot.ownerId ? mask(String(bot.ownerId)) : null } : null;

  if (bot) {
    const me = await tg(bot.token, "getMe");
    const hook = await tg(bot.token, "getWebhookInfo");
    out.telegram = {
      username: me.username || null,
      webhookHost: host(String(hook.url || "")) || null,
      pending: hook.pending_update_count ?? null,
      lastErrorMessage: hook.last_error_message || null,
      lastErrorAt: hook.last_error_date ? new Date(Number(hook.last_error_date) * 1000).toISOString() : null,
      error: hook.error || me.error || null,
    };
  }

  const engines = await getEngineUrls().catch(() => [] as string[]);
  out.engines = { count: engines.length, hosts: engines.map(host) };

  out.flags = {
    shamStudioEnabled: shamStudioEnabled(),
    modelScopeApiToken: Boolean((process.env.MODELSCOPE_API_TOKEN || "").trim()),
    modelScopeAiToken: Boolean((process.env.MODELSCOPE_AI_TOKEN || "").trim()),
    shamAgent: (process.env.SHAM_AGENT || "").trim() || "(unset)",
    shamAgentOnNow: shamAgentOn(),
    selfHost: host(process.env.CODER_SELF_URL || process.env.NEXT_PUBLIC_SITE_URL || ""),
    port: process.env.PORT || "(unset)",
  };

  const tasks = await prismaDb
    .query<any>(
      `SELECT run_id, slot, source, status, title, updated_at FROM coder_tasks WHERE slot LIKE 'sham%' OR run_id LIKE 'sham-%' ORDER BY updated_at DESC LIMIT 6`,
    )
    .catch((e) => [{ error: String((e as Error)?.message || e).slice(0, 120) }]);
  out.tasks = (tasks as any[]).map((t) =>
    t.error ? t : { runId: t.run_id, slot: t.slot, status: t.status, title: String(t.title || "").slice(0, 70), updatedAt: t.updated_at },
  );

  const runIds = (tasks as any[]).filter((t) => t.run_id).map((t) => t.run_id);
  out.events = runIds.length
    ? await prismaDb
        .query<any>(
          `SELECT run_id, kind, text, created_at FROM coder_task_events WHERE run_id = ANY($1) ORDER BY id DESC LIMIT 12`,
          runIds,
        )
        .then((rows: any[]) => rows.map((e) => ({ runId: e.run_id, kind: e.kind, text: String(e.text || "").slice(0, 200), at: e.created_at })))
        .catch(() => [])
    : [];

  out.business = await prismaDb
    .query<any>(`SELECT at, model, dir, note FROM tg_business_log ORDER BY id DESC LIMIT 4`)
    .then((rows: any[]) => rows.map((r) => ({ at: r.at, model: r.model, dir: r.dir, note: String(r.note || "").slice(0, 80) })))
    .catch(() => []);

  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const text = String(body?.text || "اختبار: هل ترد؟").slice(0, 200);
  const bot = await prisma.bot
    .findFirst({ where: { template: "NOVA_BOT", isActive: true }, select: { id: true, token: true, webhookSecret: true, ownerId: true } })
    .catch(() => null);
  if (!bot) return NextResponse.json({ error: "no active NOVA_BOT row" }, { status: 503 });

  const chat = String(body?.chat || bot.ownerId || "").trim();
  if (!/^-?\d+$/.test(chat)) return NextResponse.json({ error: "no chat to inject", hint: "pass {\"chat\":\"<telegram id>\"}" }, { status: 409 });

  const started = Date.now();
  const update = {
    update_id: started,
    message: {
      message_id: 900000 + Math.floor(Math.random() * 99999),
      date: Math.floor(started / 1000),
      chat: { id: Number(chat), type: "private", first_name: "Probe" },
      from: { id: Number(chat), is_bot: false, first_name: "Probe", language_code: "ar" },
      text,
    },
  };
  const port = process.env.PORT || "3000";
  const posted = await fetch(`http://127.0.0.1:${port}/api/telegram/${bot.id}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": bot.webhookSecret },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(115000),
  })
    .then(async (r) => ({ http: r.status, body: (await r.json().catch(() => null)) as unknown }))
    .catch((e) => ({ http: 0, body: String((e as Error)?.message || e).slice(0, 160) }));

  return NextResponse.json(
    { chat: mask(chat), text, webhook: posted, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
