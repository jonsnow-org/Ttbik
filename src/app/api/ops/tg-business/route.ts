import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { prismaDb } from "@/lib/coderAuth";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";
import { normRights, RIGHTS, defaultGenerate, systemFor } from "@/lib/tgBusiness";

/**
 * Why Telegram Business ("Secretary mode") replies do or do not happen. READ-ONLY, no tokens in the output.
 *
 * The feature has three gates that all have to be open, and from the outside they look identical ("nothing happens"):
 *  1. Telegram's side: the bot has Secretary Mode (getMe.can_connect_to_business) and the account owner granted the rights
 *     Telegram reports for the connection (`rights.can_reply` to answer; nothing arrives at all without read access to the chat).
 *  2. The owner's switch (`coder_flags.tg_business`: off | owner | all) — off means every update is dropped silently.
 *  3. Our own log rows (tg_business_log) — they show the last decision for every update that did arrive: in / own / out / skip / fail + the note.
 *
 * `?probe=1` also asks Telegram for each stored connection (getBusinessConnection), so the rights we stored are compared with
 * what Telegram says right now (a connection paused or narrowed in Telegram's settings never reaches us again otherwise).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function tg(token: string, method: string, body?: Record<string, unknown>) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(9000),
    });
    const j = await r.json();
    return j?.ok ? j.result : { error: String(j?.description || r.status).slice(0, 160) };
  } catch (e) {
    return { error: String((e as Error)?.message || e).slice(0, 120) };
  }
}

/** The same call, but the WHOLE Bot API answer is kept (ok / error_code / description): a refusal is only useful with Telegram's words. */
async function tgRaw(token: string, method: string, body?: Record<string, unknown>): Promise<Record<string, unknown> & { http: number; error?: string }> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => null);
    return { http: r.status, ...(j && typeof j === "object" ? (j as Record<string, unknown>) : { body: "not json" }) };
  } catch (e) {
    return { http: 0, error: String((e as Error)?.message || e).slice(0, 160) };
  }
}

/** owner id -> "5001" stays, larger ids keep the first two digits only */
const maskId = (v: string) => (v.length <= 5 ? v : `${v.slice(0, 2)}***${v.slice(-2)}`);
const rightsOf = (v: unknown) => Object.keys(normRights(v));

