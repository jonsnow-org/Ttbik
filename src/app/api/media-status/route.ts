import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Real, honest live-status check for the mini-app's 🟢 pulse -- Telegram's
// own native chat header (the bot's name/avatar at the top of the chat)
// is entirely rendered by the Telegram app itself; there is no Bot API to
// inject a status dot there. This is the one place we actually control: it
// calls Telegram's getMe with BOT_TOKEN (kept server-side, exactly like
// every other route here that touches it) and reports whether Telegram
// itself confirms the bot is a live, valid bot right now. This does NOT
// confirm our own long-polling process is up and processing messages
// (Telegram has no API for that, since it doesn't track who's currently
// polling) -- it confirms the token is valid and Telegram's side is
// reachable, which is the honest, real thing we can actually check.
export async function GET() {
  const token = (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) return NextResponse.json({ online: false, reason: "no BOT_TOKEN configured" });

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => ({}));
    return NextResponse.json({ online: !!j?.ok });
  } catch {
    return NextResponse.json({ online: false, reason: "unreachable" });
  }
}
