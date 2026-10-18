import { NextRequest, NextResponse } from "next/server";
import { refreshSnapshot } from "@/lib/znbtIndex";

// Every 5 minutes (GitHub workflow): refresh the coin index of the open platform. Runs even before the platform is opened: it is also how ZNBt's own launch is noticed (lib/znbtConfig.ts).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && q !== process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const s = await refreshSnapshot();
    return NextResponse.json({ status: "ok", coins: s.coins.length });
  } catch (e) {
    console.error("[znbt-index]", e);
    return NextResponse.json({ status: "error", error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 });
  }
}
