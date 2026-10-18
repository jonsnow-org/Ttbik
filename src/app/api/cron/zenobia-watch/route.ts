import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { watchMessage, type WatchState } from "@/lib/zenobiaWatch";

// Every 15 minutes (GitHub Actions workflow zenobia-watch.yml): if ZNB's supply or holders changed, the owner gets a message from the Zenobia bot.
// Read-only on-chain. Nothing happens until the owner sets the jetton with /jetton in the bot.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  const ok = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || q === process.env.CRON_SECRET);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureZenobiaTables();
  const bot = await prisma.bot.findFirst({ where: { template: "ZENOBIA_BOT", isActive: true } });
  if (!bot) return NextResponse.json({ ok: true, skipped: "no zenobia bot" });
  const cfg = (await prisma.$queryRawUnsafe(`SELECT k, v FROM zenobia_config WHERE bot_id=$1`, bot.id)) as { k: string; v: string }[];
  const jetton = cfg.find((c) => c.k === "jetton")?.v;
  const decimals = Number(cfg.find((c) => c.k === "decimals")?.v ?? 9);
  if (!jetton) return NextResponse.json({ ok: true, skipped: "jetton not set" });

  const headers = process.env.TONAPI_KEY ? { authorization: `Bearer ${process.env.TONAPI_KEY}` } : undefined;
  const info = await fetch(`https://tonapi.io/v2/jettons/${encodeURIComponent(jetton)}`, { headers });
  if (!info.ok) return NextResponse.json({ ok: false, error: `tonapi ${info.status}` });
  const j = (await info.json()) as { holders_count?: number; total_supply?: string };
  const hl = await fetch(`https://tonapi.io/v2/jettons/${encodeURIComponent(jetton)}/holders?limit=100`, { headers });
  const owners = hl.ok ? (((await hl.json()) as { addresses?: { owner?: { address?: string }; address: string }[] }).addresses ?? []).map((a) => a.owner?.address ?? a.address) : [];
  const cur: WatchState = { holders: Number(j.holders_count ?? 0), supply: String(j.total_supply ?? "0"), owners };

  const prevRaw = cfg.find((c) => c.k === "watch")?.v;
  let prev: WatchState | null = null;
  try { prev = prevRaw ? (JSON.parse(prevRaw) as WatchState) : null; } catch { prev = null; }
  const text = watchMessage(prev, cur, decimals, `https://tonviewer.com/${jetton}`);
  await prisma.$executeRawUnsafe(`INSERT INTO zenobia_config (bot_id,k,v) VALUES ($1,'watch',$2) ON CONFLICT (bot_id,k) DO UPDATE SET v=EXCLUDED.v`, bot.id, JSON.stringify(cur));

  let sent = false;
  const ownerId = Number((bot as { ownerId?: string | null }).ownerId || process.env.NEXT_PUBLIC_OWNER_ID || process.env.OWNER_ID || 0);
  if (text && ownerId) {
    try { await new TelegramBot(bot.token).api.sendMessage(ownerId, text, { link_preview_options: { is_disabled: true } }); sent = true; } catch { /* the next run tells him again only if it changes again */ }
  }
  return NextResponse.json({ ok: true, changed: !!text, sent, holders: cur.holders });
}
