import { NextRequest, NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/prisma";
import { isOwnerServer } from "@/lib/isOwner";
import { ensureFrontDoor } from "@/lib/mediaFrontDoor";

// Owner only. Points every hosted bot's Telegram webhook at `base` (the gate's address after a move, or the old address to go back).
// {"base":"https://ttbik-gate.<account>.workers.dev","dry":true} lists what would change without changing anything.
// Tokens and webhook secrets are never returned. Also re-runs the media bot's own front-door registration (it follows NEXT_PUBLIC_SITE_URL).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  if (!(await isOwnerServer())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const base = String(b.base || "").trim().replace(/\/$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(base)) return NextResponse.json({ error: "base must be an https address without a path" }, { status: 400 });
  const dry = b.dry !== false;   // dry unless explicitly false
  const bots = await prisma.bot.findMany({ where: { isActive: true }, select: { id: true, token: true, template: true, webhookSecret: true } });
  const out: { id: string; template: string; from: string; to: string; ok: boolean; note?: string }[] = [];
  for (const row of bots) {
    const to = `${base}/api/telegram/${row.id}`;
    const api = new Bot(row.token).api;
    try {
      const info = await api.getWebhookInfo();
      const from = info.url || "";
      if (from === to) { out.push({ id: row.id, template: row.template, from, to, ok: true, note: "already there" }); continue; }
      if (!dry) await api.setWebhook(to, { secret_token: row.webhookSecret });
      out.push({ id: row.id, template: row.template, from, to, ok: true, note: dry ? "would change" : "changed" });
    } catch (e: any) {
      out.push({ id: row.id, template: row.template, from: "", to, ok: false, note: String(e?.description || e?.message || e).slice(0, 120) });
    }
    if (!dry) await sleep(60);
  }
  let media: { ok: boolean; changed: boolean; detail: string } | null = null;
  if (!dry) media = await ensureFrontDoor().catch((e) => ({ ok: false, changed: false, detail: String(e?.message || e).slice(0, 120) }));
  return NextResponse.json({ dry, base, total: out.length, ok: out.filter((x) => x.ok).length, failed: out.filter((x) => !x.ok).length, bots: out, media, note: "SITE_BANNER_ADMIN and the main /api/telegram/webhook bot register themselves from NEXT_PUBLIC_SITE_URL; see docs/HOSTING.md" });
}
