import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, verifyInitData } from "@/lib/match/inline";
import { handleAdAppAction } from "@/lib/botApp/adApp";

/**
 * Backend of an ads & earn bot's own Mini App (/bot-app/<botId>). Every call carries Telegram WebApp initData verified with THIS
 * bot's stored token (a request signed for another bot, or from outside Telegram, is refused), so the user id always comes from
 * Telegram, never from the request body.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const err = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest, props: { params: Promise<{ botId: string }> }) {
  const { botId } = await props.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.initData !== "string" || typeof body.action !== "string") return err("طلب غير صالح");
  const botRow = await prisma.bot.findUnique({ where: { id: botId } }).catch(() => null);
  if (!botRow || !botRow.isActive || botRow.template !== "AD_BOT") return err("البوت غير متاح", 404);
  const tg = verifyInitData(body.initData, botRow.token);
  if (!tg) return err("افتح التطبيق من داخل تيليجرام", 401);
  if (!rateLimit(`botapp:${botId}:${tg.id}`, 240, 60_000)) return err("طلبات كثيرة، تمهّل قليلاً", 429);
  try {
    const r = await handleAdAppAction(botRow, tg, body.action.slice(0, 40), body);
    return NextResponse.json(r, { status: r.ok ? 200 : r.code === "private" ? 403 : 200 });
  } catch (e) {
    console.error("bot-app action failed", body.action, (e as Error)?.message);
    return err("حدث خطأ، حاول مرة أخرى", 500);
  }
}
