import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { validCurve } from "@/lib/znbtHide";
import { readSnapshot } from "@/lib/znbtIndex";
import { MAX_ALERTS_PER_USER, ensureEngageTables, isAlertKind, tgUserFromInit } from "@/lib/znbtEngage";

// Coin alerts sent by the platform bot to a Telegram user who asked for them. Needs Telegram's signed initData (header x-tg-init), so nobody can set alerts for someone else.
export const dynamic = "force-dynamic";

const who = (req: NextRequest) => tgUserFromInit(req.headers.get("x-tg-init") || "");

/** ?c=<curve> -> the kinds this user has on that coin; without c -> all of the user's alerts. */
export async function GET(req: NextRequest) {
  const tg = await who(req);
  if (!tg) return NextResponse.json({ error: "open in Telegram" }, { status: 401 });
  await ensureEngageTables();
  const c = validCurve(req.nextUrl.searchParams.get("c") || "");
  const rows = (await prisma.$queryRawUnsafe(`SELECT curve, kind FROM znbt_alerts WHERE tg_id=$1 ${c ? "AND curve=$2" : ""}`, ...(c ? [tg, c] : [tg]))) as { curve: string; kind: string }[];
  return NextResponse.json({ alerts: rows });
}

/** Body { c, kind, on, lang? }: turn one alert on or off. */
export async function POST(req: NextRequest) {
  if (isRateLimited(`znbt-alert:${requestIp(req)}`, 60, 60 * 60_000)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const tg = await who(req);
  if (!tg) return NextResponse.json({ error: "open in Telegram" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const curve = validCurve(String(b.c || ""));
  if (!curve || !isAlertKind(b.kind)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await ensureEngageTables();
  if (!b.on) {
    await prisma.$executeRawUnsafe(`DELETE FROM znbt_alerts WHERE tg_id=$1 AND curve=$2 AND kind=$3`, tg, curve, b.kind);
    return NextResponse.json({ ok: true, on: false });
  }
  const cnt = (await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM znbt_alerts WHERE tg_id=$1`, tg)) as { n: number }[];
  if ((cnt[0]?.n ?? 0) >= MAX_ALERTS_PER_USER) return NextResponse.json({ error: `at most ${MAX_ALERTS_PER_USER} alerts` }, { status: 400 });
  const snap = await readSnapshot().catch(() => null);
  const coin = snap?.coins.find((x) => x.curve === curve);
  const lang = b.lang === "ru" || b.lang === "ar" ? b.lang : "en";
  await prisma.$executeRawUnsafe(
    `INSERT INTO znbt_alerts (tg_id, curve, kind, lang, base_tpt) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tg_id, curve, kind) DO UPDATE SET lang=EXCLUDED.lang, fired_at=NULL`,
    tg, curve, b.kind, lang, coin?.tokensPerTon ?? null,
  );
  return NextResponse.json({ ok: true, on: true });
}