export async function GET(req: NextRequest) {
  const s = hookSecret();
  const cron = process.env.CRON_SECRET || "";
  const okKey = !!s && safeEqual(req.headers.get("x-ops-key") || "", s);
  const okCron = !!cron && safeEqual(req.headers.get("authorization") || "", `Bearer ${cron}`);
  if (!okKey && !okCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const probe = req.nextUrl.searchParams.get("probe") === "1";
  const out: Record<string, unknown> = {};

  try {
    const rows = await prismaDb.query<{ value: string }>(`SELECT value FROM coder_flags WHERE key = 'tg_business'`);
    out.flag = rows[0]?.value || "off";
  } catch {
    out.flag = "unknown (coder_flags unreadable)";
  }

  const bot = await prisma.bot.findFirst({ where: { template: "NOVA_BOT", isActive: true }, select: { id: true, token: true } }).catch(() => null);
  if (!bot) {
    out.bot = { error: "no active NOVA_BOT row" };
  } else {
    const [me, wh] = await Promise.all([tg(bot.token, "getMe"), tg(bot.token, "getWebhookInfo")]);
    out.bot = {
      username: (me as any)?.username ?? null,
      // Secretary Mode in @BotFather: false means no account can connect this bot at all
      canConnectBusiness: (me as any)?.can_connect_to_business ?? null,
      webhookUrl: (wh as any)?.url ?? null,
      pending: (wh as any)?.pending_update_count ?? null,
      allowedUpdates: (wh as any)?.allowed_updates ?? null,
      lastError: (wh as any)?.last_error_message ? String((wh as any).last_error_message).slice(0, 160) : null,
      lastErrorAgoMin: (wh as any)?.last_error_date ? Math.round(Date.now() / 1000 - (wh as any).last_error_date) / 60 : null,
    };
  }

  // The Studio side of the same question: a reply that never came is either Telegram's refusal (above) or the model's own Studio.
  try {
    const OC = await import("@/lib/openCoderStudio");
    const bases = OC.coderStudioUrls();
    const st = await OC.allStudioStatus(6000);
    out.studios = st.map((s, i) => ({
      studio: String(bases[i] || "?").replace(/^https:\/\//, "").split(".")[0],
      phase: s?.phase ?? null, model: s?.model ?? null, queue: s?.queue ?? null,
    }));
  } catch {
    out.studios = "unavailable";
  }

  // `gen=<model>` (or `gen=1` for both): the business generator itself (not a raw chat call) asked for one short reply, so the
  // report shows exactly what a contact's message would have produced: the text that would be sent, or the reason nothing was.
  // One model per request keeps this inside the front door's own request time limit.
  const gen = req.nextUrl.searchParams.get("gen") || "";
  // `gen=0` (the default of a prove-only run) asks no model: generation is the slow part and the front door drops long requests.
  if (gen && gen !== "0") {
    let instructions = "";
    try {
      const rows = await prismaDb.query<{ instructions: string }>(`SELECT instructions FROM tg_business_connections ORDER BY updated_at DESC LIMIT 1`);
      instructions = String(rows[0]?.instructions || "");
    } catch { /* no connection stored yet: the default rules are still the real ones */ }
    const system = systemFor({ instructions } as never, "");
    const wanted: Array<"coder" | "sham_v2"> = gen === "coder" || gen === "sham_v2" ? [gen] : ["coder", "sham_v2"];
    out.gen = await Promise.all(wanted.map(async (model) => {
      const t0 = Date.now();
      try {
        const made = await defaultGenerate(model, system, [{ role: "user", text: "مرحبا" }], "كيف حالك؟", "biz:probe");
        const g = typeof made === "string" ? { text: made } : made || { text: null };
        return { model, ms: Date.now() - t0, text: g.text ? String(g.text).slice(0, 120) : null, why: (g as { why?: string }).why ? String((g as { why?: string }).why).slice(0, 160) : null };
      } catch (e) {
        return { model, ms: Date.now() - t0, text: null, why: `threw: ${String((e as Error)?.message || e).slice(0, 140)}` };
      }
    }));
  }

  let conns: any[] = [];  try {
    conns = await prismaDb.query<any>(`SELECT * FROM tg_business_connections ORDER BY updated_at DESC LIMIT 10`);
  } catch {
    out.connections = "tg_business_connections readable only after the first business update";
  }
  if (Array.isArray(conns)) {
    const list = [];
    for (const r of conns) {
      const rights = rightsOf(typeof r.rights === "string" ? JSON.parse(r.rights || "{}") : r.rights);
      const row: Record<string, unknown> = {
        id: String(r.id), user: maskId(String(r.user_id)), enabled: Boolean(r.enabled), model: String(r.model),
        rights, instructionsLen: String(r.instructions || "").length, createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      };
      if (probe && bot) {
        const bc = await tg(bot.token, "getBusinessConnection", { business_connection_id: String(r.id) });
        const live = (bc as any)?.rights ? rightsOf((bc as any).rights) : null;
        row.telegram = (bc as any)?.error
          ? { error: (bc as any).error }
          : {
              isEnabled: (bc as any)?.is_enabled ?? null,
              rights: live,
              // what we act on vs what Telegram allows now
              missing: live ? RIGHTS.filter((x) => !live.includes(x) && ["can_reply", "can_read_messages"].includes(x)) : null,
              hasReply: live ? live.includes("can_reply") : null,
            };
      }
      list.push(row);
    }
    out.connections = list;
  }

  try {
    const log = await prismaDb.query<any>(`SELECT at, chat_id, model, dir, text, note FROM tg_business_log ORDER BY at DESC, id DESC LIMIT 30`);
    out.log = log.map((r) => ({
      at: new Date(r.at).toISOString(), chat: maskId(String(r.chat_id)), model: String(r.model), dir: String(r.dir),
      note: String(r.note || "").slice(0, 160), text: String(r.text || "").slice(0, 80),
    }));
  } catch {
    out.log = "no tg_business_log rows yet (no business update has reached the webhook)";
  }

  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}

/**
 * The whole path, once, for one model: a `business_message` update shaped exactly as Telegram sends it is POSTed to the real
 * webhook over HTTP (so the route's own parse and secret check run, not a function call), the webhook answers the contact with
 * `sendMessage`, and the log then has to show `in` followed by `sent` carrying Telegram's `message_id`.
 *
 * Body: { model?: "coder" | "sham_v2", chat?: string, text?: string }. `chat` defaults to the last contact that wrote to the
 * account: Telegram only accepts a business reply into a chat that belongs to the connection. The connection's chosen model is
 * put back after the run. No token or secret is ever returned.
 */
export async function POST(req: NextRequest) {
  const s = hookSecret();
  const cron = process.env.CRON_SECRET || "";
  const okKey = !!s && safeEqual(req.headers.get("x-ops-key") || "", s);
  const okCron = !!cron && safeEqual(req.headers.get("authorization") || "", `Bearer ${cron}`);
  if (!okKey && !okCron) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const model = body?.model === "sham_v2" ? "sham_v2" : "coder";
  const text = String(body?.text || "مرحبا").slice(0, 200);
  const B = await import("@/lib/tgBusiness");
  const bot = await prisma.bot.findFirst({ where: { template: "NOVA_BOT", isActive: true }, select: { id: true, webhookSecret: true, token: true } }).catch(() => null);
  if (!bot) return NextResponse.json({ error: "no active NOVA_BOT row" }, { status: 503 });
  const rows = await prismaDb.query<any>(`SELECT id, user_id, model FROM tg_business_connections WHERE enabled ORDER BY updated_at DESC LIMIT 1`).catch(() => []);
  const conn = rows[0];
  if (!conn) return NextResponse.json({ error: "no enabled connection" }, { status: 409 });
  const connId = String(conn.id);
  const ownerId = String(conn.user_id);
  let chat = String(body?.chat || "").trim();
  if (!chat) {
    const last = await prismaDb.query<{ chat_id: string }>(
      `SELECT chat_id FROM tg_business_log WHERE connection_id = $1 AND dir = 'in' ORDER BY at DESC, id DESC LIMIT 1`, connId,
    ).catch(() => [] as { chat_id: string }[]);
    chat = String(last[0]?.chat_id || "");
  }
  if (!chat || chat === ownerId) {
    return NextResponse.json({ error: "no contact chat to prove with", hint: "the account owner's own chat is context, never answered" }, { status: 409 });
  }

  const previousModel = String(conn.model || "coder");
  try {
    if (previousModel !== model) await prismaDb.exec(`UPDATE tg_business_connections SET model = $1, updated_at = now() WHERE id = $2`, model, connId);
    const startedAt = Date.now();
    const update = {
      update_id: startedAt,
      business_message: {
        message_id: 900000 + Math.floor(Math.random() * 99999),
        date: Math.floor(startedAt / 1000),
        chat: { id: Number(chat), type: "private", first_name: "Probe" },
        from: { id: Number(chat), is_bot: false, first_name: "Probe", language_code: "ar" },
        text,
        business_connection_id: connId,
      },
    };
    const port = process.env.PORT || "3000";
    const posted = await fetch(`http://127.0.0.1:${port}/api/telegram/${bot.id}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": bot.webhookSecret },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(55000),
    }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as unknown }))
      .catch((e) => ({ status: 0, body: String((e as Error)?.message || e).slice(0, 160) }));
    const log = await prismaDb.query<any>(
      `SELECT at, chat_id, model, dir, text, note FROM tg_business_log WHERE connection_id = $1 AND chat_id = $2 ORDER BY at DESC, id DESC LIMIT 4`,
      connId, chat,
    ).catch(() => []);
    const reply = log.find((r) => r.dir === "sent");
    // A refusal is only actionable with Telegram's own words: ask the Bot API for the same reply directly, and report its raw
    // answer (code + description). This is a real call to Telegram, not a simulation; nothing is logged as `sent` from it.
    const refused = !reply ? log.find((r) => r.dir === "fail" && String(r.text || "").trim()) : null;
    const direct = refused
      ? await tgRaw(bot.token, "sendMessage", { business_connection_id: connId, chat_id: Number(chat), text: String(refused.text || "").slice(0, 4000) })
      : null;
    return NextResponse.json({
      model, webhook: { http: posted.status, body: posted.body },
      chat: maskId(chat),
      passed: Boolean(reply),
      messageId: reply ? (String(reply.note || "").match(/message_id=(\d+)/)?.[1] ?? null) : null,
      ...(direct ? { telegramDirect: { http: direct.http, ok: direct.ok ?? null, errorCode: direct.error_code ?? null, description: direct.description ?? null, messageId: (direct.result as { message_id?: unknown } | undefined)?.message_id ?? null, error: direct.error ?? null } } : {}),
      rows: log.reverse().map((r) => ({
        at: new Date(r.at).toISOString(), dir: String(r.dir), model: String(r.model),
        note: String(r.note || "").slice(0, 320), text: String(r.text || "").slice(0, 90),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } finally {
    if (previousModel !== model) {
      await prismaDb.exec(`UPDATE tg_business_connections SET model = $1, updated_at = now() WHERE id = $2`, previousModel, connId).catch(() => null);
    }
  }
}
