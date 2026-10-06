import { NextRequest, NextResponse } from "next/server";
import { exchangeYoutubeCode, readYoutubeState, saveYoutubeLink } from "@/lib/youtubeLink";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  const code = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  const tgUserId = readYoutubeState(state);
  if (!tgUserId || !code) return new NextResponse("الرابط غير صالح أو منتهٍ", { status: 400 });
  const token = await exchangeYoutubeCode(site, code);
  if (!token?.refresh_token) {
    return new NextResponse("لم يصل إذن دائم. أعد الربط ووافق على الطلب.", { status: 400 });
  }
  await saveYoutubeLink(tgUserId, token.refresh_token);
  const html = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px"><h1>تم ربط يوتيوب</h1><p>ارجع إلى البوت واضغط تحقق من الإنجاز.</p></body>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
