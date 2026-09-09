import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { token, template, ownerId, ref, activationCode, password } = await req.json();

    // MARRIAGE_BOT (owner spec, 2026-09-02): a separate, simple static-
    // password gate — deliberately NOT the AD_BOT's paid activation-code/
    // BotPurchase system, which only makes sense for the ad-network's
    // sell-activation-codes-to-third-party-creators model. This template
    // isn't sold to third parties (yet), so a single password set by the
    // owner in MARRIAGE_BOT_CREATOR_PASSWORD is all it needs.
    let purchase: { id: string } | null = null;
    if (template === "MARRIAGE_BOT") {
      const expected = process.env.MARRIAGE_BOT_CREATOR_PASSWORD;
      if (!expected || String(password || "") !== expected) {
        return NextResponse.json({ success: false, error: "كلمة السر غير صحيحة." }, { status: 400 });
      }
    } else if (template === "JOBS_BOT") {
      // Same private, owner-only gate as MARRIAGE_BOT (owner spec,
      // 2026-09-05) — a separate env var so the owner can reuse the same
      // secret value across both if they want a single shared password,
      // without the two templates sharing any actual code or table.
      const expected = process.env.JOBS_BOT_CREATOR_PASSWORD;
      if (!expected || String(password || "") !== expected) {
        return NextResponse.json({ success: false, error: "كلمة السر غير صحيحة." }, { status: 400 });
      }
    } else if (template === "MEDICAL_BOT") {
      // Same private, owner-only gate as MARRIAGE_BOT/JOBS_BOT (owner
      // spec, 2026-09-04) — this template isn't sold to third parties.
      const expected = process.env.MEDICAL_BOT_CREATOR_PASSWORD;
      if (!expected || String(password || "") !== expected) {
        return NextResponse.json({ success: false, error: "كلمة السر غير صحيحة." }, { status: 400 });
      }
    } else if (template === "NOVA_BOT") {
      // Same private, owner-only DEPLOY gate as the others above (owner
      // spec, 2026-09-05) — the owner deploys their own single instance;
      // real end-users then interact with THAT bot and pay for higher
      // quota via /subscribe, same commercial shape AD_BOT already has
      // (owner deploys once, many external users use it).
      const expected = process.env.NOVA_BOT_CREATOR_PASSWORD;
      if (!expected || String(password || "") !== expected) {
        return NextResponse.json({ success: false, error: "كلمة السر غير صحيحة." }, { status: 400 });
      }
    } else {
      // Gate on a paid, admin-approved activation code (owner spec,
      // 2026-08-31) — /bots was previously open to anyone with a token and
      // an ID, letting every bot user turn themselves into a "creator" for
      // free. The code is minted only once السوبر أدمن approves a $100
      // bank-transfer request (see decideBotPurchase in adBotLogic.ts) and
      // is tied to that specific buyer's Telegram ID, so it can't be reused
      // for someone else's ownerId or for a second bot. The platform owner
      // themself is exempt — they approve their own codes anyway.
      const isSuperAdmin = process.env.SUPER_ADMIN_TELEGRAM_ID && String(ownerId) === process.env.SUPER_ADMIN_TELEGRAM_ID;
      if (!isSuperAdmin) {
        const code = String(activationCode || "").trim().toUpperCase();
        if (!code) {
          return NextResponse.json({ success: false, error: "كود التفعيل مطلوب. اطلبه من داخل أي بوت على المنصة عبر زر «أريد بوتاً مماثلاً»." }, { status: 400 });
        }
        const found = await prisma.botPurchase.findUnique({ where: { code } });
        if (!found || found.status !== "APPROVED" || found.buyerId !== String(ownerId)) {
          return NextResponse.json({ success: false, error: "كود التفعيل غير صالح أو غير مطابق لآيدي المالك المُدخل." }, { status: 400 });
        }
        purchase = found;
      }
    }

    const existing = await prisma.bot.findUnique({ where: { token } });
    if (existing) {
      return NextResponse.json({ success: false, error: "هذا التوكن مُفعّل بالفعل على المنصة. أنشئ توكن جديد من BotFather إن كنت تريد بوتاً إضافياً، أو تواصل مع الدعم إن كانت هذه محاولة تفعيل فاشلة سابقة." }, { status: 400 });
    }

    const tempBot = new Bot(token);
    const botInfo = await tempBot.api.getMe();

    // B2B bot-creator referral (owner spec, 2026-08-31): whoever's referral
    // link this bot was activated through gets an ongoing 5% cut of the
    // platform's net profit from this bot's activity — see payoutTask in
    // adBotLogic.ts. Self-referral is meaningless, so it's dropped here.
    const referredByOwnerId = ref && String(ref).trim() && String(ref).trim() !== String(ownerId) ? String(ref).trim() : null;

    // Webhook is set up BEFORE the Bot row is created (owner spec fix,
    // 2026-09-02): a pre-generated id lets us build the webhook URL without
    // the row existing yet, so a failed/rejected setWebhook call (bad
    // token, Telegram outage) never leaves an orphaned row behind that
    // would then block every retry with "Unique constraint on token".
    const botId = crypto.randomUUID();
    const webhookSecret = crypto.randomBytes(32).toString("hex");
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
    const webhookUrl = `${siteUrl}/api/telegram/${botId}`;
    await tempBot.api.setWebhook(webhookUrl, { secret_token: webhookSecret });

    const newBot = await prisma.bot.create({
      data: {
        id: botId,
        token,
        template: template || "AD_BOT",
        ownerId: String(ownerId),
        webhookSecret,
        referredByOwnerId,
      },
    });

    if (purchase) {
      await prisma.botPurchase.update({ where: { id: purchase.id }, data: { status: "REDEEMED" } });
    }

    return NextResponse.json({
      success: true,
      message: `تم تفعيل البوت @${botInfo.username} بنجاح!`,
      botId: newBot.id,
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json({ success: false, error: "هذا التوكن مُفعّل بالفعل على المنصة." }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: error.message || "فشل التفعيل" }, { status: 400 });
  }
}
