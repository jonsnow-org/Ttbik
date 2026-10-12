import { NextRequest, NextResponse } from "next/server";
import { channelHasCode, readYoutubeState, savePublicYoutube } from "@/lib/youtubeLink";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = readYoutubeState(String(body.state || ""));
  const url = String(body.url || "");
  if (!parsed) return NextResponse.json({ error: "الرابط منتهي." }, { status: 400 });
  if (!/^https:\/\/(www\.)?youtube\.com\/.+/.test(url) && !/^https:\/\/youtu\.be\/.+/.test(url)) {
    return NextResponse.json({ error: "ضع رابط قناة يوتيوب." }, { status: 400 });
  }
  const channelId = await channelHasCode(url, parsed.code);
  if (!channelId) return NextResponse.json({ error: "الكود غير موجود في الصفحة. احفظ وصف القناة ثم أعد المحاولة." }, { status: 400 });
  await savePublicYoutube(parsed.tgUserId, channelId);
  return NextResponse.json({ ok: true });
}
