import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { rateLimit, toPublicProfile, validatePrefInput, validateProfileInput, verifyInitData } from "@/lib/match/inline";
import { availableProfiles, sendChatRequest } from "@/lib/match/hybrid";
import { grantReferralReward, notifyAdminNewProfile } from "@/lib/matchBotLogic";

/**
 * Mini App backend for one MARRIAGE_BOT instance (/match-app/<botId>).
 * Every call carries Telegram WebApp initData, verified with THIS bot's stored
 * token (HMAC, timing-safe, auth_date freshness). Same tables as the bot.
 * Never returns another member's name, contact, photo or free-text bio.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const err = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });

export async function POST(req: NextRequest, props: { params: Promise<{ botId: string }> }) {
  const { botId } = await props.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.initData !== "string") return err("طلب غير صالح");
  const botRow = await prisma.bot.findUnique({ where: { id: botId } });
  if (!botRow || !botRow.isActive || botRow.template !== "MARRIAGE_BOT") return err("البوت غير متاح", 404);
  const tg = verifyInitData(body.initData, botRow.token);
  if (!tg) return err("افتح التطبيق من داخل تلجرام", 401);
  if (!rateLimit(`app:${botId}:${tg.id}`, 60, 60_000)) return err("طلبات كثيرة، تمهّل قليلاً", 429);

  const user = await prisma.matchUser.findUnique({ where: { id: tg.id }, include: { profile: true, preference: true } });
  if (!user) return NextResponse.json({ ok: true, registered: false, reason: "start" });
  if (user.isBanned) return err("حسابك محظور", 403);
  if (!user.phoneVerified) return NextResponse.json({ ok: true, registered: false, reason: "phone" });

  const bot = new TelegramBot(botRow.token);
  const action = String(body.action || "me");

  if (action === "me") {
    const p = user.profile;
    return NextResponse.json({
      ok: true,
      registered: true,
      profile: p && {
        gender: p.gender, name: p.name, age: p.age, country: p.country, job: p.job, education: p.education,
        attributes: p.attributes, city: p.city, maritalStatus: p.maritalStatus, contactMethod: p.contactMethod,
        contactValue: p.contactValue, status: p.status, isHidden: p.isHidden,
      },
      preference: user.preference,
    });
  }

  if (action === "saveProfile") {
    const v = validateProfileInput(body.profile);
    if (!v.ok) return err(v.error);
    const existing = user.profile;
    const status = existing?.status === "REJECTED" ? "PENDING" : "APPROVED"; // same rule as the bot wizard
    const sensitiveChanged = !existing || existing.name !== v.value.name || (existing.attributes ?? null) !== v.value.attributes;
    const saved = await prisma.matchProfile.upsert({
      where: { userId: tg.id },
      update: { ...v.value, status },
      create: { userId: tg.id, ...v.value, status },
    });
    if (status === "APPROVED" && !existing) await grantReferralReward(bot, tg.id).catch(() => null);
    if (process.env.SUPER_ADMIN_TELEGRAM_ID && (status === "PENDING" || sensitiveChanged)) await notifyAdminNewProfile(bot, saved).catch(() => null);
    return NextResponse.json({ ok: true, status });
  }

  if (action === "savePref") {
    const v = validatePrefInput(body.preference);
    if (!v.ok) return err(v.error);
    await prisma.partnerPreference.upsert({ where: { userId: tg.id }, update: v.value, create: { userId: tg.id, ...v.value } });
    return NextResponse.json({ ok: true });
  }

  if (action === "visibility") {
    if (!user.profile) return err("لا يوجد ملف");
    await prisma.matchProfile.update({ where: { userId: tg.id }, data: { isHidden: !body.visible } });
    return NextResponse.json({ ok: true });
  }

  if (!user.profile || user.profile.status !== "APPROVED") return err("أنشئ ملفك أولاً");

  if (action === "matches") {
    const pref = user.preference;
    const list = await availableProfiles(botId, tg.id, {
      ageMin: pref?.ageMin ?? undefined, ageMax: pref?.ageMax ?? undefined, keywords: [],
    });
    const wanted = (pref?.country || user.profile.country).trim().toLowerCase();
    list.sort((a, b) => Number(b.country.trim().toLowerCase() === wanted) - Number(a.country.trim().toLowerCase() === wanted));
    const off = Math.max(0, Number(body.offset) || 0);
    const page = list.slice(off, off + 20);
    return NextResponse.json({
      ok: true,
      items: page.map((p) => toPublicProfile(p)), // ref = profile uuid; Telegram ids never leave the server
      next: off + 20 < list.length ? off + 20 : null,
    });
  }

  const ref = String(body.target || "").toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(ref)) return err("هدف غير صالح");
  const targetProfile = await prisma.matchProfile.findUnique({ where: { id: ref }, select: { userId: true } });
  if (!targetProfile) return err("غير موجود", 404);
  const target = targetProfile.userId;
  if (target === tg.id) return err("هذا ملفك أنت");

  if (action === "request") {
    const r = await sendChatRequest(bot, botRow, tg.id, target);
    return NextResponse.json({ ok: r.ok, message: r.message });
  }
  if (action === "block") {
    await prisma.matchBlock.upsert({
      where: { blockerId_blockedId: { blockerId: tg.id, blockedId: target } },
      update: {},
      create: { blockerId: tg.id, blockedId: target },
    }).catch(() => null);
    return NextResponse.json({ ok: true, message: "تم الحظر" });
  }
  if (action === "report") {
    if (!rateLimit(`rep:${botId}:${tg.id}`, 5, 3600_000)) return err("حد البلاغات", 429);
    await prisma.matchReport.create({ data: { reporterId: tg.id, targetId: target, reason: String(body.reason || "من التطبيق").slice(0, 200), source: "SEARCH" } });
    return NextResponse.json({ ok: true, message: "شكراً، وصل البلاغ للإدارة" });
  }
  return err("إجراء غير معروف");
}
