import { NextRequest, NextResponse } from "next/server";
import { HOSTING, callerIp, closeEnvWindow, envWindowOpen, exportEnv, sameSecret } from "@/lib/hostingOps";

// Gives Oracle the site's environment, ONCE, after the owner opened a 15-minute window from the «الاستضافة» panel.
// Three locks: the window (owner's tap), the shared secret the Oracle engine already has (FEED_SECRET), and the caller's address = Oracle's.
// The window closes after the first success. Nothing is logged except the names' count.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const deny = () => NextResponse.json({ ok: false }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const given = String(req.headers.get("x-feed-secret") || "");
  const secrets = [process.env.FEED_SECRET, process.env.ADMIN_PASSWORD].filter((s): s is string => !!s && s.trim() !== "");
  if (!secrets.some((s) => sameSecret(given, s.trim()))) return deny();
  if (callerIp(req.headers) !== HOSTING.oracleIp) return deny();
  if (!(await envWindowOpen().catch(() => false))) return deny();
  const env = exportEnv();
  await closeEnvWindow().catch(() => null);
  console.log(`[env-sync] exported ${Object.keys(env).length} variables to Oracle`);
  return NextResponse.json({ ok: true, env }, { headers: { "Cache-Control": "no-store" } });
}
