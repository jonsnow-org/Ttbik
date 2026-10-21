// The coder Mini App's API (src/lib/coderApp.ts). POST { op, ...args } with the Telegram-signed initData in x-telegram-init-data.
import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { verifyTmaInitData } from "@/lib/tmaInitData";
import { AppError, appOp, tierOf } from "@/lib/coderApp";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

let cached: { at: number; row: any } | null = null;
async function coderBot() {
  if (cached && Date.now() - cached.at < 60000) return cached.row;
  const id = process.env.CODER_BOT_ID || "";
  const row = id
    ? await prisma.bot.findUnique({ where: { id } }).catch(() => null)
    : await prisma.bot.findFirst({ where: { template: "NOVA_BOT", isActive: true }, orderBy: { created_at: "asc" } as any }).catch(() => null);
  cached = { at: Date.now(), row };
  return row;
}

export async function POST(req: NextRequest) {
  const botRow = await coderBot();
  if (!botRow) return NextResponse.json({ error: "bot not configured" }, { status: 503 });
  // every call: Telegram-signed initData, validated here with the bot token (never trusted from the client)
  const user = verifyTmaInitData(req.headers.get("x-telegram-init-data") || "", botRow.token);
  if (!user) return NextResponse.json({ error: "open this from Telegram" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const chatId = Number(user.id);
  try {
    const out = await appOp({ chatId, tier: tierOf(chatId) }, String(body.op || ""), body, { bot: new Bot(botRow.token), botRow });
    return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
