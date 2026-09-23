import { NextRequest, NextResponse } from "next/server";
import { mediaDb, mediaUser } from "@/lib/mediaSocial";

// Rewarded ad → extra downloads in the media bot.
//   POST {init_data}            the viewer just finished a rewarded ad → +BONUS_PER_AD today
//   GET  ?init_data=            the viewer's status for today (for the mini-app card)
//   GET  ?user_id= + x-feed-secret   today's bonus for the bot (services/rewards.py)
export const dynamic = "force-dynamic";

const BONUS_PER_AD = 3;
const MAX_ADS_PER_DAY = 3;
const COOLDOWN_MS = 45_000;

function today() {
  return new Date().toISOString().slice(0, 10);
}
function secretOk(req: NextRequest) {
  const expected = (process.env.FEED_SECRET || process.env.ADMIN_PASSWORD || "8452320").trim();
  return (req.headers.get("x-feed-secret") || "").trim() === expected;
}
async function status(db: any, userId: string) {
  const { data } = await db.from("media_ad_rewards").select("ads,bonus,last_at").eq("user_id", userId).eq("day", today()).maybeSingle();
  const ads = Number((data as any)?.ads || 0);
  return { ads, bonus: Number((data as any)?.bonus || 0), remaining: Math.max(0, MAX_ADS_PER_DAY - ads), per_ad: BONUS_PER_AD, last_at: (data as any)?.last_at || null };
}

export async function GET(req: NextRequest) {
  const db = await mediaDb();
  if (!db) return NextResponse.json({ bonus: 0 });
  try {
    const botUser = (req.nextUrl.searchParams.get("user_id") || "").trim();
    if (botUser) {
      if (!secretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      return NextResponse.json(await status(db, botUser));
    }
    const me = mediaUser(req.nextUrl.searchParams.get("init_data") || "");
    if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.json(await status(db, me.id));
  } catch {
    return NextResponse.json({ bonus: 0, ads: 0, remaining: 0, ready: false });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const me = mediaUser(String(body.init_data || ""));
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "not configured" }, { status: 503 });
  try {
    const cur = await status(db, me.id);
    if (cur.remaining <= 0) return NextResponse.json({ ...cur, granted: 0, reason: "daily_cap" });
    if (cur.last_at && Date.now() - new Date(cur.last_at).getTime() < COOLDOWN_MS) {
      return NextResponse.json({ ...cur, granted: 0, reason: "cooldown" });
    }
    const next = { user_id: me.id, day: today(), ads: cur.ads + 1, bonus: cur.bonus + BONUS_PER_AD, last_at: new Date().toISOString() };
    const { error } = await db.from("media_ad_rewards").upsert(next, { onConflict: "user_id,day" });
    if (error) throw error;
    return NextResponse.json({ ...(await status(db, me.id)), granted: BONUS_PER_AD });
  } catch {
    return NextResponse.json({ error: "rewards table missing", needs_migration: true }, { status: 500 });
  }
}
