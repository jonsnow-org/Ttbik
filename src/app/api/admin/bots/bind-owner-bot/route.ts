import { NextResponse } from "next/server";
import { isOwnerServer } from "@/lib/isOwner";
import { gateUrl } from "@/lib/hostingOps";
import { ensureOwnerBotFromEnv } from "@/lib/builderOwnerBot";

// Owner only: registers/binds the builder's owner bot from env BUILDER_OWNER_BOT_TOKEN (alias SHAM_TEST0_BOT_TOKEN). Idempotent; the
// hourly hosting-gate-sync does the same on its own. Never returns the token.
export const dynamic = "force-dynamic";
export async function POST() {
  if (!(await isOwnerServer())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await ensureOwnerBotFromEnv(gateUrl()).catch((e) => ({ ok: false, note: String(e?.message || e).slice(0, 120) }));
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
