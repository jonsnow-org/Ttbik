import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import {
  getTemplateReadyInfo,
  missingTablesArabicError,
  templateNeedsTableCheck,
} from "@/lib/templateTablesReady";

export const dynamic = "force-dynamic";
/** Deploy talks to Telegram + DB; keep under Hobby-friendly ceiling. */
export const maxDuration = 30;

const TOKEN_RE = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/;

/** Public marketplace: activation-code path only. */
const PUBLIC_TEMPLATES = ["AD_BOT"] as const;

/**
 * Owner-only templates gated by creator password.
 * ATHAR_BOT / FADAA_BOT are intentionally excluded — activated via admin paths, not /bots.
 */
const PASSWORD_TEMPLATES = [
  "MARRIAGE_BOT",
  "JOBS_BOT",
  "MEDICAL_BOT",
  "NOVA_BOT",
  "CONFESSION_BOT",
  "NAME_COMPAT_BOT",
  "QUIZ_BOT",
  "STREAK_BOT",
  "PRAYER_BOT",
  "CAPSULE_BOT",
] as const;

const ALLOWED_TEMPLATES = new Set<string>([...PUBLIC_TEMPLATES, ...PASSWORD_TEMPLATES]);

const TG_CALL_MS = 15_000;

function creatorPasswordOk(template: string, password: unknown): boolean {
  const given = String(password ?? "").trim();
  if (!given) return false;
  const own = process.env[`${template}_CREATOR_PASSWORD`]?.trim();
  const candidates = own
    ? [own]
    : PASSWORD_TEMPLATES.map((t) => process.env[`${t}_CREATOR_PASSWORD`]?.trim()).filter(
        (v): v is string => !!v
      );
  const g = Buffer.from(given);
  return candidates.some((c) => {
    const e = Buffer.from(c);
    return e.length === g.length && crypto.timingSafeEqual(e, g);
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, arabicTimeout: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(arabicTimeout)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function telegramArabicError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/انتهت مهلة/.test(msg)) return msg;
  if (/401|Unauthorized|invalid token|bot token/i.test(msg)) {
    return "التوكن غير صالح أو تم إلغاؤه من BotFather.";
  }
  if (/429|Too Many Requests/i.test(msg)) {
    return "تليجرام يحدّ الطلبات حالياً — انتظر قليلاً وأعد المحاولة.";
  }
  if (/timeout|aborted|AbortError|ETIMEDOUT|ECONNRESET/i.test(msg)) {
    return "انتهت مهلة الاتصال بتليجرام — حاول مجدداً.";
  }
  if (/webhook|setWebhook|getWebhook/i.test(msg)) {
    return "تعذّر ربط الويبهوك مع تليجرام. تحقق من التوكن وأعد المحاولة.";
  }
  if (msg.trim()) return msg;
  return "فشل التفعيل";
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: "طلب غير صالح." }, { status: 400 });
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    const tpl = String(body.template || "AD_BOT").trim();
    const ownerId = String(body.ownerId ?? "").trim();
    const ref = body.ref;
    const activationCode = body.activationCode;
    const password = body.password;

    if (!TOKEN_RE.test(token)) {
      return NextResponse.json(
        { success: false, error: "صيغة التوكن غير صحيحة. الصق التوكن فقط من BotFather." },
        { status: 400 }
      );
    }
    if (!/^\d{5,15}$/.test(ownerId)) {
      return NextResponse.json(
        { success: false, error: "معرّف المالك (Telegram User ID) غير صالح." },
        { status: 400 }
      );
    }
    if (!ALLOWED_TEMPLATES.has(tpl)) {
      return NextResponse.json({ success: false, error: "قالب غير مدعوم على هذه الصفحة." }, { status: 400 });
    }

    let purchase: { id: string } | null = null;
    if ((PASSWORD_TEMPLATES as readonly string[]).includes(tpl)) {
      // Private, owner-only templates — static creator password is the whole gate.
      if (!creatorPasswordOk(tpl, password)) {
        return NextResponse.json({ success: false, error: "كلمة السر غير صحيحة." }, { status: 400 });
      }
    } else {
      // Paid activation code (owner spec, 2026-08-31). Super-admin exempt.
      const isSuperAdmin =
        process.env.SUPER_ADMIN_TELEGRAM_ID && ownerId === process.env.SUPER_ADMIN_TELEGRAM_ID;
      if (!isSuperAdmin) {
        const code = String(activationCode || "").trim().toUpperCase();
        if (!code) {
          return NextResponse.json(
            {
              success: false,
              error:
                "كود التفعيل مطلوب. اطلبه من داخل أي بوت على المنصة عبر زر «أريد بوتاً مماثلاً».",
            },
            { status: 400 }
          );
        }
        const found = await prisma.botPurchase.findUnique({ where: { code } });
        if (!found || found.status !== "APPROVED" || found.buyerId !== ownerId) {
          return NextResponse.json(
            { success: false, error: "كود التفعيل غير صالح أو غير مطابق لآيدي المالك المُدخل." },
            { status: 400 }
          );
        }
        purchase = found;
      }
    }

    // Refuse deploy when this template's Prisma tables were never created.
    // Check BEFORE setWebhook / Bot.create so we never leave a half-wired bot.
    if (templateNeedsTableCheck(tpl)) {
      const readyInfo = await getTemplateReadyInfo(tpl);
      if (!readyInfo.ready) {
        return NextResponse.json(
          {
            success: false,
            error: missingTablesArabicError(readyInfo),
            missingTables: readyInfo.missingTables,
            migrationFile: readyInfo.migrationFile,
          },
          { status: 400 }
        );
      }
    }

    const existing = await prisma.bot.findUnique({ where: { token } });
    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error:
            "هذا التوكن مُفعّل بالفعل على المنصة. أنشئ توكن جديد من BotFather إن كنت تريد بوتاً إضافياً، أو تواصل مع الدعم إن كانت هذه محاولة تفعيل فاشلة سابقة.",
        },
        { status: 400 }
      );
    }

    const tempBot = new Bot(token);
    const botInfo = await withTimeout(
      tempBot.api.getMe(),
      TG_CALL_MS,
      "انتهت مهلة الاتصال بتليجرام — حاول مجدداً."
    );

    const referredByOwnerId =
      ref && String(ref).trim() && String(ref).trim() !== ownerId ? String(ref).trim() : null;

    // Webhook BEFORE Bot row (owner spec, 2026-09-02): failed setWebhook never leaves an orphaned row.
    const botId = crypto.randomUUID();
    const webhookSecret = crypto.randomBytes(32).toString("hex");
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
    const webhookUrl = `${siteUrl}/api/telegram/${botId}`;
    await withTimeout(
      tempBot.api.setWebhook(webhookUrl, { secret_token: webhookSecret }),
      TG_CALL_MS,
      "انتهت مهلة ربط الويبهوك مع تليجرام — حاول مجدداً."
    );

    let newBot;
    try {
      newBot = await prisma.bot.create({
        data: {
          id: botId,
          token,
          template: tpl,
          ownerId,
          webhookSecret,
          referredByOwnerId,
        },
      });
    } catch (createErr) {
      // setWebhook already pointed Telegram at this id — clear it so retries aren't stuck
      // delivering updates to a missing row.
      try {
        await withTimeout(
          tempBot.api.deleteWebhook(),
          8_000,
          "انتهت مهلة إلغاء الويبهوك"
        );
      } catch {
        // best-effort cleanup
      }
      throw createErr;
    }

    if (purchase) {
      await prisma.botPurchase.update({ where: { id: purchase.id }, data: { status: "REDEEMED" } });
    }

    return NextResponse.json({
      success: true,
      message: `تم تفعيل البوت @${botInfo.username} بنجاح!`,
      botId: newBot.id,
    });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err?.code === "P2002") {
      return NextResponse.json(
        { success: false, error: "هذا التوكن مُفعّل بالفعل على المنصة." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: telegramArabicError(error) },
      { status: 400 }
    );
  }
}
