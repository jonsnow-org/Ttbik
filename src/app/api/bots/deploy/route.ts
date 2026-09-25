import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const PASSWORD_TEMPLATES = ["MARRIAGE_BOT", "JOBS_BOT", "MEDICAL_BOT", "NOVA_BOT", "CONFESSION_BOT", "NAME_COMPAT_BOT"];

// Each template has its own <TEMPLATE>_CREATOR_PASSWORD env var. A newly
// added template whose variable was never set on Vercel used to reject
// every password (the owner uses one shared password for all of them), so
// when the template's own variable is missing, any creator password that
// IS configured for the other templates is accepted instead. Input is
// trimmed: mobile keyboards often append a space.
function creatorPasswordOk(template: string, password: unknown): boolean {
  const given = String(password ?? "").trim();
  if (!given) return false;
  const own = process.env[`${template}_CREATOR_PASSWORD`]?.trim();
  const candidates = own
    ? [own]
    : PASSWORD_TEMPLATES.map((t) => process.env[`${t}_CREATOR_PASSWORD`]?.trim()).filter((v): v is string => !!v);
  const g = Buffer.from(given);
  return candidates.some((c) => {
    const e = Buffer.from(c);
    return e.length === g.length && crypto.timingSafeEqual(e, g);
  });
}

export async function POST(req: NextRequest) {
  try {
    const { token, template, ownerId, ref, activationCode, password } = await req.json();

    let purchase: { id: string } | null = null;
    if (PASSWORD_TEMPLATES.includes(template)) {
      // Private, owner-only templates (MARRIAGE_BOT, JOBS_BOT, MEDICAL_BOT,
      // NOVA_BOT, CONFESSION_BOT, NAME_COMPAT_BOT) — not sold to third
      // parties, so a static creator password is the whole gate. See
      // creatorPasswordOk for how the expected value is found.
      if (!creatorPasswordOk(template, password)) {
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
