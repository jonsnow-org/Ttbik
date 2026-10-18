import { NextRequest, NextResponse } from "next/server";
import { atharDay, atharHealthy, atharDateLink, parseYmd, ymdOf } from "@/lib/atharDay";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { ATHAR_URL } from "@/lib/atharBotLogic";

// The media mini app's Athar card: a live look at one day (today by default, or ?date=YYYY-MM-DD): its picture and which kinds can still be
// gifted. Public and read-only (it only repeats what Athar's own public pages say); answers are cached 10 minutes per day inside atharDay.
// ON by default; MEDIA_ENABLE_ATHAR=0|false|off switches it off. Hidden (ok:false) when Athar does not answer.
export const dynamic = "force-dynamic";

const off = () => /^(0|false|off|no)$/i.test(String(process.env.MEDIA_ENABLE_ATHAR ?? "").trim());

export async function GET(req: NextRequest) {
  if (off()) return NextResponse.json({ ok: false, hidden: true });
  if (isRateLimited(`media-athar:${requestIp(req)}`, 60, 60_000)) return NextResponse.json({ ok: false, hidden: true }, { status: 429 });
  const raw = req.nextUrl.searchParams.get("date");
  const y = raw ? parseYmd(raw) : ymdOf(new Date());
  if (!y || !atharDateLink(y)) return NextResponse.json({ ok: false, error: "date" }, { status: 400 });
  if (!(await atharHealthy())) return NextResponse.json({ ok: false, hidden: true });
  const day = await atharDay(y).catch(() => null);
  if (!day) return NextResponse.json({ ok: false, hidden: true });
  return NextResponse.json({ ok: true, day, bot: (process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot").trim(), home: `${ATHAR_URL}/` }, { headers: { "Cache-Control": "public, max-age=120" } });
}
