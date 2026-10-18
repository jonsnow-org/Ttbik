import { NextRequest, NextResponse } from "next/server";
import { listErrors, setErrorStatus } from "@/lib/errorLog";

export const dynamic = "force-dynamic";

const authorized = (req: NextRequest) => {
  const a = req.headers.get("authorization");
  const s = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (a === `Bearer ${process.env.CRON_SECRET}` || s === process.env.CRON_SECRET);
};

/** GET ?status=open: the grouped errors (read by .github/workflows/error-triage.yml). POST {fp, status: fixed|ignored|open, note}: mark one. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, errors: await listErrors(req.nextUrl.searchParams.get("status") || "open") });
}
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!/^[0-9a-f]{16}$/.test(String(b.fp)) || !["open", "fixed", "ignored"].includes(b.status)) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: await setErrorStatus(b.fp, b.status, typeof b.note === "string" ? b.note.slice(0, 300) : undefined) });
}
