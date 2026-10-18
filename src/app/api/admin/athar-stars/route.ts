import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { isOwnerServer } from "@/lib/isOwner";
import { claimOrder, getOrder, isTaken, listQueue, refundOrder, retryOrder, setMintTx, starsEnabled } from "@/lib/atharStars";
import { ATHAR_SITE } from "@/lib/atharMirror";

// The owner's queue of Stars orders (admin-tools/athar-stars). Actions: claim (to sign), retry, refund, tx.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isOwnerServer())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ enabled: starsEnabled(), orders: await listQueue() }); } catch { return NextResponse.json({ enabled: starsEnabled(), orders: [], error: "database" }, { status: 200 }); }
}

export async function POST(req: NextRequest) {
  if (!(await isOwnerServer())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const id = String(b.id || ""), action = String(b.action || "");
  const o = await getOrder(id);
  if (!o) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (action === "claim") {
    // never claim a token that is already on the chain: it goes back to the buyer instead
    const taken = await isTaken(ATHAR_SITE, o.date_index, o.tier);
    if (taken === null) return NextResponse.json({ error: "cannot check the chain now" }, { status: 503 });
    if (taken) { await prisma.$executeRawUnsafe(`update athar_star_orders set status='refund_pending', last_error='already minted on chain' where id=$1 and status='paid'`, id); return NextResponse.json({ error: "already minted: queued for refund" }, { status: 409 }); }
    const c = await claimOrder(id, "owner");
    return c ? NextResponse.json({ order: c }) : NextResponse.json({ error: "not claimable" }, { status: 409 });
  }
  if (action === "retry") return NextResponse.json({ ok: await retryOrder(id) });
  if (action === "tx") return NextResponse.json({ ok: await setMintTx(id, String(b.hash || "").trim()) });
  if (action === "refund") {
    const bot = await prisma.bot.findUnique({ where: { id: o.bot_id }, select: { token: true } });
    if (!bot) return NextResponse.json({ error: "bot missing" }, { status: 404 });
    // a claimed order is refunded only after the chain shows the token is still free
    let fromMinting = false;
    if (o.status === "minting") {
      if ((await isTaken(ATHAR_SITE, o.date_index, o.tier)) !== false) return NextResponse.json({ error: "chain shows the token minted or cannot be checked" }, { status: 409 });
      fromMinting = true;
    }
    return NextResponse.json(await refundOrder(new TelegramBot(bot.token).api, id, { fromMinting }));
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
