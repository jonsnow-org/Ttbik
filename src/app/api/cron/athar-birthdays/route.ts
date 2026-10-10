import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ATHAR_URL, LANGS } from "@/lib/atharBotLogic";
import { birthdayRows, markNotified, nextBirthday, reminderText, type BLang } from "@/lib/atharBirthday";

// Daily birthday reminders of the Athar bot (see lib/atharBirthday.ts): to each person who told the bot their birthday, one message a week
// before and one on the day, each at most once (the last one sent is kept in birthday_notified). Runs once a day (vercel.json).
export const maxDuration = 60;
const isLang = (x: string): x is BLang => LANGS.some((l) => l.code === x);

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const isAuthorized = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!isAuthorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const bots = await prisma.bot.findMany({ where: { template: "ATHAR_BOT", isActive: true }, select: { id: true, token: true } });
  const rows = await birthdayRows(prisma as any, bots.map((b) => b.id));
  const token = new Map(bots.map((b) => [b.id, b.token]));
  const now = new Date();
  let sent = 0, due = 0;
  const avail = new Map<number, boolean | null>();   // what the Athar server says about a date, asked once per date

  for (const r of rows) {
    const nb = nextBirthday({ month: r.birth_month, day: r.birth_day }, now);
    const kind = nb.days === 7 ? "week" : nb.days === 0 ? "day" : null;
    if (!kind) continue;
    const key = `${nb.year}:${kind}`;
    if (r.birthday_notified === key) continue;
    due++;
    const lang: BLang = isLang(r.lang) ? r.lang : "en";
    const b = { month: r.birth_month, day: r.birth_day, year: r.birth_year };
    const probe = reminderText(lang, b, kind, nb.year, null);
    if (!avail.has(probe.index)) {
      try {
        const j: any = await (await fetch(`${ATHAR_URL}/api/date/${probe.index}`, { cache: "no-store", signal: AbortSignal.timeout(8000) })).json();
        avail.set(probe.index, Array.isArray(j.taken) && j.onChain ? !(j.taken[0] && j.taken[1] && j.taken[2]) : null);
      } catch { avail.set(probe.index, null); }
    }
    const m = reminderText(lang, b, kind, nb.year, avail.get(probe.index) ?? null);
    const url = `${ATHAR_URL}/date?i=${m.index}&lang=${lang}`;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token.get(r.bot_id)}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: Number(r.tg_user_id), text: m.text, reply_markup: { inline_keyboard: [[{ text: m.button, web_app: { url } }]] } }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) { sent++; await markNotified(prisma as any, r.bot_id, r.tg_user_id, key); }
      else if (res.status === 403) await markNotified(prisma as any, r.bot_id, r.tg_user_id, key);   // they blocked the bot: do not try again this year
    } catch { /* tomorrow's run is too late for the week-before reminder, but the day-of one still goes */ }
  }
  return NextResponse.json({ ok: true, candidates: rows.length, due, sent });
}
