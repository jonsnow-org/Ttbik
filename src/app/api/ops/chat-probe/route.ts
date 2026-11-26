import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaDb } from "@/lib/coderAuth";
import { getEngineUrls, hookSecret, safeEqual } from "@/lib/mediaFrontDoor";
import { coderChatKey } from "@/lib/coderAuth";
import { shamStudioEnabled } from "@/lib/shamStudio";
import { shamAgentOn } from "@/lib/shamAgent";
import { chatKey } from "@/lib/shamMemory";

/**
 * Why a plain chat message in the Nova / Sham bot does or does not get an answer. READ-ONLY (GET), no token in the output.
 *
 * A green webhook (bots-health) only proves Telegram delivered and got 200; the answer itself can still be lost after that:
 *  - the front door's engine list is empty or names a host that no longer answers,
 *  - the Sham Studio is "off" because MODELSCOPE_API_TOKEN is empty in this environment (each server has its own env),
 *  - the durable handoff (startShamDurableTask -> /api/sham/continue) was never confirmed, so the run stays "running",
 *  - or the run failed inside a stage: coder_task_events keeps the stage's own words.
 *
 * POST { text?, chat?, via? } injects ONE synthetic private message into this server's own webhook (127.0.0.1) and returns the
 * webhook's status, so a real reply path can be proven end to end; `chat` defaults to the bot owner's Telegram id.
 * `via: "gate"` posts the same update to the URL Telegram uses instead, which tells a working site apart from a front door
 * that answers while the site never sees the update. GET ?chat=<id> also reports that chat's selected model, its last runs and the
 * last turns Sham saved (the exact text it sent), so a reply that reached the chat can be read back instead of guessed.
 *
 * POST { chat, model } selects a model for that chat through the SAME function the Mini App picker and the bot buttons use
 * (`chooseModel`, the one place a model is chosen) and returns { before, after } so a temporary switch can be put back exactly as it was.
 * { inject: false } (or no text) makes it a switch-only call, which is how the state is restored after a proof.
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

  // WHICH model answers this chat, and what it ran lately (Nova's coder legs are not 'sham-*' run ids, so they were invisible here).
  const wantChat = String(req.nextUrl.searchParams.get("chat") || bot?.ownerId || "").trim();
  if (/^-?\d+$/.test(wantChat)) {
    const { loadState } = await import("@/lib/coderSections");
    const st = await loadState(wantChat, prismaDb).catch(() => null);
    out.chat = { id: mask(wantChat), model: (st as any)?.model || null, freei: Boolean((st as any)?.freei) };
    out.chatTasks = await prismaDb
      .query<any>(
        `SELECT run_id, slot, status, title, updated_at FROM coder_tasks WHERE chat_key = $1 ORDER BY updated_at DESC LIMIT 8`,
        coderChatKey(Number(wantChat)),
      )
      .then((rows: any[]) =>
        rows.map((t) => ({ runId: t.run_id, slot: t.slot, status: t.status, title: String(t.title || "").slice(0, 60), updatedAt: t.updated_at })),
      )
      .catch(() => []);
    // The turns Sham itself saved for this chat: `answer` is the very string it sent, whichever variant answered (v1's plain
    // path writes no task row, so without this a real v1 reply was invisible to every probe).
    out.chatTurns = await prismaDb
      .query<any>(
        `SELECT question, answer, created_at FROM sham_chat_memory WHERE chat_key LIKE $1 ORDER BY id DESC LIMIT 4`,
        `${chatKey(wantChat)}|%`,
      )
      .then((rows: any[]) =>
        rows.map((r) => ({ q: String(r.question || "").slice(0, 120), a: String(r.answer || "").slice(0, 500), at: r.created_at })),
      )
      .catch(() => []);
    // Nova's own legs (slot coder / nova2) keep their words in coder_task_events, not in Sham's memory.
    out.chatEvents = await prismaDb
      .query<any>(
        `SELECT run_id, kind, text, created_at FROM coder_task_events WHERE run_id = ANY($1) ORDER BY id DESC LIMIT 10`,
        (out.chatTasks as any[]).map((t) => t.runId),
      )
      .then((rows: any[]) => rows.map((e) => ({ runId: e.run_id, kind: e.kind, text: String(e.text || "").slice(0, 300), at: e.created_at })))
      .catch(() => []);
  }

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
  const wantModel = String(body?.model || "").trim();
  const bot = await prisma.bot
    .findFirst({ where: { template: "NOVA_BOT", isActive: true }, select: { id: true, token: true, webhookSecret: true, ownerId: true } })
    .catch(() => null);
  if (!bot) return NextResponse.json({ error: "no active NOVA_BOT row" }, { status: 503 });

  const chat = String(body?.chat || bot.ownerId || "").trim();
  if (!/^-?\d+$/.test(chat)) return NextResponse.json({ error: "no chat to inject", hint: "pass {\"chat\":\"<telegram id>\"}" }, { status: 409 });

  // The same selection the Mini App picker and the bot's model buttons perform (`chooseModel` is the one place a model is chosen), so a
  // proof of the old Sham's path is the real path and not a forced variant. `before` is returned so the caller can put the state back.
  let selected: Record<string, unknown> | null = null;
  if (wantModel) {
    const { loadStateStrict, saveStateStrict } = await import("@/lib/coderSections");
    const { listModels, chooseModel, canonModelId } = await import("@/lib/coderModels");
    const st = await loadStateStrict(chat, prismaDb).catch(() => null);
    if (!st) return NextResponse.json({ error: "chat state unavailable" }, { status: 503 });
    const before = canonModelId(st.model) || null;
    const okModel = chooseModel(st, await listModels(prismaDb), wantModel, true);   // owner: true — this endpoint is CRON_SECRET-only
    if (!okModel) return NextResponse.json({ error: "model not available to the owner", model: wantModel, before }, { status: 409 });
    await saveStateStrict(chat, st, prismaDb);
    selected = { before, after: st.model, mode: st.mode };
    // A switch-only call: the state is being changed (or put back), nothing is sent to Telegram.
    if (body?.inject === false || !body?.text) {
      return NextResponse.json({ chat: mask(chat), selected }, { headers: { "Cache-Control": "no-store" } });
    }
  }

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
  // via=gate posts the very same update to the URL Telegram itself uses (the front door), so a working local path and a
  // silent real one can be told apart: the gate may answer 200/504 while the site never receives the update at all.
  const port = process.env.PORT || "3000";
  let target = `http://127.0.0.1:${port}/api/telegram/${bot.id}`;
  let via = "local";
  if (String(body?.via || "") === "gate") {
    const info = await tg(bot.token, "getWebhookInfo");
    const url = String(info?.url || "");
    if (!url) return NextResponse.json({ error: "Telegram has no webhook url for this bot", info }, { status: 409 });
    target = url;
    via = "gate";
  }
  const posted = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": bot.webhookSecret },
    body: JSON.stringify(update),
    signal: AbortSignal.timeout(115000),
  })
    .then(async (r) => ({ http: r.status, body: (await r.json().catch(() => null)) as unknown }))
    .catch((e) => ({ http: 0, body: String((e as Error)?.message || e).slice(0, 160) }));

  return NextResponse.json(
    { chat: mask(chat), text, selected, via, target: host(target), webhook: posted, ms: Date.now() - started },
    { headers: { "Cache-Control": "no-store" } },
  );
}
