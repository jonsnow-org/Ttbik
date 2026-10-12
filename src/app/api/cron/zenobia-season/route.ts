import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { fetchHolders } from "@/lib/zenobiaChain";
import { buildPeople, closeSeason, previousSeason, seasonDays, type Snapshots } from "@/lib/zenobiaSeason";

// Daily (GitHub Actions workflow zenobia-season.yml): snapshot the jetton's holders, and once a week close the finished season.
// Read-only on-chain. Nothing happens until the owner sets the jetton with /jetton in the bot.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  const ok = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || q === process.env.CRON_SECRET);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureZenobiaTables();
  const bot = await prisma.bot.findFirst({ where: { template: "ZENOBIA_BOT", isActive: true }, select: { id: true } });
  if (!bot) return NextResponse.json({ ok: true, skipped: "no zenobia bot" });
  const cfg = (await prisma.$queryRawUnsafe(`SELECT k, v FROM zenobia_config WHERE bot_id=$1`, bot.id)) as { k: string; v: string }[];
  const jetton = cfg.find((c) => c.k === "jetton")?.v;
  const decimals = Number(cfg.find((c) => c.k === "decimals")?.v ?? 9);
  if (!jetton) return NextResponse.json({ ok: true, skipped: "jetton not set" });

  // 1. today's snapshot (all holders with a balance; a re-run on the same day just replaces it)
  const today = new Date().toISOString().slice(0, 10);
  const holders = await fetchHolders(jetton, { delayMs: 1100, apiKey: process.env.TONAPI_KEY });
  await prisma.$executeRawUnsafe(`DELETE FROM zenobia_snap WHERE day=$1`, today);
  const owners: string[] = [], balances: string[] = [];
  for (const [owner, bal] of holders) if (bal > 0n) { owners.push(owner); balances.push(bal.toString()); }
  if (owners.length) {
    await prisma.$executeRawUnsafe(`INSERT INTO zenobia_snap (day, owner, balance) SELECT $1::date, o, b::numeric FROM unnest($2::text[], $3::text[]) AS t(o, b)`, today, owners, balances);
  }

  // 2. close last week's season once (needs verified wallets)
  const id = previousSeason(new Date());
  const done = (await prisma.$queryRawUnsafe(`SELECT 1 FROM zenobia_season WHERE season=$1`, id)) as unknown[];
  let closed: string | null = null;
  if (!done.length) {
    const days = seasonDays(id);
    const snapRows = (await prisma.$queryRawUnsafe(`SELECT day::text AS day, owner, balance::text AS balance FROM zenobia_snap WHERE day = ANY($1::date[])`, days)) as { day: string; owner: string; balance: string }[];
    if (snapRows.length) {
      const snaps: Snapshots = new Map();
      for (const r of snapRows) { const m = snaps.get(r.day) ?? new Map<string, bigint>(); m.set(r.owner, BigInt(r.balance.split(".")[0])); snaps.set(r.day, m); }
      const users = (await prisma.$queryRawUnsafe(`SELECT tg_user_id, wallet FROM zenobia_user WHERE bot_id=$1 AND wallet_verified=true AND wallet IS NOT NULL`, bot.id)) as { tg_user_id: string; wallet: string }[];
      const persons = new Map<string, string[]>();
      for (const u of users) persons.set(u.tg_user_id, [...(persons.get(u.tg_user_id) ?? []), u.wallet]);
      const res = closeSeason(id, buildPeople(snaps, days, persons, decimals));
      await prisma.$executeRawUnsafe(`INSERT INTO zenobia_season (season, hash, results) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING`, res.season, res.hash, JSON.stringify(res.results));
      closed = res.season;
    }
  }
  return NextResponse.json({ ok: true, holders: holders.size, closed });
}
