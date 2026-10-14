import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { rateLimit, toPublicProfile, validatePrefInput, validateProfileInput, verifyInitData } from "@/lib/match/inline";
import { availableProfiles, botUsername, sendChatRequest } from "@/lib/match/hybrid";
import {
  COMPLIMENTS, COMPLIMENTS_PER_DAY, FREE_ANON_CHATS_PER_DAY, FREE_SUPERLIKES_PER_DAY, ICEBREAKERS, REFERRAL_VIP_DAYS,
  canSpin, complimentText, compatibilityScore, countVerifiedReferrals, countryFlag, onlineLabel, pickSpinPrize, referralState, sanitizeAnonFilter,
} from "@/lib/match/premium";
import { addComplimentOnce, addPass, bumpDaily, claimReferral, getDaily, recentPasses, referralClaimed, saveAnonFilter, takeDaily } from "@/lib/match/appStore";
import { anonEnd, anonPoll, anonReport, anonReveal, anonSend, anonStart } from "@/lib/match/anon";
import { grantReferralReward, notifyAdminNewProfile, notifyMutualLike } from "@/lib/matchBotLogic";
import { hubGenerate } from "@/lib/hub/ai";

/**
 * Premium Mini App backend for one MARRIAGE_BOT instance (/match-app/<botId>).
 * Every call carries Telegram WebApp initData verified with THIS bot's stored
 * token. Same tables as the bot (+ small match_app_* tables). Never returns
 * another member's name, contact, Telegram id or free-text bio.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const err = (message: string, status = 400) => NextResponse.json({ ok: false, error: message }, { status });
const isVip = (u: { vipUntil: Date | null }) => !!u.vipUntil && u.vipUntil > new Date();

export async function POST(req: NextRequest, props: { params: Promise<{ botId: string }> }) {
  const { botId } = await props.params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.initData !== "string") return err("طلب غير صالح");
  const botRow = await prisma.bot.findUnique({ where: { id: botId } });
  if (!botRow || !botRow.isActive || botRow.template !== "MARRIAGE_BOT") return err("البوت غير متاح", 404);
  const tg = verifyInitData(body.initData, botRow.token);
  if (!tg) return err("افتح التطبيق من داخل تلجرام", 401);
  if (!rateLimit(`app:${botId}:${tg.id}`, 120, 60_000)) return err("طلبات كثيرة، تمهّل قليلاً", 429);

  const user = await prisma.matchUser.findUnique({ where: { id: tg.id }, include: { profile: true, preference: true } });
  if (!user) return NextResponse.json({ ok: true, registered: false, reason: "start" });
  if (user.isBanned) return err("حسابك محظور", 403);
  if (!user.phoneVerified) return NextResponse.json({ ok: true, registered: false, reason: "phone" });
  if (user.mutedUntil && user.mutedUntil > new Date() && body.action !== "me") return err("حسابك مقيّد مؤقتاً", 403);
  void prisma.matchUser.update({ where: { id: tg.id }, data: { lastActiveAt: new Date() } }).catch(() => null);

  const bot = new TelegramBot(botRow.token);
  const action = String(body.action || "me");
  const vip = isVip(user);

  try {
    if (action === "me") {
      const p = user.profile;
      const [daily, claimed, refs, username] = await Promise.all([
        getDaily(tg.id).catch(() => null),
        referralClaimed(tg.id).catch(() => false),
        prisma.matchUser.findMany({ where: { referredBy: tg.id }, select: { phoneVerified: true, isBanned: true, profile: { select: { status: true } } } }),
        botUsername(bot, botId),
      ]);
      let countryOnly = false;
      try { countryOnly = !!(await prisma.matchProfilePrivacy.findUnique({ where: { userId: tg.id } }))?.countryOnly; } catch { /* table optional */ }
      const verified = countVerifiedReferrals(refs.map((r) => ({ phoneVerified: r.phoneVerified, isBanned: r.isBanned, profileStatus: r.profile?.status ?? null })));
      return NextResponse.json({
        ok: true,
        registered: true,
        firstName: tg.firstName ?? null,
        profile: p && {
          gender: p.gender, name: p.name, age: p.age, country: p.country, job: p.job, education: p.education,
          attributes: p.attributes, city: p.city, maritalStatus: p.maritalStatus, contactMethod: p.contactMethod,
          contactValue: p.contactValue, status: p.status, isHidden: p.isHidden, verified: p.verificationStatus === "VERIFIED",
          shortId: toPublicProfile(p).shortId, flag: countryFlag(p.country),
          boostedUntil: p.boostedUntil, isIncognito: p.isIncognito,
        },
        preference: user.preference,
        privacy: { countryOnly },
        vipUntil: vip ? user.vipUntil : null,
        daily: daily && {
          spinAvailable: canSpin(daily.spins),
          superlikesLeft: Math.max(0, (vip ? 10 : FREE_SUPERLIKES_PER_DAY) + daily.extra_superlikes - daily.superlikes),
          anonLeft: vip ? null : Math.max(0, FREE_ANON_CHATS_PER_DAY + daily.extra_anon - daily.anon_chats),
          complimentsLeft: Math.max(0, COMPLIMENTS_PER_DAY - daily.compliments),
        },
        referral: { ...referralState(verified, claimed), link: username ? `https://t.me/${username}?start=ref_${tg.id}` : null, days: REFERRAL_VIP_DAYS },
        compliments: COMPLIMENTS,
      });
    }

    if (action === "saveProfile") {
      const v = validateProfileInput(body.profile);
      if (!v.ok) return err(v.error);
      const existing = user.profile;
      const status = existing?.status === "REJECTED" ? "PENDING" : "APPROVED"; // same rule as the bot wizard
      const sensitiveChanged = !existing || existing.name !== v.value.name || (existing.attributes ?? null) !== v.value.attributes;
      const saved = await prisma.matchProfile.upsert({ where: { userId: tg.id }, update: { ...v.value, status }, create: { userId: tg.id, ...v.value, status } });
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
    if (action === "privacy") {
      if (!user.profile) return err("لا يوجد ملف");
      if (typeof body.visible === "boolean") await prisma.matchProfile.update({ where: { userId: tg.id }, data: { isHidden: !body.visible } });
      if (typeof body.countryOnly === "boolean") {
        await prisma.matchProfilePrivacy.upsert({ where: { userId: tg.id }, update: { countryOnly: body.countryOnly }, create: { userId: tg.id, countryOnly: body.countryOnly } }).catch(() => null);
      }
      if (typeof body.incognito === "boolean" && vip) await prisma.matchProfile.update({ where: { userId: tg.id }, data: { isIncognito: body.incognito } });
      return NextResponse.json({ ok: true });
    }
    if (action === "visibility") { // v1 compatibility
      if (!user.profile) return err("لا يوجد ملف");
      await prisma.matchProfile.update({ where: { userId: tg.id }, data: { isHidden: !body.visible } });
      return NextResponse.json({ ok: true });
    }

    // ---- anonymous chat (profile not required, same as the bot) ----
    if (action.startsWith("anon_")) {
      const filter = sanitizeAnonFilter(body.filter);
      if (action === "anon_start" || action === "anon_next") {
        if (action === "anon_next") await anonEnd(bot, tg.id, "end");
        if (!vip && !(await takeDaily(tg.id, "anon_chats", FREE_ANON_CHATS_PER_DAY, "extra_anon"))) return err("وصلت لحد الدردشات اليومي. دوّر العجلة أو ادعُ أصدقاءك لفتح المزيد 🎡");
        await saveAnonFilter(tg.id, filter).catch(() => null);
        await anonStart(bot, botRow, tg.id, filter);
        return NextResponse.json({ ok: true, ...(await anonPoll(bot, botRow, tg.id, filter, 0)) });
      }
      if (action === "anon_poll") return NextResponse.json({ ok: true, ...(await anonPoll(bot, botRow, tg.id, filter, Math.max(0, Number(body.after) || 0), body.sessionId ? String(body.sessionId) : undefined)) });
      if (action === "anon_send") {
        if (!rateLimit(`anonmsg:${tg.id}`, 30, 60_000)) return err("أبطئ قليلاً");
        const r = await anonSend(bot, tg.id, String(body.text || ""));
        return r.ok ? NextResponse.json({ ok: true }) : err(r.error || "تعذّر الإرسال");
      }
      if (action === "anon_end") { await anonEnd(bot, tg.id, "end"); return NextResponse.json({ ok: true }); }
      if (action === "anon_block") { await anonEnd(bot, tg.id, "block"); return NextResponse.json({ ok: true, message: "تم الحظر" }); }
      if (action === "anon_report") { await anonReport(bot, tg.id); return NextResponse.json({ ok: true, message: "🚩 وصل البلاغ للإدارة" }); }
      if (action === "anon_reveal") return NextResponse.json({ ok: true, ...(await anonReveal(bot, tg.id)) });
      if (action === "anon_icebreaker") {
        if (!rateLimit(`ice:${tg.id}`, 6, 60_000)) return NextResponse.json({ ok: true, text: ICEBREAKERS[randomInt(ICEBREAKERS.length)] });
        const ai = await hubGenerate(
          "أنت تقترح سؤالاً واحداً قصيراً ولطيفاً ومحترماً لكسر الجليد بين شخصين يتعارفان بغرض الزواج في دردشة مجهولة. بالعربية، سطر واحد، بلا أسئلة شخصية حساسة، بلا طلب أرقام أو حسابات.",
          "اقترح سؤالاً لبدء الحديث", 60,
        ).catch(() => null);
        const text = ai?.text?.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 160);
        return NextResponse.json({ ok: true, text: text || ICEBREAKERS[randomInt(ICEBREAKERS.length)], ai: !!text });
      }
      return err("إجراء غير معروف");
    }

    if (action === "spin") {
      if (!(await takeDaily(tg.id, "spins", 1))) return err("لقد دوّرت العجلة اليوم. عد غداً 🎡");
      const { prize, index } = pickSpinPrize(randomInt(1_000_000) / 1_000_000);
      const now = Date.now();
      if (prize.key === "superlike2") await bumpDaily(tg.id, "extra_superlikes", 2);
      if (prize.key === "anon5") await bumpDaily(tg.id, "extra_anon", 5);
      if ((prize.key === "boost6h" || prize.key === "boost24h") && user.profile) {
        const base = Math.max(now, user.profile.boostedUntil?.getTime() ?? 0);
        await prisma.matchProfile.update({ where: { userId: tg.id }, data: { boostedUntil: new Date(base + (prize.key === "boost6h" ? 6 : 24) * 3600_000) } });
      }
      if (prize.key === "vip1d") {
        const base = Math.max(now, user.vipUntil?.getTime() ?? 0);
        await prisma.matchUser.update({ where: { id: tg.id }, data: { vipUntil: new Date(base + 86400_000) } });
      }
      return NextResponse.json({ ok: true, index, prize: prize.label, note: !user.profile && prize.key.startsWith("boost") ? "أنشئ ملفك ليستفيد من الرفع" : null });
    }

    if (action === "referral_claim") {
      const refs = await prisma.matchUser.findMany({ where: { referredBy: tg.id }, select: { phoneVerified: true, isBanned: true, profile: { select: { status: true } } } });
      const verified = countVerifiedReferrals(refs.map((r) => ({ phoneVerified: r.phoneVerified, isBanned: r.isBanned, profileStatus: r.profile?.status ?? null })));
      const st = referralState(verified, false);
      if (!st.canClaim) return err(`تحتاج ${st.needed} دعوات موثّقة (لديك ${verified})`);
      if (!(await claimReferral(tg.id))) return err("استلمت هذه المكافأة سابقاً");
      const base = Math.max(Date.now(), user.vipUntil?.getTime() ?? 0);
      await prisma.matchUser.update({ where: { id: tg.id }, data: { vipUntil: new Date(base + REFERRAL_VIP_DAYS * 86400_000) } });
      await bot.api.sendMessage(Number(tg.id), `👑 مبروك! فعّلت VIP لمدة ${REFERRAL_VIP_DAYS} أيام بفضل دعواتك.`).catch(() => null);
      return NextResponse.json({ ok: true, message: `👑 تم تفعيل VIP لمدة ${REFERRAL_VIP_DAYS} أيام` });
    }

    if (!user.profile || user.profile.status !== "APPROVED") return err("أنشئ ملفك أولاً");
    const myPub = toPublicProfile(user.profile);

    if (action === "discover" || action === "matches") {
      const pref = user.preference;
      const list = await availableProfiles(botId, tg.id, { ageMin: action === "discover" ? pref?.ageMin ?? undefined : undefined, ageMax: action === "discover" ? pref?.ageMax ?? undefined : undefined, keywords: [] });
      const ids = list.map((p) => p.userId);
      const [likedByMe, likedMe, passes, prefs, users, perms] = await Promise.all([
        prisma.matchLike.findMany({ where: { fromUserId: tg.id, toUserId: { in: ids } }, select: { toUserId: true } }),
        prisma.matchLike.findMany({ where: { toUserId: tg.id, fromUserId: { in: ids } }, select: { fromUserId: true } }),
        action === "discover" ? recentPasses(tg.id) : Promise.resolve(new Set<string>()),
        prisma.partnerPreference.findMany({ where: { userId: { in: ids } } }),
        prisma.matchUser.findMany({ where: { id: { in: ids } }, select: { id: true, lastActiveAt: true, vipUntil: true } }),
        prisma.matchPhotoPermission.findMany({ where: { viewerId: tg.id, ownerId: { in: ids }, status: "GRANTED" }, select: { ownerId: true } }),
      ]);
      const mine = new Set(likedByMe.map((l) => l.toUserId));
      const theirs = new Set(likedMe.map((l) => l.fromUserId));
      const prefOf = new Map(prefs.map((p) => [p.userId, p]));
      const userOf = new Map(users.map((u) => [u.id, u]));
      const granted = new Set(perms.map((p) => p.ownerId));
      const now = Date.now();
      const rows = list
        .filter((p) => (action === "discover" ? !mine.has(p.userId) && !passes.has(p.userId) : mine.has(p.userId) && theirs.has(p.userId)))
        .map((p) => {
          const u = userOf.get(p.userId);
          const compat = compatibilityScore(p, pref ?? { country: user.profile!.country }, user.profile, prefOf.get(p.userId) ?? null);
          const boosted = (p.boostedUntil && p.boostedUntil.getTime() > now) || (u?.vipUntil && u.vipUntil.getTime() > now);
          return {
            ...toPublicProfile(p),
            flag: countryFlag(p.country),
            compat,
            presence: onlineLabel(u?.lastActiveAt ?? new Date(0)),
            photo: !!p.photoFileId && granted.has(p.userId),
            photoLocked: !!p.photoFileId && !granted.has(p.userId),
            likedYou: action === "discover" && theirs.has(p.userId),
            boosted: !!boosted,
          };
        })
        .sort((a, b) => Number(b.boosted) - Number(a.boosted) || b.compat - a.compat);
      return NextResponse.json({ ok: true, me: myPub, items: rows.slice(0, 30) });
    }

    // ---- actions on a target profile (by public profile ref only) ----
    const ref = String(body.target || "").toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(ref)) return err("هدف غير صالح");
    const targetProfile = await prisma.matchProfile.findUnique({ where: { id: ref }, include: { user: { select: { botId: true, isBanned: true } } } });
    if (!targetProfile || targetProfile.user.botId !== botId || targetProfile.user.isBanned) return err("غير موجود", 404);
    const target = targetProfile.userId;
    if (target === tg.id) return err("هذا ملفك أنت");
    const blocked = await prisma.matchBlock.findFirst({ where: { OR: [{ blockerId: tg.id, blockedId: target }, { blockerId: target, blockedId: tg.id }] } });

    if (action === "photo") {
      const perm = await prisma.matchPhotoPermission.findUnique({ where: { ownerId_viewerId: { ownerId: target, viewerId: tg.id } } });
      if (blocked || perm?.status !== "GRANTED" || !targetProfile.photoFileId) return err("الصورة غير متاحة", 403);
      const file = await bot.api.getFile(targetProfile.photoFileId).catch(() => null);
      if (!file?.file_path || (file.file_size ?? 0) > 2_000_000) return err("الصورة غير متاحة", 404);
      const res = await fetch(`https://api.telegram.org/file/bot${botRow.token}/${file.file_path}`).catch(() => null);
      if (!res?.ok) return err("الصورة غير متاحة", 404);
      const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
      return NextResponse.json({ ok: true, src: `data:image/jpeg;base64,${b64}` });
    }

    if (blocked && action !== "report") return err("هذا الملف غير متاح");

    if (action === "swipe") {
      const kind = String(body.kind);
      if (kind === "pass") { await addPass(tg.id, target); return NextResponse.json({ ok: true }); }
      if (kind === "propose") {
        if (!rateLimit(`prop:${tg.id}`, 5, 3600_000)) return err("حد طلبات الزواج: 5 في الساعة");
        const r = await sendChatRequest(bot, botRow, tg.id, target, "proposal");
        return NextResponse.json({ ok: r.ok, message: r.message });
      }
      if (kind !== "like" && kind !== "super") return err("نوع غير معروف");
      if (!rateLimit(`like:${tg.id}`, 60, 3600_000)) return err("أبطئ قليلاً");
      if (kind === "super" && !(await takeDaily(tg.id, "superlikes", vip ? 10 : FREE_SUPERLIKES_PER_DAY, "extra_superlikes"))) return err("انتهت الإعجابات المميزة لليوم ⭐");
      const existed = await prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: tg.id, toUserId: target } } });
      await prisma.matchLike.upsert({
        where: { fromUserId_toUserId: { fromUserId: tg.id, toUserId: target } },
        update: kind === "super" ? { note: "⭐ إعجاب مميز من التطبيق" } : {},
        create: { fromUserId: tg.id, toUserId: target, note: kind === "super" ? "⭐ إعجاب مميز من التطبيق" : null },
      });
      if (kind === "super") {
        await bot.api.sendMessage(Number(target), `⭐ حصلت على إعجاب مميز من ملف #${myPub.shortId} (${myPub.age} · ${myPub.country}). افتح «💌 من أعجب بي» أو التطبيق.`).catch(() => null);
      }
      const back = await prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: target, toUserId: tg.id } } });
      if (back && !existed) await notifyMutualLike(bot, tg.id, target).catch(() => null); // bot alerts both (existing behaviour)
      return NextResponse.json({ ok: true, match: !!back, card: back ? { ...toPublicProfile(targetProfile), flag: countryFlag(targetProfile.country) } : null });
    }

    if (action === "request") {
      const r = await sendChatRequest(bot, botRow, tg.id, target);
      return NextResponse.json({ ok: r.ok, message: r.message });
    }
    if (action === "photo_request") {
      if (!rateLimit(`preq:${tg.id}`, 10, 3600_000)) return err("حد الطلبات");
      const existing = await prisma.matchPhotoPermission.findUnique({ where: { ownerId_viewerId: { ownerId: target, viewerId: tg.id } } });
      if (existing) return NextResponse.json({ ok: true, message: existing.status === "PENDING" ? "طلبك قيد الانتظار" : existing.status === "GRANTED" ? "مسموح لك" : "رفض صاحب الملف" });
      await prisma.matchPhotoPermission.create({ data: { ownerId: target, viewerId: tg.id } });
      await bot.api.sendMessage(Number(target), `🔒 ملف #${myPub.shortId} يطلب رؤية صورتك.`, {
        reply_markup: { inline_keyboard: [[{ text: "✅ سماح", callback_data: `mphotoyes|${tg.id}` }, { text: "❌ رفض", callback_data: `mphotono|${tg.id}` }]] },
      }).catch(() => null);
      return NextResponse.json({ ok: true, message: "📨 أُرسل طلب رؤية الصورة" });
    }
    if (action === "compliment") {
      const text = complimentText(Number(body.index));
      if (!text) return err("اختر مجاملة من القائمة");
      if (!(await addComplimentOnce(tg.id, target))) return err("أرسلت مجاملة لهذا الملف اليوم");
      if (!(await takeDaily(tg.id, "compliments", COMPLIMENTS_PER_DAY))) return err("انتهت مجاملات اليوم");
      await bot.api.sendMessage(Number(target), `💌 معجب سرّي أرسل لك:\n«${text}»\n\nلن نكشف هويته. ربما تجده في المطابقات 😉`).catch(() => null);
      return NextResponse.json({ ok: true, message: "💌 وصلت مجاملتك بسرية" });
    }
    if (action === "block") {
      await prisma.matchBlock.upsert({ where: { blockerId_blockedId: { blockerId: tg.id, blockedId: target } }, update: {}, create: { blockerId: tg.id, blockedId: target } }).catch(() => null);
      return NextResponse.json({ ok: true, message: "تم الحظر" });
    }
    if (action === "report") {
      if (!rateLimit(`rep:${botId}:${tg.id}`, 5, 3600_000)) return err("حد البلاغات", 429);
      await prisma.matchReport.create({ data: { reporterId: tg.id, targetId: target, reason: String(body.reason || "من التطبيق").slice(0, 200), source: "SEARCH" } });
      return NextResponse.json({ ok: true, message: "شكراً، وصل البلاغ للإدارة" });
    }
    return err("إجراء غير معروف");
  } catch (e) {
    console.error("match-app", action, (e as Error)?.message);
    return err("حدث خطأ، حاول مجدداً", 500);
  }
}
