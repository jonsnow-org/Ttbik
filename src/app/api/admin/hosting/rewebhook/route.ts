import { NextRequest, NextResponse } from "next/server";
import { isOwnerServer } from "@/lib/isOwner";
import { ensureFrontDoor } from "@/lib/mediaFrontDoor";
import { rehookBots } from "@/lib/hostingOps";

// Owner only. Points every hosted bot's Telegram webhook at `base` (the gate's address after a move, or the old address to go back).
// {"base":"https://ttbik-gate.<account>.workers.dev","dry":true} lists what would change without changing anything.
// Tokens and webhook secrets are never returned. Also re-runs the media bot's own front-door registration (it follows NEXT_PUBLIC_SITE_URL).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isOwnerServer())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const base = String(b.base || "").trim().replace(/\/$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base)) return NextResponse.json({ error: "base must be an https address without a path" }, { status: 400 });
  const dry = b.dry !== false;   // dry unless explicitly false
  const out = await rehookBots(base, dry);
  let media: { ok: boolean; changed: boolean; detail: string } | null = null;
  if (!dry) media = await ensureFrontDoor().catch((e) => ({ ok: false, changed: false, detail: String(e?.message || e).slice(0, 120) }));
  return NextResponse.json({ dry, base, total: out.length, ok: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, bots: out, media, note: "SITE_BANNER_ADMIN and the main /api/telegram/webhook bot register themselves from NEXT_PUBLIC_SITE_URL; see docs/HOSTING.md" });
}
