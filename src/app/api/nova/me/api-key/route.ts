import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Generates (or rotates) the user's own API key for the "API" channel —
// same 32-byte-hex entropy pattern this project already uses elsewhere
// (e.g. digital-card's editToken via crypto.randomBytes). Rotating
// invalidates the previous key immediately (unique constraint on apiKey
// means the old value is simply overwritten, never reused).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid || "");
  if (!uid) return NextResponse.json({ error: "missing uid" }, { status: 400 });

  const apiKey = `nova_${crypto.randomBytes(24).toString("hex")}`;
  const user = await prisma.novaUser.update({ where: { id: uid }, data: { apiKey } }).catch(() => null);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  return NextResponse.json({ apiKey });
}
