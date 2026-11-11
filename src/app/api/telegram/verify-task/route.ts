import { NextResponse } from "next/server";

// Retired: this legacy endpoint trusted userId, botToken and botId supplied in
// the request body, bypassing Telegram initData authentication and the shared
// click/timer, phone and anti-abuse gates. There are no in-repository callers.
// All payouts must go through the authenticated AD_BOT webhook or Mini App.
export async function POST() {
  return NextResponse.json(
    { success: false, message: "هذا المسار متوقف. افتح بوت الإعلان أو تطبيقه المصغّر للتحقق من المهمة." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
