import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// force-dynamic: this route mutates and never serves cached output.
export const dynamic = "force-dynamic";

// Toggle only — no delete here. The backlog item this implements
// (docs/claude-feature-backlog.md, item 0) also asked for a hard delete,
// but the assumption it'd cascade Ads/Users automatically is wrong: the
// real Prisma schema has no onDelete: Cascade on those relations (the
// default is RESTRICT), so a raw delete would just throw a foreign-key
// error, and forcing a real cascade would destroy real financial history
// (Ad budgets, User balances, Transactions) with no undo. Disabling
// (isActive: false) already fully stops the bot — the webhook handler
// (src/app/api/telegram/[botId]/route.ts) already refuses any update for
// an inactive bot — so it covers the actual "shut this down" need without
// the irreversible data-loss risk. A real delete flow, if still wanted,
// needs an explicit owner decision on what happens to that bot's existing
// Ads/Users/Transactions first.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json({ error: "isActive (boolean) مطلوب" }, { status: 400 });
  }

  try {
    const bot = await prisma.bot.update({
      where: { id: params.id },
      data: { isActive: body.isActive },
      select: { id: true, isActive: true },
    });
    return NextResponse.json({ bot });
  } catch {
    return NextResponse.json({ error: "بوت غير موجود" }, { status: 404 });
  }
}
