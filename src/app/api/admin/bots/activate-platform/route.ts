import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { isOwnerServer } from "@/lib/isOwner";
import { PLATFORM_COMMANDS } from "@/lib/platformBotLogic";

export const dynamic = "force-dynamic";

// The webhook goes to whatever the site's public address is now (deploy/hosting/site.json via NEXT_PUBLIC_SITE_URL);
// after a hosting move, "rehookBots" re-points this bot together with all the others.
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

export async function POST(req: NextRequest) {
  if (!await isOwnerServer()) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const ownerId = String(body.ownerId || "").replace(/\D/g, "");
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) return NextResponse.json({ error: "توكن غير صالح" }, { status: 400 });
  if (ownerId.length < 5) return NextResponse.json({ error: "معرّف المالك غير صالح" }, { status: 400 });
  const existing = await prisma.bot.findUnique({ where: { token } });
  if (existing) return NextResponse.json({ error: "هذا التوكن مُفعّل مسبقاً", botId: existing.id }, { status: 400 });

  const temp = new Bot(token);
  const me = await temp.api.getMe();
  const botId = crypto.randomUUID();
  const webhookSecret = crypto.randomBytes(32).toString("hex");
  await temp.api.setWebhook(`${SITE}/api/telegram/${botId}`, { secret_token: webhookSecret });
  await temp.api.setMyCommands(PLATFORM_COMMANDS).catch(() => null);
  const row = await prisma.bot.create({ data: { id: botId, token, template: "ZNBT_PLATFORM_BOT", ownerId, webhookSecret, isActive: true } });
  return NextResponse.json({ ok: true, botId: row.id, username: me.username, message: `تم تفعيل @${me.username} كبوت منصة العملات. أرسل /platform.` });
}
