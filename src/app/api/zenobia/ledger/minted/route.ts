import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

export const dynamic = "force-dynamic";

/** The ledger tells us a passport now exists on-chain: mark it and tell its owner in the bot. */
export async function POST(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-ops-key") || "", s)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const idx = Number(body.idx);
  const item = String(body.item || "");
  if (!Number.isInteger(idx) || idx < 1 || !/^[A-Za-z0-9_-]{48}$/.test(item)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await ensureZenobiaTables();
  const rows = (await prisma.$queryRawUnsafe(
    `UPDATE zenobia_passport SET status='minted', item=$2 WHERE idx=$1 AND status='requested' RETURNING bot_id, tg_user_id`, idx, item,
  )) as { bot_id: string; tg_user_id: string }[];
  const row = rows[0];
  if (!row) return NextResponse.json({ ok: true, already: true });
  try {
    const bot = await prisma.bot.findUnique({ where: { id: row.bot_id } });
    const u = (await prisma.$queryRawUnsafe(`SELECT lang FROM zenobia_user WHERE bot_id=$1 AND tg_user_id=$2`, row.bot_id, row.tg_user_id)) as { lang: string }[];
    if (bot) {
      const ar = u[0]?.lang === "ar";
      const link = `https://tonviewer.com/${item}`;
      await new Bot(bot.token).api.sendMessage(Number(row.tg_user_id), ar ? `✅ جواز القافلة رقم ${idx} صار في محفظتك.\n${link}` : `✅ Your Caravan Passport #${idx} is in your wallet.\n${link}`);
    }
  } catch { /* the passport exists either way */ }
  return NextResponse.json({ ok: true });
}
