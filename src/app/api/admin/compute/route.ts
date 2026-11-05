import { NextRequest, NextResponse } from "next/server";
import { clientComputeEnabled, setClientComputeEnabled } from "@/lib/novaSettings";

// Protected by src/middleware.ts (matcher covers /api/admin/:path*) — same ADMIN_PASSWORD
// cookie gate as every other /api/admin/* route.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ enabled: await clientComputeEnabled() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const enabled = body?.enabled === true || body?.enabled === "true";
  await setClientComputeEnabled(enabled);
  return NextResponse.json({ enabled });
}
