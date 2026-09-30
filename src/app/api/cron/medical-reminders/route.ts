import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Bot as TelegramBot } from "grammy";

// Day-before appointment reminder for MEDICAL_BOT (owner spec, 2026-09-04).
// Deliberately only the ~24h-before reminder, not a 1h-before one: every
// cron in this project runs once daily (see vercel.json), which cannot
// reliably deliver a "1 hour before" reminder — shipping one that
// silently never fires on time would be worse than not having it. A
// tighter schedule can be added later if the Vercel plan supports it.
//
// Window is intentionally wide (next 18-36h) rather than exactly 24h, so
// a single daily run still catches every CONFIRMED appointment happening
// "tomorrow" regardless of what time of day the cron itself runs.
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
}

function formatDateTime(d: Date): string {
  const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} — ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() + 18 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);

  const appointments = await prisma.medAppointment.findMany({
    where: {
      status: "CONFIRMED",
      reminder24hSent: false,
      appointmentAt: { gte: windowStart, lt: windowEnd },
    },
    include: { doctor: { include: { facility: true, department: { include: { facility: true } } } } },
    take: 200,
  });

  if (appointments.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const botRow = await prisma.bot.findFirst({ where: { template: "MEDICAL_BOT" } });
  if (!botRow) {
    return NextResponse.json({ ok: true, sent: 0, note: "no MEDICAL_BOT instance deployed" });
  }
  const bot = new TelegramBot(botRow.token);

  let sent = 0;
  for (const appt of appointments) {
    const facility = appt.doctor.facility || appt.doctor.department?.facility;
    await bot.api
      .sendMessage(
        Number(appt.patientId),
        `⏰ تذكير: لديك موعد غداً مع د. ${appt.doctor.name}${facility ? ` في ${facility.name}` : ""}\n🕐 ${formatDateTime(appt.appointmentAt)}`
      )
      .catch(() => null);
    await prisma.medAppointment.update({ where: { id: appt.id }, data: { reminder24hSent: true } });
    sent++;
  }

  return NextResponse.json({ ok: true, checked: appointments.length, sent });
}
