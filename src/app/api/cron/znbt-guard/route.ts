import { NextRequest, NextResponse } from "next/server";
import { runGuard } from "@/lib/znbtGuard";

// Hourly (GitHub workflow znbt-guard): checks what ZNBt depends on for ever and tells the owner when something is wrong (lib/znbtGuard.ts).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && q !== process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await runGuard();
    return NextResponse.json({ status: r.findings.some((f) => f.level === "problem") ? "problem" : "ok", findings: r.findings, notified: r.notified });
  } catch (e) {
    console.error("[znbt-guard]", e);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
