import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Owner spec, 2026-09-13 ("نظام الربط الحقيقي"): the ONLY place a
// GitHub/Vercel credential ever enters this project's database. Gated
// by possession of the same unguessable NovaUser uuid the dashboard
// already trusts (src/app/api/nova/me/route.ts) — no separate
// username/password system invented for this.
//
// Why this exists as a web route instead of a Telegram command,
// stated plainly: EVERY ordinary chat message flows through
// council.classify_intent (sent to Groq, a third party) and then
// quota.log_usage, which durably stores the message text into
// NovaUsageLog — the exact table the weekly Kaggle notebook trains on.
// A token pasted in chat would be forwarded to Groq and baked into
// training data. This route is never touched by that pipeline at all.
const SUPPORTED_SERVICES = ["github"];

export async function GET(req: NextRequest) {
  const uid = req.nextUrl.searchParams.get("uid") || "";
  if (!uid) return NextResponse.json({ error: "missing uid" }, { status: 400 });

  const user = await prisma.novaUser.findUnique({ where: { id: uid } });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Never select `credential` here — this endpoint lists what's
  // connected, it never hands a stored token back to the browser.
  const connections = await prisma.novaConnection.findMany({
    where: { novaUserId: uid, status: "ACTIVE" },
    select: { id: true, service: true, label: true, created_at: true },
    orderBy: { created_at: "desc" },
  });
  return NextResponse.json({ connections });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid || "");
  const service = String(body.service || "");
  const label = String(body.label || "").trim();
  const credential = String(body.credential || "").trim();
  const baseBranch = body.baseBranch ? String(body.baseBranch).trim() : null;

  if (!uid) return NextResponse.json({ error: "missing uid" }, { status: 400 });
  if (!SUPPORTED_SERVICES.includes(service)) {
    return NextResponse.json({ error: `service must be one of: ${SUPPORTED_SERVICES.join(", ")}` }, { status: 400 });
  }
  if (!label || !credential) {
    return NextResponse.json({ error: "label and credential are required" }, { status: 400 });
  }

  const user = await prisma.novaUser.findUnique({ where: { id: uid } });
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  const connection = await prisma.novaConnection.create({
    data: {
      id: `conn-${crypto.randomBytes(6).toString("hex")}`,
      novaUserId: uid,
      service,
      label,
      credential,
      baseBranch,
    },
    select: { id: true, service: true, label: true, created_at: true }, // never echo `credential` back either
  });

  return NextResponse.json({ connection });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid || "");
  const connectionId = String(body.connectionId || "");
  if (!uid || !connectionId) {
    return NextResponse.json({ error: "missing uid or connectionId" }, { status: 400 });
  }

  // Scoped to (id AND novaUserId) together — without the ownership
  // check here too, guessing another user's connection id would be
  // enough to revoke it.
  const result = await prisma.novaConnection.updateMany({
    where: { id: connectionId, novaUserId: uid },
    data: { status: "REVOKED", revoked_at: new Date() },
  });
  if (result.count === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
