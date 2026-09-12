import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";

// One-off maintenance endpoint: swap a deployed bot's Telegram token (e.g.
// after regenerating it in @BotFather) and re-register the webhook under
// the new token — a plain SQL UPDATE on Bot.token alone wouldn't do this,
// since Telegram only delivers updates to whichever token last called
// setWebhook for that bot.
//
// GET exists purely so this can be triggered by opening a link in a phone
// browser (no way to fire a POST from a tap) — same logic either way.
export async function GET(req: NextRequest) {
  const newToken = req.nextUrl.searchParams.get("newToken");
  const botId = req.nextUrl.searchParams.get("botId") || undefined;
  const template = req.nextUrl.searchParams.get("template") || undefined;
  return handleUpdate(newToken, botId, template);
}

export async function POST(req: NextRequest) {
  try {
    const { botId, newToken, template } = await req.json();
    return handleUpdate(newToken, botId, template);
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "invalid request body" }, { status: 400 });
  }
}

async function handleUpdate(newToken: string | null | undefined, botId: string | undefined, template: string | undefined) {
  try {
    if (!newToken || typeof newToken !== "string") {
      return NextResponse.json({ success: false, error: "newToken is required" }, { status: 400 });
    }

    let targetId: string | undefined = botId;

    // Real incident, 2026-09-12: a super-admin owner with MORE than one
    // Bot row (Nova plus at least one other deployed bot, both under the
    // same ownerId) hit the "default target" branch below, which had no
    // way to prefer the right one and grabbed an unrelated bot — the
    // very next line then failed with a unique-constraint error trying
    // to write NOVA's own already-correct token onto that wrong row.
    // Checked first, before any ownerId guessing: if a row ALREADY has
    // this exact token (the common real case for this endpoint — just
    // re-registering a webhook that got cleared, not an actual
    // rotation), that row is unambiguously the right one regardless of
    // how many bots this owner has.
    if (!targetId) {
      const exactTokenMatch = await prisma.bot.findUnique({ where: { token: newToken } });
      if (exactTokenMatch) targetId = exactTokenMatch.id;
    }

    if (!targetId && process.env.SUPER_ADMIN_TELEGRAM_ID) {
      // Default target: the platform's own bot, owned by SUPER_ADMIN_TELEGRAM_ID
      // — distinct from any other bots deployed on the platform. Prefers
      // NOVA_BOT specifically now (same real incident above: ownerId
      // alone isn't unique enough once more than one bot shares it) —
      // pass ?template=OTHER_TEMPLATE explicitly to target a different
      // one of the owner's bots instead.
      const superAdminBot = await prisma.bot.findFirst({
        where: { ownerId: process.env.SUPER_ADMIN_TELEGRAM_ID, template: template || "NOVA_BOT" },
      });
      if (superAdminBot) targetId = superAdminBot.id;
    }
    if (!targetId) {
      const all = await prisma.bot.findMany({ select: { id: true } });
      if (all.length !== 1) {
        return NextResponse.json(
          { success: false, error: `botId is required (${all.length} bots exist, can't pick one automatically)` },
          { status: 400 }
        );
      }
      targetId = all[0].id;
    }

    const botRow = await prisma.bot.findUnique({ where: { id: targetId } });
    if (!botRow) {
      return NextResponse.json({ success: false, error: "bot not found" }, { status: 404 });
    }

    const newBot = new Bot(newToken);
    const info = await newBot.api.getMe(); // validates the new token actually works

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
    const webhookUrl = `${siteUrl}/api/telegram/${botRow.id}`;
    await newBot.api.setWebhook(webhookUrl, { secret_token: botRow.webhookSecret });

    try {
      await prisma.bot.update({ where: { id: botRow.id }, data: { token: newToken } });
    } catch (updateError: any) {
      // Real incident, 2026-09-12: this kept failing with a unique-
      // constraint error even after the exact-token-match fix above,
      // meaning newToken already belongs to SOME row that ISN'T the one
      // resolved above (targetId picked the wrong bot for a reason not
      // yet understood from outside the database). Surfacing exactly
      // which row already holds this token — never the token value
      // itself — turns the next attempt into a real fix instead of
      // another guess.
      if (updateError?.code === "P2002") {
        const conflictingRow = await prisma.bot.findUnique({ where: { token: newToken } });
        return NextResponse.json(
          {
            success: false,
            error: "unique constraint on token",
            resolved_target: { id: botRow.id, template: botRow.template, ownerId: botRow.ownerId },
            already_holds_this_token: conflictingRow
              ? { id: conflictingRow.id, template: conflictingRow.template, ownerId: conflictingRow.ownerId, isActive: conflictingRow.isActive }
              : null,
          },
          { status: 409 },
        );
      }
      throw updateError;
    }

    return NextResponse.json({ success: true, message: `Token updated for @${info.username}`, botId: botRow.id });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || "update failed" }, { status: 400 });
  }
}
