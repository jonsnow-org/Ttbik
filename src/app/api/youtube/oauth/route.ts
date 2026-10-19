import { NextRequest, NextResponse } from "next/server";
import { consentUrl, saveRefreshFromCode, stateOk, youtubeKeysPresent } from "@/lib/youtubePublish";

export const dynamic = "force-dynamic";

/**
 * One-time owner consent for publishing promo videos to YouTube.
 *  1) Open  /api/youtube/oauth?secret=<CRON_SECRET>  → Google consent (youtube.upload only).
 *  2) Google returns here with ?code&state; the refresh token is stored in the database and never shown.
 * Desktop client (default): after consent the browser lands on http://localhost/?code=... (it cannot load; that is expected). Paste that whole address
 * into the form this route shows, or call /api/youtube/oauth?secret=<CRON_SECRET>&url=<that address>.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const html = (m: string, s = 200) => new NextResponse(`<meta charset=utf-8><meta name=viewport content="width=device-width"><body style="font:16px system-ui;padding:24px;direction:rtl">${m}</body>`, { status: s, headers: { "content-type": "text/html; charset=utf-8" } });
  const pasted = q.get("url");
  if (pasted) {
    if (!process.env.CRON_SECRET || q.get("secret") !== process.env.CRON_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    let u: URL | null = null;
    try { u = new URL(pasted.trim()); } catch { /* handled below */ }
    const code = u?.searchParams.get("code");
    if (!u || !code || !stateOk(u.searchParams.get("state") || "")) return html("العنوان غير صالح أو انتهت صلاحيته (15 دقيقة). ابدأ من جديد.", 400);
    return html((await saveRefreshFromCode(code)) ? "✅ تم الربط: سيُنشر الفيديو الترويجي على يوتيوب تلقائياً." : "⚠️ لم يُرجِع غوغل رمز التحديث. أزل الصلاحية من myaccount.google.com/permissions ثم أعد المحاولة.");
  }
  if (q.get("form") && process.env.CRON_SECRET && q.get("secret") === process.env.CRON_SECRET) {
    return html(`<form method=get><input type=hidden name=secret value="${encodeURIComponent(process.env.CRON_SECRET).replace(/"/g, "")}"><p>الصق هنا العنوان الذي ظهر في المتصفح بعد الموافقة (يبدأ بـ http://localhost):</p><textarea name=url rows=5 style="width:100%;direction:ltr"></textarea><p><button style="font-size:18px;padding:8px 20px">ربط</button></p></form>`);
  }
  if (q.get("code")) {
    if (!stateOk(q.get("state") || "")) return html("انتهت صلاحية الرابط أو غير صالح. ابدأ من جديد.", 400);
    return html((await saveRefreshFromCode(q.get("code")!)) ? "✅ تم الربط: سيُنشر الفيديو الترويجي على يوتيوب تلقائياً." : "⚠️ لم يُرجِع غوغل رمز التحديث. أزل الصلاحية من حسابك في myaccount.google.com/permissions ثم أعد المحاولة.", 200);
  }
  if (q.get("error")) return html("رُفض الإذن: " + q.get("error"), 400);
  if (!process.env.CRON_SECRET || q.get("secret") !== process.env.CRON_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = consentUrl();
  if (!url) return html(youtubeKeysPresent() ? "تعذر البدء." : "ضع YOUTUBE_CLIENT_ID و YOUTUBE_CLIENT_SECRET في متغيرات Vercel أولاً.", 503);
  return NextResponse.redirect(url);
}
