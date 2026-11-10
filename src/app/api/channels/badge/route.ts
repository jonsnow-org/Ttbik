import { NextRequest, NextResponse } from "next/server";
import { createBadgeOrder } from "@/lib/channels/exchange";

// ☑️ Verified-channel badge, $10 / year. POST {token} → a CHB- code to pay with /api/channels/deal {action:"pay"}.
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const r = await createBadgeOrder(String(b.token || "")).catch(() => ({ ok: false as const, error: "تعذّر إنشاء الطلب." }));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
