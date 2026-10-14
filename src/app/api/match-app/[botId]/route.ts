import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { rateLimit, toPublicProfile, validatePrefInput, validateProfileInput, verifyInitData } from "@/lib/match/inline";
import { availableProfiles, botUsername, sendChatRequest } from "@/lib/match/hybrid";
import { COMPLIMENTS, COMPLIMENTS_PER_DAY, ICEBREAKERS, SUPERLIKE_NOTE_MAX, complimentText, countryFlag, onlineLabel, sanitizeAnonFilter } from "@/lib/match/premium";
import { addComplimentOnce, getDaily, saveAnonFilter, takeDaily } from "@/lib/match/appStore";
import {
  PRICE_VERIFIED_BADGE, UPGRADE_CATALOGUE, depositLink, chargeSuperLike, entitlementSummary, hasAdvancedFilters, isVipActive,
  purchaseBoost, purchaseVip, toggleIncognito, unlockAdvancedFilters, unlockExtraPhotos, unlockProfileVisitors, type Purchase,
} from "@/lib/match/entitlements";
import { STAR_DEPOSIT_TIERS, starsPayload, usdForStars } from "@/lib/starsPayment";
import { isNativeTonConfigured, getMasterHotWalletAddress } from "@/services/ton-service";
import { getOrCreateMatchTonMemo } from "@/services/marriageTonService";
import { anonEnd, anonPoll, anonReport, anonReveal, anonSend, anonStart } from "@/lib/match/anon";
import { trackProfileVisit, buildSearchQueue, compatibilityPercent, containsMatchBannedWords, defaultPref, grantReferralReward, notifyAdminNewProfile, notifyMutualLike, plainBackMenu } from "@/lib/matchBotLogic";
import { scrubContacts } from "@/lib/match/inline";
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
// Purchase result -> app message (same wording as the bot's insufficient-balance reply, minus the raw link).
function purchaseError(r: Exclude<Purchase, { ok: true }>): string {
  if (r.reason === "insufficient") return `رصيدك $${r.balance.toFixed(2)} لا يكفي (المطلوب $${r.needed.toFixed(2)}). اشحن رصيدك من الأسفل.`;
  return ({ no_profile: "⚠️ يجب إنشاء ملفك الشخصي أولاً.", no_pref: "⚠️ يجب تحديد «💍 مواصفات الشريك» الأساسية أولاً.", vip_included: "✨ اشتراكك الذهبي (VIP) يشمل رفعاً مستمراً لملفك بالفعل.", not_vip: "🕶 وضع التخفي متاح فقط للأعضاء الذهبيين.", no_user: "ابدأ البوت أولاً." } as const)[r.reason];
}

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
  const vip = isVipActive(user);

  try {
    if (action === "me") {
      const p = user.profile;
      const [daily, referralsRewarded, username] = await Promise.all([
        getDaily(tg.id).catch(() => null),
        prisma.matchUser.count({ where: { referredBy: tg.id, referralRewardGranted: true } }),
        botUsername(bot, botId),
      ]);
      let countryOnly = false;
      try { countryOnly = !!(await prisma.matchProfilePrivacy.findUnique({ where: { userId: tg.id } }))?.countryOnly; } catch { /* table optional */ }
      return NextResponse.json({
        ok: true,
        registered: true,
        firstName: tg.firstName ?? null,
        profile: p && {
          gender: p.gender, name: p.name, age: p.age, country: p.country, job: p.job, education: p.education,
          attributes: p.attributes, city: p.city, maritalStatus: p.maritalStatus, contactMethod: p.contactMethod,
          contactValue: p.contactValue, status: p.status, isHidden: p.isHidden, verified: p.verificationStatus === "VERIFIED",
          shortId: toPublicProfile(p).shortId, flag: countryFlag(p.country),
        },
        preference: user.preference,
        privacy: { countryOnly },
        ent: entitlementSummary(user, p),
        catalogue: UPGRADE_CATALOGUE,
        deposit: { stars: STAR_DEPOSIT_TIERS.map((s) => ({ stars: s, usd: usdForStars(s) })), web: depositLink(tg.id), ton: isNativeTonConfigured() },
        complimentsLeft: daily ? Math.max(0, COMPLIMENTS_PER_DAY - daily.compliments) : COMPLIMENTS_PER_DAY,
        // Bot's own referral reward: 24h boost per invited friend whose profile goes live.
        referral: { link: username ? `https://t.me/${username}?start=ref_${tg.id}` : null, rewarded: referralsRewarded },
        compliments: COMPLIMENTS,
      });
    }

    // ---- upgrades: exactly the bot's «⭐ الترقيات والمزايا» (shared functions) ----
    if (action === "upgrade") {
      if (!rateLimit(`buy:${tg.id}`, 10, 60_000)) return err("تمهّل قليلاً");
      const key = String(body.key);
      if (key === "boost") { const r = await purchaseBoost(tg.id); return r.ok ? NextResponse.json({ ok: true, message: `🚀 تم رفع ملفك حتى ${r.boostedUntil.toLocaleString("ar")}` }) : err(purchaseError(r)); }
      if (key === "vip") { const r = await purchaseVip(tg.id); return r.ok ? NextResponse.json({ ok: true, message: `👑 تم تفعيل العضوية الذهبية حتى ${r.vipUntil.toLocaleString("ar")}` }) : err(purchaseError(r)); }
      if (key === "visitors") { const r = await unlockProfileVisitors(tg.id); return r.ok ? NextResponse.json({ ok: true, message: "👀 تم التفعيل", open: "visitors" }) : err(purchaseError(r)); }
      if (key === "filters") { const r = await unlockAdvancedFilters(tg.id); return r.ok ? NextResponse.json({ ok: true, message: "🎯 الفلاتر المتقدمة مفعّلة — أضف المدينة والحالة الاجتماعية في معايير الزواج" }) : err(purchaseError(r)); }
      if (key === "photos") {
        const r = await unlockExtraPhotos(tg.id);
        if (!r.ok) return err(purchaseError(r));
        const slot: 2 | 3 | null = !r.profile.photoFileId2 ? 2 : !r.profile.photoFileId3 ? 3 : null;
        if (!slot) return NextResponse.json({ ok: true, message: "لديك بالفعل الحد الأقصى من الصور (3)." });
        await prisma.matchUser.update({ where: { id: tg.id }, data: { pendingAction: { mode: "extra_photo_upload", slot } as any } });
        await bot.api.sendMessage(Number(tg.id), "🖼 أرسل الصورة الإضافية الآن:", { reply_markup: plainBackMenu() }).catch(() => null);
        return NextResponse.json({ ok: true, message: "🖼 افتح محادثة البوت وأرسل الصورة الإضافية", toBot: true });
      }
      if (key === "verify") {
        const p = user.profile;
        if (!p) return err("⚠️ يجب إنشاء ملفك الشخصي أولاً.");
        if (p.verificationStatus === "VERIFIED") return NextResponse.json({ ok: true, message: "✅ ملفك موثّق بالفعل." });
        if (p.verificationStatus === "PENDING") return NextResponse.json({ ok: true, message: "⏳ طلب التوثيق الخاص بك قيد المراجعة." });
        await prisma.matchUser.update({ where: { id: tg.id }, data: { pendingAction: { mode: "verify_badge_photo" } as any } });
        await bot.api.sendMessage(Number(tg.id), `☑️ أرسل صورة واضحة لهويتك الرسمية (سيُخصم $${PRICE_VERIFIED_BADGE} عند الإرسال، رسم مراجعة غير قابل للاسترجاع — لن تُعرض الصورة لأي مستخدم آخر، للمراجعة الإدارية فقط):`, { reply_markup: plainBackMenu() }).catch(() => null);
        return NextResponse.json({ ok: true, message: "☑️ افتح محادثة البوت وأرسل صورة الهوية", toBot: true });
      }
      if (key === "incognito") { const r = await toggleIncognito(tg.id, typeof body.on === "boolean" ? body.on : undefined); return r.ok ? NextResponse.json({ ok: true, message: r.on ? "🕶 تم تفعيل وضع التخفي." : "👁 تم إيقاف وضع التخفي." }) : err(purchaseError(r)); }
      return err("ميزة غير معروفة");
    }
    if (action === "visitors") {
      if (!(user.profileVisitorsUnlocked || vip)) return err("فعّل «👀 من زار ملفي» أولاً");
      const visits = await prisma.matchProfileVisit.findMany({ where: { ownerId: tg.id }, orderBy: { visitedAt: "desc" }, take: 20 });
      const profs = await prisma.matchProfile.findMany({ where: { userId: { in: visits.map((v) => v.viewerId) } } });
      const byUser = new Map(profs.map((p) => [p.userId, p]));
      return NextResponse.json({
        ok: true,
        items: visits.map((v) => {
          const p = byUser.get(v.viewerId);
          // Privacy in the app: public card fields only (no names/contacts).
          return p ? { ...toPublicProfile(p), flag: countryFlag(p.country), at: onlineLabel(v.visitedAt).label } : { ref: null, shortId: "—", at: onlineLabel(v.visitedAt).label };
        }),
      });
    }
    if (action === "deposit_stars") {
      const stars = Number(body.stars);
      if (!(STAR_DEPOSIT_TIERS as readonly number[]).includes(stars)) return err("باقة غير صالحة");
      // Same invoice as the bot's «mstars» button: payload MATCH_DEPOSIT:<uid>, credited by the bot's successful_payment handler.
      const link = await bot.api.createInvoiceLink("شحن رصيد بوت الزواج", `شحن $${usdForStars(stars).toFixed(2)} في رصيدك عبر نجوم تيليجرام`, starsPayload("MATCH_DEPOSIT", tg.id), "", "XTR", [{ label: "شحن رصيد بوت الزواج", amount: stars }]).catch(() => null);
      return link ? NextResponse.json({ ok: true, link }) : err("تعذّر إنشاء الفاتورة");
    }
    if (action === "deposit_ton") {
      if (!isNativeTonConfigured()) return err("غير متاح");
      return NextResponse.json({ ok: true, address: getMasterHotWalletAddress(), memo: await getOrCreateMatchTonMemo(tg.id) });
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
      // City / marital status are the bot's paid «🎯 فلاتر متقدمة» fields: saved only when entitled.
      const adv = hasAdvancedFilters(user)
        ? { city: String(body.preference?.city || "").trim().slice(0, 40) || null, maritalStatus: String(body.preference?.maritalStatus || "").trim().slice(0, 30) || null }
        : {};
      await prisma.partnerPreference.upsert({ where: { userId: tg.id }, update: { ...v.value, ...adv }, create: { userId: tg.id, ...v.value, ...adv } });
      return NextResponse.json({ ok: true });
    }
    if (action === "privacy") {
      if (!user.profile) return err("لا يوجد ملف");
      if (typeof body.visible === "boolean") await prisma.matchProfile.update({ where: { userId: tg.id }, data: { isHidden: !body.visible } });
      if (typeof body.countryOnly === "boolean") {
        await prisma.matchProfilePrivacy.upsert({ where: { userId: tg.id }, update: { countryOnly: body.countryOnly }, create: { userId: tg.id, countryOnly: body.countryOnly } }).catch(() => null);
      }
      if (typeof body.incognito === "boolean") await toggleIncognito(tg.id, body.incognito);
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

    if (!user.profile || user.profile.status !== "APPROVED") return err("أنشئ ملفك أولاً");
    const myPub = toPublicProfile(user.profile);

    if (action === "discover" || action === "matches") {
      const myProfile = user.profile;
      const pref = user.preference ?? defaultPref(tg.id, myProfile);
      const advanced = hasAdvancedFilters(user);
      const strict = action === "discover" && !!body.strict && advanced && !!user.preference; // «🎯 بحث دقيق» — same gate as the bot
      let ids: string[];
      if (action === "discover") {
        ids = await buildSearchQueue(botId, tg.id, myProfile, pref, strict); // the bot's own ranking engine
      } else {
        const [mine, theirs] = await Promise.all([
          prisma.matchLike.findMany({ where: { fromUserId: tg.id }, select: { toUserId: true } }),
          prisma.matchLike.findMany({ where: { toUserId: tg.id }, select: { fromUserId: true } }),
        ]);
        const back = new Set(theirs.map((l) => l.fromUserId));
        ids = mine.map((l) => l.toUserId).filter((id) => back.has(id));
      }
      // Exactly the bot's queue order; like the bot's «➡️ الملف التالي» we only
      // re-check block + APPROVED per card (advanceSearch), nothing app-specific.
      const pick = ids.slice(0, 30);
      const [perms, blocks] = await Promise.all([
        prisma.matchPhotoPermission.findMany({ where: { viewerId: tg.id, ownerId: { in: pick }, status: "GRANTED" }, select: { ownerId: true } }),
        prisma.matchBlock.findMany({ where: { OR: [{ blockerId: tg.id, blockedId: { in: pick } }, { blockedId: tg.id, blockerId: { in: pick } }] } }),
      ]);
      const granted = new Set(perms.map((p) => p.ownerId));
      const blockedIds = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
      const profiles = await prisma.matchProfile.findMany({
        where: { userId: { in: pick.filter((id) => !blockedIds.has(id)) }, status: "APPROVED" },
        include: { user: { select: { lastActiveAt: true, vipUntil: true } } },
      });
      const byId = new Map(profiles.map((p) => [p.userId, p]));
      const now = new Date();
      const items = pick.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({
        ...toPublicProfile(p),
        flag: countryFlag(p.country),
        compat: compatibilityPercent(p, pref, advanced), // bot's own «💞 توافق X%»
        presence: onlineLabel(p.user.lastActiveAt),
        photo: !!p.photoFileId && granted.has(p.userId),
        photoLocked: !!p.photoFileId && !granted.has(p.userId),
        boosted: (!!p.boostedUntil && p.boostedUntil > now) || (!!p.user.vipUntil && p.user.vipUntil > now),
      }));
      return NextResponse.json({ ok: true, me: myPub, items, strict, advanced });
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

    if (action === "seen") {
      // The bot records a visit each time it shows a card (sendSearchCard); same here.
      await trackProfileVisit(target, tg.id).catch(() => null);
      return NextResponse.json({ ok: true });
    }

    if (action === "swipe") {
      const kind = String(body.kind);
      if (kind === "pass") return NextResponse.json({ ok: true }); // bot's «➡️ الملف التالي»: no stored state
      if (kind === "propose") {
        if (!rateLimit(`prop:${tg.id}`, 5, 3600_000)) return err("حد طلبات الزواج: 5 في الساعة");
        const r = await sendChatRequest(bot, botRow, tg.id, target, "proposal");
        return NextResponse.json({ ok: r.ok, message: r.message });
      }
      if (kind !== "like" && kind !== "super") return err("نوع غير معروف");
      if (!rateLimit(`like:${tg.id}`, 60, 3600_000)) return err("أبطئ قليلاً");
      const existed = await prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: tg.id, toUserId: target } } });
      if (kind === "super") {
        // ⭐ = the bot's paid Super Like ($1 from balance) with a short note, same checks.
        const note = String(body.note || "").trim().slice(0, SUPERLIKE_NOTE_MAX);
        if (!note) return err("اكتب رسالة قصيرة ترافق إعجابك المميز");
        if (containsMatchBannedWords(note)) return err("⚠️ هذه الرسالة تحتوي على محتوى غير مسموح به.");
        if (scrubContacts(note) !== note.replace(/\s+/g, " ").trim()) return err("🔒 لا تضع أرقاماً أو حسابات في الرسالة");
        const r = await chargeSuperLike(tg.id, target, note);
        if (!r.ok) return err(purchaseError(r));
        await notifyMutualLike(bot, tg.id, target).catch(() => null); // bot does the same after a super like
      } else {
        await prisma.matchLike.upsert({ where: { fromUserId_toUserId: { fromUserId: tg.id, toUserId: target } }, update: {}, create: { fromUserId: tg.id, toUserId: target } });
      }
      const back = await prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: target, toUserId: tg.id } } });
      if (back && !existed && kind === "like") await notifyMutualLike(bot, tg.id, target).catch(() => null); // bot alerts both (existing behaviour)
      return NextResponse.json({ ok: true, match: !!back && !existed, card: back ? { ...toPublicProfile(targetProfile), flag: countryFlag(targetProfile.country) } : null, message: kind === "super" ? "⭐ تم إرسال إعجابك المميز مع رسالتك." : undefined });
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
