import { NextRequest, NextResponse } from "next/server";
import { announce } from "@/lib/announce";

export const maxDuration = 30;

/** ?id=znbt-launch&to=both|general|coins[&dry=1]: posts a prepared announcement once per channel (see lib/announce.ts). */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams;
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && q.get("secret") !== process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const to = q.get("to") || "both";
  if (!["both", "general", "coins"].includes(to)) return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  return NextResponse.json({ ok: true, result: await announce(q.get("id") || "", to as "both" | "general" | "coins", q.get("dry") === "1") });
}
