import { NextRequest, NextResponse } from "next/server";
import cfg from "../../../../../public/zenobia/znbt/config.json";
import { refreshSnapshot } from "@/lib/znbtIndex";

// Every 5 minutes (GitHub workflow): refresh the coin index of the open platform. Does nothing until the platform is opened (config.open).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && q !== process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(cfg as { open?: boolean }).open) return NextResponse.json({ status: "closed" });
  try {
    const s = await refreshSnapshot();
    return NextResponse.json({ status: "ok", coins: s.coins.length });
  } catch (e) {
    console.error("[znbt-index]", e);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
