import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { isOwnerServer } from "@/lib/isOwner";

export const dynamic = "force-dynamic";

import { ATHAR_URL } from "@/lib/atharBotLogic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

export async function POST(req: NextRequest) {
  if (!isOwnerServer()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const ownerId = String(body.ownerId || "").replace(/\D/g, "");
  const botName = String(body.botName || "أثر").trim().slice(0, 64);

  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    return NextResponse.json({ error: "توكن غير صالح" }, { status: 400 });
  }
  if (ownerId.length < 5) {
    return NextResponse.json({ error: "معرّف المالك غير صالح" }, { status: 400 });
  }

  const existing = await prisma.bot.findUnique({ where: { token } });
  if (existing) {
    return NextResponse.json({ error: "هذا التوكن مُفعّل مسبقاً", botId: existing.id }, { status: 400 });
  }

  const temp = new Bot(token);
  const me = await temp.api.getMe();
  const botId = crypto.randomUUID();
  const webhookSecret = crypto.randomBytes(32).toString("hex");
  const webhookUrl = `${SITE}/api/telegram/${botId}`;

  await temp.api.setWebhook(webhookUrl, { secret_token: webhookSecret });

  // Menu button → mini app
  try {
    await temp.api.setChatMenuButton({
      menu_button: {
        type: "web_app",
        text: "أثر",
        web_app: { url: ATHAR_URL },
      },
    });
  } catch {
    /* optional on some clients */
  }

  const row = await prisma.bot.create({
    data: {
      id: botId,
      token,
      template: "ATHAR_BOT",
      ownerId,
      webhookSecret,
      isActive: true,
    },
  });

  return NextResponse.json({
    ok: true,
    botId: row.id,
    username: me.username,
    message: `تم تفعيل @${me.username} كقالب أثر. أرسل /start في البوت.`,
    miniApp: ATHAR_URL,
    botName,
  });
}
