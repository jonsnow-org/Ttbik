import { NextRequest, NextResponse } from "next/server";
import { publishCoinsChannel } from "@/lib/coinsChannel";

export const maxDuration = 60;

/** The coins channel (Athar, ZNB, ZNBt, Palmyra Launch). Called by .github/workflows/coins-channel-post.yml; ?dry=1 previews the next post. */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const secret = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && secret !== process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const hourIstanbul = (new Date().getUTCHours() + 3) % 24;
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  if (!dry && (hourIstanbul < 8 || hourIstanbul >= 23)) return NextResponse.json({ ok: true, skipped: "quiet-hours", hourIstanbul });
  return NextResponse.json(await publishCoinsChannel({ dry }).catch((e) => ({ ok: false, reason: String(e).slice(0, 160) })));
}
